import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const LOG_DIR = path.join(ROOT_DIR, 'logs');

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function appendHeartbeat(message: string): void {
  ensureLogDir();
  fs.appendFileSync(path.join(LOG_DIR, 'heartbeat.log'), `[${new Date().toISOString()}] HEARTBEAT ${message}\n`);
}

export function logError(err: unknown): void {
  ensureLogDir();
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  fs.appendFileSync(path.join(LOG_DIR, 'error.log'), `[${new Date().toISOString()}] ERROR ${message}\n`);
}
