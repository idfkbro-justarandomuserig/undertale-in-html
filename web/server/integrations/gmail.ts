import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IntegrationsConfig } from '../../../shared/lib/integrations.js';
import { ingestShippingNotification } from '../../../shared/tools/shipping.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..');
const TOKEN_PATH = path.join(ROOT_DIR, 'data', 'gmail_token.json');
const STATE_PATH = path.join(ROOT_DIR, 'data', 'gmail_state.json');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Senders/keywords for the marketplaces without an official order API.
// eBay is excluded here since it's covered by the direct API integration.
const SEARCH_QUERY =
  '(from:mercari.com OR from:depop.com OR from:facebookmail.com OR from:poshmark.com) ' +
  '(tracking OR shipped OR "on its way" OR "label created" OR "has shipped") newer_than:14d';

const MAX_PROCESSED_IDS_KEPT = 1000;

interface GmailTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}

interface GmailState {
  processedMessageIds: string[];
}

export function isConfigured(cfg: IntegrationsConfig): boolean {
  return Boolean(cfg.gmail.clientId && cfg.gmail.clientSecret);
}

export function isConnected(): boolean {
  return loadTokens() !== null;
}

export function getAuthorizationUrl(cfg: IntegrationsConfig): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', cfg.gmail.clientId);
  url.searchParams.set('redirect_uri', cfg.gmail.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

function saveTokens(tokens: GmailTokens): void {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
}

function loadTokens(): GmailTokens | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) as GmailTokens;
  } catch {
    return null;
  }
}

function loadState(): GmailState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as GmailState;
  } catch {
    return { processedMessageIds: [] };
  }
}

function saveState(state: GmailState): void {
  const trimmed = state.processedMessageIds.slice(-MAX_PROCESSED_IDS_KEPT);
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ processedMessageIds: trimmed }, null, 2), 'utf-8');
}

async function exchangeCodeForTokens(cfg: IntegrationsConfig, code: string): Promise<GmailTokens> {
  const body = new URLSearchParams({
    client_id: cfg.gmail.clientId,
    client_secret: cfg.gmail.clientSecret,
    code,
    redirect_uri: cfg.gmail.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Gmail token exchange failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  if (!json.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke prior access at myaccount.google.com/permissions and try connecting again (Google only issues a refresh token on first consent).',
    );
  }
  const tokens: GmailTokens = {
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + json.expires_in * 1000,
    refreshToken: json.refresh_token,
  };
  saveTokens(tokens);
  return tokens;
}

async function refreshAccessToken(cfg: IntegrationsConfig, tokens: GmailTokens): Promise<GmailTokens> {
  const body = new URLSearchParams({
    client_id: cfg.gmail.clientId,
    client_secret: cfg.gmail.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const updated: GmailTokens = { ...tokens, accessToken: json.access_token, accessTokenExpiresAt: Date.now() + json.expires_in * 1000 };
  saveTokens(updated);
  return updated;
}

async function getValidAccessToken(cfg: IntegrationsConfig): Promise<string> {
  let tokens = loadTokens();
  if (!tokens) throw new Error('Gmail is not connected yet. Hit /api/gmail/connect first.');
  if (Date.now() > tokens.accessTokenExpiresAt - 60_000) {
    tokens = await refreshAccessToken(cfg, tokens);
  }
  return tokens.accessToken;
}

export async function handleCallback(cfg: IntegrationsConfig, code: string): Promise<void> {
  await exchangeCodeForTokens(cfg, code);
}

function base64UrlDecode(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

function extractPlainText(payload: GmailMessagePart): string {
  const collected: string[] = [];

  function walk(part: GmailMessagePart): void {
    if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
      const decoded = base64UrlDecode(part.body.data);
      collected.push(part.mimeType === 'text/html' ? stripHtml(decoded) : decoded);
    }
    for (const child of part.parts ?? []) walk(child);
  }

  walk(payload);
  return collected.join('\n');
}

export async function pollForShippingEmails(
  db: Database.Database,
  cfg: IntegrationsConfig,
): Promise<{ messagesChecked: number; shipmentsIngested: number }> {
  const accessToken = await getValidAccessToken(cfg);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const state = loadState();
  const seen = new Set(state.processedMessageIds);

  const listUrl = new URL(`${GMAIL_API}/messages`);
  listUrl.searchParams.set('q', SEARCH_QUERY);
  listUrl.searchParams.set('maxResults', '25');

  const listRes = await fetch(listUrl, { headers });
  if (!listRes.ok) {
    throw new Error(`Gmail search failed: ${listRes.status} ${await listRes.text()}`);
  }
  const { messages = [] } = (await listRes.json()) as { messages?: { id: string }[] };

  let shipmentsIngested = 0;
  for (const { id } of messages) {
    if (seen.has(id)) continue;

    const msgRes = await fetch(`${GMAIL_API}/messages/${id}?format=full`, { headers });
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as { payload?: GmailMessagePart };
    if (!msg.payload) continue;

    const text = extractPlainText(msg.payload);
    if (text.trim()) {
      ingestShippingNotification(db, { rawText: text });
      shipmentsIngested += 1;
    }
    seen.add(id);
  }

  saveState({ processedMessageIds: Array.from(seen) });
  return { messagesChecked: messages.length, shipmentsIngested };
}
