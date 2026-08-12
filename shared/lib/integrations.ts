import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const INTEGRATIONS_PATH = path.join(ROOT_DIR, 'about-me', 'integrations.json');

export interface IntegrationsConfig {
  web: { pin: string; port: number };
  ebay: { clientId: string; clientSecret: string; redirectUri: string; environment: 'production' | 'sandbox' };
  gmail: { clientId: string; clientSecret: string; redirectUri: string; pollIntervalMinutes: number };
}

const DEFAULTS: IntegrationsConfig = {
  web: { pin: '', port: 4173 },
  ebay: {
    clientId: '',
    clientSecret: '',
    redirectUri: 'http://localhost:4173/api/ebay/callback',
    environment: 'production',
  },
  gmail: {
    clientId: '',
    clientSecret: '',
    redirectUri: 'http://localhost:4173/api/gmail/callback',
    pollIntervalMinutes: 10,
  },
};

export function loadIntegrations(): IntegrationsConfig {
  try {
    const raw = fs.readFileSync(INTEGRATIONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<IntegrationsConfig>;
    return {
      web: { ...DEFAULTS.web, ...parsed.web },
      ebay: { ...DEFAULTS.ebay, ...parsed.ebay },
      gmail: { ...DEFAULTS.gmail, ...parsed.gmail },
    };
  } catch {
    return DEFAULTS;
  }
}

export function isEbayConfigured(cfg: IntegrationsConfig): boolean {
  return Boolean(cfg.ebay.clientId && cfg.ebay.clientSecret);
}

export function isGmailConfigured(cfg: IntegrationsConfig): boolean {
  return Boolean(cfg.gmail.clientId && cfg.gmail.clientSecret);
}
