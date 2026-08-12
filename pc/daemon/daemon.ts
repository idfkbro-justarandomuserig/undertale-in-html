import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const WEB_SERVER_ENTRY = path.join(ROOT_DIR, 'dist', 'web', 'server', 'index.js');

const MAX_RESTART_DELAY_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(file: string, message: string): void {
  fs.appendFileSync(path.join(LOG_DIR, file), `[${new Date().toISOString()}] ${message}\n`);
}

// NOTE: this daemon supervises the *web dashboard server*, not the MCP stdio
// server. Claude Desktop spawns dist/pc/mcp-server/index.js itself per
// session (that's how stdio transport works) and needs no supervisor. The
// web server is the one piece that genuinely benefits from staying alive
// independent of whether Claude Desktop is even open, since your phone can
// hit it any time.

let restartAttempts = 0;
let child: ChildProcess | null = null;
let shuttingDown = false;

function startChild(): void {
  if (!fs.existsSync(WEB_SERVER_ENTRY)) {
    log('error.log', `Web server entry not found at ${WEB_SERVER_ENTRY}. Run "npm run build" first.`);
    process.exit(1);
  }

  log('daemon.log', `Starting web dashboard server (attempt ${restartAttempts + 1})`);
  child = spawn(process.execPath, [WEB_SERVER_ENTRY], { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log('daemon.log', `Web server exited (code=${code}, signal=${signal})`);
    restartAttempts += 1;
    const delay = Math.min(1000 * 2 ** restartAttempts, MAX_RESTART_DELAY_MS);
    log('daemon.log', `Restarting in ${delay}ms`);
    setTimeout(startChild, delay);
  });

  child.on('error', (err) => {
    log('error.log', `Failed to start web server: ${err.message}`);
  });

  child.once('spawn', () => {
    restartAttempts = 0;
  });
}

function heartbeat(): void {
  log('heartbeat.log', `Daemon alive. Child PID: ${child?.pid ?? 'none'}`);
}

function shutdown(): void {
  shuttingDown = true;
  log('daemon.log', 'Daemon shutting down');
  child?.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startChild();
setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
