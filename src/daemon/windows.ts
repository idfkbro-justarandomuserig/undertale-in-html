import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DAEMON_ENTRY = path.join(ROOT_DIR, 'dist', 'daemon', 'daemon.js');
const TASK_NAME = 'ResaleMCPDaemon';

export async function installWindows(): Promise<void> {
  const nodeExe = process.execPath;
  const batPath = path.join(ROOT_DIR, 'start-daemon.bat');

  const batContent = `@echo off\r\npowershell -WindowStyle Hidden -Command "& '${nodeExe}' '${DAEMON_ENTRY}'"\r\n`;
  fs.writeFileSync(batPath, batContent, 'utf-8');
  console.log(`Wrote hidden launcher script to ${batPath}`);

  const args = ['/Create', '/TN', TASK_NAME, '/TR', `"${batPath}"`, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'];

  console.log(`Registering Windows scheduled task "${TASK_NAME}" (runs hidden at login)...`);
  await execFileAsync('schtasks', args);

  console.log('Done. The daemon will start hidden at every login.');
  console.log(`Run it right now:   schtasks /Run /TN ${TASK_NAME}`);
  console.log(`Remove auto-start:  schtasks /Delete /TN ${TASK_NAME} /F`);
}
