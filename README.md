# Resale Command Center

A local-first system for tracking resale inventory, margins, stock holdings, and
shipping — usable from **Claude Cowork/Desktop** (via MCP), from **any browser**
(web dashboard), and from **your phone** (installable PWA or a native Android
APK), all backed by one SQLite database on your PC.

```
shared/     Business logic + DB schema, used by both the MCP server and the web server
pc/         MCP server (stdio, for Claude Desktop) + background daemon + Windows/macOS installers
web/        Express REST API + mobile-first dashboard frontend (PWA)
phone/      Capacitor Android project — wraps the web dashboard into an installable APK
about-me/   Preferences (fees/margin targets) + integrations.json (your API credentials, gitignored)
data/       SQLite database + OAuth tokens (all gitignored)
logs/       Daemon heartbeat/error logs
```

---

## 1. PC setup (Windows or macOS)

**One-click:**
```bash
git clone https://github.com/idfkbro-justarandomuserig/undertale-in-html.git
cd undertale-in-html
git checkout claude/repo-wipe-tip9ef
```
- **Windows**: right-click `pc/install.ps1` → Run with PowerShell (or `powershell -ExecutionPolicy Bypass -File pc\install.ps1`)
- **macOS**: `bash pc/install.sh`

Either script: checks/installs Node.js, runs `npm install` + `npm run build`,
creates `about-me/integrations.json` from the template, registers the MCP
server in Claude Desktop's config, and registers the background daemon to
auto-start hidden at login.

**Manually**, the same steps are:
```bash
npm install
npm run build
cp about-me/integrations.example.json about-me/integrations.json   # then edit it
npm run install-daemon
```

### Wiring into Claude Desktop
The installers do this automatically, or add it yourself to
`claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows,
`~/Library/Application Support/Claude/` on macOS):
```json
{
  "mcpServers": {
    "resale-command-center": {
      "command": "node",
      "args": ["/absolute/path/to/dist/pc/mcp-server/index.js"]
    }
  }
}
```
Claude Desktop spawns this process itself per session over stdio — that's
inherent to how MCP's stdio transport works, and it's separate from the
daemon below.

### The background daemon
`pc/daemon/daemon.ts` supervises the **web dashboard server** (not the MCP
server — Claude Desktop already manages that one's lifecycle). It restarts
the dashboard with backoff if it crashes and logs heartbeats to `logs/`.
`npm run install-daemon` registers it as a Windows Scheduled Task (hidden
PowerShell launch at logon) or a macOS LaunchAgent (`RunAtLoad` +
`KeepAlive`).

---

## 2. Web dashboard (works from any browser, including your phone)

Set your PIN and port in `about-me/integrations.json`:
```json
{ "web": { "pin": "1234", "port": 4173 } }
```

Once the daemon is running, the dashboard is at `http://localhost:4173` (or
your PC's LAN IP). To reach it from your phone from anywhere:

1. Install [Tailscale](https://tailscale.com) on your PC and your phone, same account on both.
2. Open `http://<your-pc-tailscale-name>:4173` from your phone's browser.
3. Enter your PIN. "Add to Home Screen" — it's a PWA, so it installs like a real app icon.

Tailscale keeps this off the public internet entirely — it's a private
WireGuard tunnel directly to your PC.

---

## 3. Phone app (Android APK)

This sandbox can't build the APK directly — it has no Android SDK and its
outbound proxy blocks Google's Maven repo (`dl.google.com` returns 403).
GitHub Actions runners have the Android SDK preinstalled and unrestricted
internet, so that's where the actual build happens:

- `.github/workflows/build-apk.yml` builds a debug APK on every push to
  `phone/**` (or manually via the Actions tab → "Build Android APK" → Run
  workflow).
- Download the `resale-dashboard-debug-apk` artifact from the completed run,
  copy it to your phone, and install it (enable "install from unknown
  sources" for your file manager/browser once).

Before building, point it at your PC: edit `phone/capacitor.config.json`'s
`server.url` to your Tailscale address, e.g.
`"url": "http://your-pc.tailnet-name.ts.net:4173"`, commit, push. The app is
a thin native wrapper — it just opens that address in a full-screen WebView,
so it's really the same dashboard, packaged as an app icon.

To build locally instead (needs Android Studio / SDK on your own machine):
```bash
cd phone
npm install
npx cap sync android
npx cap open android   # or: cd android && ./gradlew assembleDebug
```

---

## 4. Auto-importing shipping notifications

Manual paste-in always works (Shipping tab → paste text → Parse & save). Two
platforms support real automation on top of that:

### eBay (direct API — full automation)
eBay has an official OAuth2 API for reading your orders/tracking. Set it up:
1. [developer.ebay.com](https://developer.ebay.com) → sign in → Application Keys → create a **production** keyset.
2. Put `clientId`/`clientSecret` into `about-me/integrations.json` under `ebay`.
3. In the dashboard's Shipping tab, tap **Connect** next to eBay, approve access.
4. It syncs automatically every `gmail.pollIntervalMinutes` (default 10) from then on, or tap **Sync now**.

Scope used is read-only (`sell.fulfillment.readonly`) — this never creates,
edits, or cancels anything on eBay, it only reads order/tracking data.

### Mercari / Depop / Facebook Marketplace / Poshmark (via email)
None of these offer a public seller API, and Poshmark's terms explicitly
prohibit third-party automation tools — so this isn't a scraper. Instead, since
these platforms already email you when something ships, connecting Gmail lets
the dashboard read those notification emails automatically and run them
through the same parser as manual paste:
1. [console.cloud.google.com](https://console.cloud.google.com) → new project → enable **Gmail API**.
2. OAuth consent screen: External, Testing mode is fine for personal use.
3. Credentials → OAuth Client ID → **Web application** → add
   `http://localhost:4173/api/gmail/callback` as an authorized redirect URI.
4. Put `clientId`/`clientSecret` into `about-me/integrations.json` under `gmail`.
5. Shipping tab → **Connect** next to Gmail, approve access (read-only Gmail scope).

It polls for new shipping emails from those senders on the same interval.

**Never commit `about-me/integrations.json`** — it holds real secrets and PIN.
It's gitignored; only `integrations.example.json` (a template) is tracked.

---

## 5. MCP Tools (exposed to Claude Cowork/Desktop)

### `get_inventory_status`
Filters: `status` (active/sold/delisted), `platform`, `category`. Returns each
item with computed margin (gross revenue, platform fee, shipping, net profit,
ROI %, margin %) plus a portfolio-wide summary.

### `bulk_add_inventory`
`{ items: [{ name, acquisitionCost, sku?, category?, platform?, listingPrice?,
platformFeePct?, shippingCost?, quantity?, notes? }, ...] }` — inserts hundreds
of rows in one atomic transaction. SKU auto-generated if omitted.

### `bulk_batch_execute`
`{ action, ids?, category?, payload? }` — `action` is one of `mark_sold`,
`update_price`, `update_category`, `update_platform`, `delist`. Targets items
by `ids`, or every item in `category` if `ids` is omitted. `update_price`
supports `payload.newPrice`, `payload.priceMultiplier`, or `payload.priceDelta`.

### `sync_stock_portfolio`
`{ updates: [{ ticker, quantity?, avgCostBasis?, currentPrice? }, ...] }` —
upserts holdings, returns the full portfolio with market value, cost basis,
gain/loss, and gain/loss %.

### `ingest_shipping_notification`
`{ rawText, sku?, status? }` — regex-parses tracking number (USPS/UPS/FedEx/DHL),
carrier, buyer alias, and source platform out of a raw notification/clipboard
dump. Same function the eBay/Gmail integrations and the web dashboard use.

---

## 6. Database

SQLite via `better-sqlite3`, WAL mode, foreign keys on. Tables: `inventory`,
`stocks`, `shipments`. Schema in `shared/db.ts`.

## 7. Development

```bash
npm run build       # compile shared/ + pc/ + web/server to dist/
npm run dev:mcp      # run the MCP server directly with tsx
npm run dev:web       # run the web server directly with tsx
```
