import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DAEMON_ENTRY = path.join(ROOT_DIR, 'dist', 'daemon', 'daemon.js');
const PLIST_NAME = 'com.resale.mcp.plist';
const LABEL = 'com.resale.mcp';

export async function installMacOS(): Promise<void> {
  const nodeExe = process.execPath;
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  const plistPath = path.join(launchAgentsDir, PLIST_NAME);

  const logDir = path.join(ROOT_DIR, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeExe}</string>
    <string>${DAEMON_ENTRY}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'daemon-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'daemon-stderr.log')}</string>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plist, 'utf-8');
  console.log(`Wrote LaunchAgent plist to ${plistPath}`);

  try {
    await execFileAsync('launchctl', ['unload', plistPath]);
  } catch {
    // Not previously loaded; ignore.
  }
  await execFileAsync('launchctl', ['load', plistPath]);

  console.log(`Loaded LaunchAgent "${LABEL}". It will auto-start at login and restart if it exits (KeepAlive).`);
  console.log(`Unload:  launchctl unload ${plistPath}`);
  console.log(`Remove:  launchctl unload ${plistPath} && rm ${plistPath}`);
}
