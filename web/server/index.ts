import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../../shared/db.js';
import { loadPreferences } from '../../shared/lib/preferences.js';
import { loadIntegrations, isEbayConfigured, isGmailConfigured } from '../../shared/lib/integrations.js';
import { appendHeartbeat, logError } from '../../shared/lib/log.js';
import { getInventoryStatus, bulkAddInventory } from '../../shared/tools/inventory.js';
import { bulkBatchExecute } from '../../shared/tools/batch.js';
import { getStockPortfolio, syncStockPortfolio } from '../../shared/tools/stocks.js';
import { ingestShippingNotification, listShipments } from '../../shared/tools/shipping.js';
import { login, requireAuth } from './auth.js';
import * as ebay from './integrations/ebay.js';
import * as gmail from './integrations/gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// web/public/ is static (HTML/CSS/JS/icons) and is never compiled by tsc, so
// it stays at its source location — not mirrored under dist/ like the .ts
// files. From dist/web/server/index.js, that's three levels up to the repo
// root, then into web/public.
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', '..', 'web', 'public');

const db = openDatabase();
const prefs = loadPreferences();
let integrations = loadIntegrations();

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const auth = () => requireAuth(integrations);

// ---- Auth ----
app.post('/api/login', (req, res) => {
  const token = login(req.body?.pin ?? '', integrations);
  if (!token) {
    res.status(401).json({ error: 'Wrong PIN, or no PIN configured yet in about-me/integrations.json' });
    return;
  }
  res.json({ token });
});

// ---- Status (which integrations are configured/connected) ----
app.get('/api/status', auth(), (_req, res) => {
  res.json({
    ebay: { configured: isEbayConfigured(integrations), connected: ebay.isConnected() },
    gmail: { configured: isGmailConfigured(integrations), connected: gmail.isConnected() },
  });
});

// ---- Inventory ----
app.get('/api/inventory', auth(), (req, res) => {
  try {
    const { status, platform, category } = req.query as Record<string, string | undefined>;
    res.json(getInventoryStatus(db, prefs, { status, platform, category }));
  } catch (err) {
    logError(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/inventory/bulk', auth(), (req, res) => {
  try {
    res.json(bulkAddInventory(db, req.body?.items ?? []));
  } catch (err) {
    logError(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/inventory/batch', auth(), (req, res) => {
  try {
    res.json(bulkBatchExecute(db, req.body));
  } catch (err) {
    logError(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Stocks ----
app.get('/api/stocks', auth(), (_req, res) => {
  res.json(getStockPortfolio(db));
});

app.post('/api/stocks/sync', auth(), (req, res) => {
  try {
    res.json(syncStockPortfolio(db, req.body?.updates ?? []));
  } catch (err) {
    logError(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Shipping ----
app.get('/api/shipping', auth(), (_req, res) => {
  res.json({ shipments: listShipments(db) });
});

app.post('/api/shipping/ingest', auth(), (req, res) => {
  try {
    res.json(ingestShippingNotification(db, req.body));
  } catch (err) {
    logError(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- eBay integration ----
app.get('/api/ebay/connect-url', auth(), (_req, res) => {
  if (!isEbayConfigured(integrations)) {
    res.status(400).json({ error: 'eBay client ID/secret not set in about-me/integrations.json' });
    return;
  }
  res.json({ url: ebay.getAuthorizationUrl(integrations) });
});

// eBay redirects the browser here directly (no Authorization header available), so this
// route is intentionally not behind requireAuth — it only accepts a one-time-use OAuth code.
app.get('/api/ebay/callback', async (req, res) => {
  try {
    await ebay.handleCallback(integrations, String(req.query.code ?? ''));
    res.send('<html><body>eBay connected. You can close this tab and go back to the dashboard.</body></html>');
  } catch (err) {
    logError(err);
    res.status(500).send(`<html><body>eBay connection failed: ${(err as Error).message}</body></html>`);
  }
});

app.post('/api/ebay/sync', auth(), async (_req, res) => {
  try {
    res.json(await ebay.syncOrders(db, integrations));
  } catch (err) {
    logError(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Gmail integration ----
app.get('/api/gmail/connect-url', auth(), (_req, res) => {
  if (!isGmailConfigured(integrations)) {
    res.status(400).json({ error: 'Gmail client ID/secret not set in about-me/integrations.json' });
    return;
  }
  res.json({ url: gmail.getAuthorizationUrl(integrations) });
});

app.get('/api/gmail/callback', async (req, res) => {
  try {
    await gmail.handleCallback(integrations, String(req.query.code ?? ''));
    res.send('<html><body>Gmail connected. You can close this tab and go back to the dashboard.</body></html>');
  } catch (err) {
    logError(err);
    res.status(500).send(`<html><body>Gmail connection failed: ${(err as Error).message}</body></html>`);
  }
});

app.post('/api/gmail/sync', auth(), async (_req, res) => {
  try {
    res.json(await gmail.pollForShippingEmails(db, integrations));
  } catch (err) {
    logError(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// SPA fallback for any non-API route
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = integrations.web.port || 4173;
app.listen(PORT, '0.0.0.0', () => {
  appendHeartbeat(`web dashboard listening on :${PORT}`);
  console.log(`Resale dashboard listening on http://0.0.0.0:${PORT}`);
});

// Background auto-sync: quietly try eBay/Gmail every N minutes if connected.
const AUTO_SYNC_INTERVAL_MS = Math.max(1, integrations.gmail.pollIntervalMinutes) * 60 * 1000;
setInterval(async () => {
  integrations = loadIntegrations();
  if (isEbayConfigured(integrations) && ebay.isConnected()) {
    try {
      await ebay.syncOrders(db, integrations);
    } catch (err) {
      logError(err);
    }
  }
  if (isGmailConfigured(integrations) && gmail.isConnected()) {
    try {
      await gmail.pollForShippingEmails(db, integrations);
    } catch (err) {
      logError(err);
    }
  }
}, AUTO_SYNC_INTERVAL_MS);
