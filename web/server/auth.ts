import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { IntegrationsConfig } from '../../shared/lib/integrations.js';

const sessions = new Map<string, number>();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function login(pin: string, cfg: IntegrationsConfig): string | null {
  if (!cfg.web.pin || pin !== cfg.web.pin) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function requireAuth(cfg: IntegrationsConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.web.pin) {
      res.status(503).json({ error: 'No PIN set. Copy about-me/integrations.example.json to about-me/integrations.json and set web.pin.' });
      return;
    }
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const expiresAt = token ? sessions.get(token) : undefined;
    if (!token || !expiresAt || expiresAt < Date.now()) {
      if (token) sessions.delete(token);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
