import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IntegrationsConfig } from '../../../shared/lib/integrations.js';
import { upsertShipmentRecord } from '../../../shared/tools/shipping.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..');
const TOKEN_PATH = path.join(ROOT_DIR, 'data', 'ebay_token.json');

// Read-only scope: we only ever pull order/shipment data, never create or
// modify listings/orders on the user's behalf.
const SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';

interface EbayTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
}

interface EbayOrder {
  orderId: string;
  lineItems?: { sku?: string; title?: string }[];
}

interface EbayFulfillment {
  shipmentTrackingNumber?: string;
  shippingCarrierCode?: string;
}

function authBase(cfg: IntegrationsConfig): string {
  return cfg.ebay.environment === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com';
}

function apiBase(cfg: IntegrationsConfig): string {
  return cfg.ebay.environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

export function isConfigured(cfg: IntegrationsConfig): boolean {
  return Boolean(cfg.ebay.clientId && cfg.ebay.clientSecret);
}

export function isConnected(): boolean {
  return loadTokens() !== null;
}

export function getAuthorizationUrl(cfg: IntegrationsConfig): string {
  const url = new URL(`${authBase(cfg)}/oauth2/authorize`);
  url.searchParams.set('client_id', cfg.ebay.clientId);
  url.searchParams.set('redirect_uri', cfg.ebay.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  return url.toString();
}

function saveTokens(tokens: EbayTokens): void {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
}

function loadTokens(): EbayTokens | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) as EbayTokens;
  } catch {
    return null;
  }
}

async function exchangeCodeForTokens(cfg: IntegrationsConfig, code: string): Promise<EbayTokens> {
  const basic = Buffer.from(`${cfg.ebay.clientId}:${cfg.ebay.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.ebay.redirectUri,
  });

  const res = await fetch(`${apiBase(cfg)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`eBay token exchange failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_token_expires_in: number;
  };
  const now = Date.now();
  const tokens: EbayTokens = {
    accessToken: json.access_token,
    accessTokenExpiresAt: now + json.expires_in * 1000,
    refreshToken: json.refresh_token,
    refreshTokenExpiresAt: now + json.refresh_token_expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function refreshAccessToken(cfg: IntegrationsConfig, tokens: EbayTokens): Promise<EbayTokens> {
  const basic = Buffer.from(`${cfg.ebay.clientId}:${cfg.ebay.clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, scope: SCOPE });

  const res = await fetch(`${apiBase(cfg)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`eBay token refresh failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const updated: EbayTokens = { ...tokens, accessToken: json.access_token, accessTokenExpiresAt: Date.now() + json.expires_in * 1000 };
  saveTokens(updated);
  return updated;
}

async function getValidAccessToken(cfg: IntegrationsConfig): Promise<string> {
  let tokens = loadTokens();
  if (!tokens) throw new Error('eBay is not connected yet. Hit /api/ebay/connect first.');
  if (Date.now() > tokens.accessTokenExpiresAt - 60_000) {
    tokens = await refreshAccessToken(cfg, tokens);
  }
  return tokens.accessToken;
}

export async function handleCallback(cfg: IntegrationsConfig, code: string): Promise<void> {
  await exchangeCodeForTokens(cfg, code);
}

export async function syncOrders(
  db: Database.Database,
  cfg: IntegrationsConfig,
): Promise<{ ordersChecked: number; shipmentsUpserted: number }> {
  const accessToken = await getValidAccessToken(cfg);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    'Content-Type': 'application/json',
  };

  const ordersRes = await fetch(`${apiBase(cfg)}/sell/fulfillment/v1/order?limit=50`, { headers });
  if (!ordersRes.ok) {
    throw new Error(`eBay order fetch failed: ${ordersRes.status} ${await ordersRes.text()}`);
  }
  const { orders = [] } = (await ordersRes.json()) as { orders?: EbayOrder[] };

  let shipmentsUpserted = 0;
  for (const order of orders) {
    const fulfillRes = await fetch(`${apiBase(cfg)}/sell/fulfillment/v1/order/${order.orderId}/shipping_fulfillment`, { headers });
    if (!fulfillRes.ok) continue;
    const { fulfillments = [] } = (await fulfillRes.json()) as { fulfillments?: EbayFulfillment[] };

    for (const fulfillment of fulfillments) {
      if (!fulfillment.shipmentTrackingNumber) continue;
      const sku = order.lineItems?.[0]?.sku ?? null;
      upsertShipmentRecord(db, {
        trackingNumber: fulfillment.shipmentTrackingNumber,
        carrier: fulfillment.shippingCarrierCode ?? null,
        buyerAlias: null,
        platform: 'ebay',
        sku,
        status: 'In Transit',
        rawNotification: JSON.stringify({ orderId: order.orderId, fulfillment }),
      });
      shipmentsUpserted += 1;
    }
  }

  return { ordersChecked: orders.length, shipmentsUpserted };
}
