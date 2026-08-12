#!/usr/bin/env bash
# One-click installer for macOS: installs deps, builds, wires the MCP server
# into Claude Desktop's config, and registers the background web-dashboard
# daemon to auto-start hidden at login.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Resale Command Center installer"
echo "Repo root: $REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew..."
    brew install node
  else
    echo "Please install Node.js from https://nodejs.org and re-run this script." >&2
    exit 1
  fi
fi

cd "$REPO_ROOT"

echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "Building..."
npm run build

INTEGRATIONS_PATH="$REPO_ROOT/about-me/integrations.json"
INTEGRATIONS_EXAMPLE_PATH="$REPO_ROOT/about-me/integrations.example.json"
if [ ! -f "$INTEGRATIONS_PATH" ]; then
  cp "$INTEGRATIONS_EXAMPLE_PATH" "$INTEGRATIONS_PATH"
  echo ""
  echo "Created about-me/integrations.json - edit it to set your dashboard PIN and (optionally) eBay/Gmail API credentials."
fi

# --- Wire up Claude Desktop config ---
CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_CONFIG_PATH="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
SERVER_ENTRY="$REPO_ROOT/dist/pc/mcp-server/index.js"

mkdir -p "$CLAUDE_CONFIG_DIR"

CLAUDE_CONFIG_PATH="$CLAUDE_CONFIG_PATH" SERVER_ENTRY="$SERVER_ENTRY" node -e "
const fs = require('fs');
const configPath = process.env.CLAUDE_CONFIG_PATH;
const serverEntry = process.env.SERVER_ENTRY;
let config = {};
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { config = {}; }
}
config.mcpServers = config.mcpServers || {};
config.mcpServers['resale-command-center'] = { command: 'node', args: [serverEntry] };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Registered MCP server in ' + configPath);
"

# --- Register background daemon (runs the web dashboard, auto-starts hidden at login) ---
echo ""
echo "Registering background daemon (web dashboard)..."
node "$REPO_ROOT/dist/pc/daemon/installer.js"

echo ""
echo "Done!"
echo "- Restart Claude Desktop to pick up the new MCP server."
echo "- The web dashboard auto-starts at login (default http://localhost:4173)."
echo "- Install Tailscale (tailscale.com) on this Mac and your phone to reach the dashboard from anywhere."
echo "- Edit about-me/integrations.json to set your PIN and any eBay/Gmail API credentials."
