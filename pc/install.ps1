#requires -Version 5.1
# One-click installer for Windows: installs deps, builds, wires the MCP server
# into Claude Desktop's config, and registers the background web-dashboard
# daemon to auto-start hidden at login.
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Write-Host "Resale Command Center installer" -ForegroundColor Cyan
Write-Host "Repo root: $RepoRoot"

function Test-CommandExists($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists 'node')) {
  Write-Host "Node.js not found." -ForegroundColor Yellow
  if (Test-CommandExists 'winget') {
    Write-Host "Installing Node.js LTS via winget..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  } else {
    Write-Error "Node.js is required. Install it from https://nodejs.org and re-run this script."
    exit 1
  }
}

Set-Location $RepoRoot

Write-Host "`nInstalling dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed"; exit 1 }

Write-Host "`nBuilding..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "npm run build failed"; exit 1 }

$IntegrationsPath = Join-Path $RepoRoot 'about-me\integrations.json'
$IntegrationsExamplePath = Join-Path $RepoRoot 'about-me\integrations.example.json'
if (-not (Test-Path $IntegrationsPath)) {
  Copy-Item $IntegrationsExamplePath $IntegrationsPath
  Write-Host "`nCreated about-me\integrations.json - edit it to set your dashboard PIN and (optionally) eBay/Gmail API credentials." -ForegroundColor Yellow
}

# --- Wire up Claude Desktop config (PSCustomObject, not hashtable, so this works on Windows PowerShell 5.1 too) ---
$ClaudeConfigDir = Join-Path $env:APPDATA 'Claude'
$ClaudeConfigPath = Join-Path $ClaudeConfigDir 'claude_desktop_config.json'
$ServerEntry = Join-Path $RepoRoot 'dist\pc\mcp-server\index.js'

New-Item -ItemType Directory -Force -Path $ClaudeConfigDir | Out-Null

$config = $null
if (Test-Path $ClaudeConfigPath) {
  try { $config = Get-Content $ClaudeConfigPath -Raw | ConvertFrom-Json } catch { $config = $null }
}
if (-not $config) { $config = New-Object PSObject }

if (-not ($config.PSObject.Properties.Name -contains 'mcpServers')) {
  $config | Add-Member -MemberType NoteProperty -Name 'mcpServers' -Value (New-Object PSObject)
}

$newServer = [PSCustomObject]@{ command = 'node'; args = @($ServerEntry) }

if ($config.mcpServers.PSObject.Properties.Name -contains 'resale-command-center') {
  $config.mcpServers.'resale-command-center' = $newServer
} else {
  $config.mcpServers | Add-Member -MemberType NoteProperty -Name 'resale-command-center' -Value $newServer
}

$config | ConvertTo-Json -Depth 10 | Set-Content -Path $ClaudeConfigPath -Encoding UTF8
Write-Host "`nRegistered MCP server in $ClaudeConfigPath" -ForegroundColor Green

# --- Register background daemon (runs the web dashboard, auto-starts hidden at login) ---
Write-Host "`nRegistering background daemon (web dashboard)..." -ForegroundColor Cyan
node (Join-Path $RepoRoot 'dist\pc\daemon\installer.js')

Write-Host "`nDone!" -ForegroundColor Green
Write-Host "- Restart Claude Desktop to pick up the new MCP server."
Write-Host "- The web dashboard auto-starts at login (default http://localhost:4173)."
Write-Host "- Install Tailscale (tailscale.com) on this PC and your phone to reach the dashboard from anywhere."
Write-Host "- Edit about-me\integrations.json to set your PIN and any eBay/Gmail API credentials."
