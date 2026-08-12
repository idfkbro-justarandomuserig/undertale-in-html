import os from 'node:os';
import { installWindows } from './windows.js';
import { installMacOS } from './macos.js';

async function main(): Promise<void> {
  const platform = os.platform();

  if (platform === 'win32') {
    await installWindows();
  } else if (platform === 'darwin') {
    await installMacOS();
  } else {
    console.error(`Unsupported platform for auto-start daemon installation: ${platform}.`);
    console.error('Supported: win32 (Windows), darwin (macOS).');
    console.error('You can still run the daemon manually with: npm run start:daemon');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Daemon installation failed:', err);
  process.exit(1);
});
