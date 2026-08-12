# Resale MCP Command Center

A local Model Context Protocol (MCP) server that gives **Claude Cowork / Claude Desktop**
direct, tool-based access to a SQLite-backed resale inventory and stock portfolio ledger:
margin/profit calculations, bulk import, batch multi-item operations, and shipping
notification parsing. Includes an optional background daemon that keeps itself running
and auto-starts at login on Windows and macOS.

## Directory layout

```
about-me/     User preferences: target margin %, per-platform fee overrides
outputs/      Generated reports / exports land here
data/         SQLite database (resale.db), created on first run
logs/         Daemon heartbeat.log, daemon.log, error.log
src/mcp-server/   The MCP server (tools, DB, business logic)
src/daemon/       Background supervisor + OS auto-start installers
```

## Setup

```bash
npm install
npm run build
```

This compiles TypeScript to `dist/`. `data/resale.db` is created automatically the
first time the server runs (WAL mode, foreign keys on).

## Wiring it into Claude Desktop

MCP's stdio transport is spawned per-session by the client — Claude Desktop launches
the server process itself and talks to it over its stdin/stdout. Add this to your
Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "resale-command-center": {
      "command": "node",
      "args": ["/absolute/path/to/dist/mcp-server/index.js"]
    }
  }
}
```

Restart Claude Desktop and the five tools below become available.

### A note on the background daemon vs. stdio

Because stdio is owned by whichever process spawns it, a separate OS-boot daemon can't
literally share Claude Desktop's stdio pipe — that's inherent to the transport, not a
bug here. `src/daemon/daemon.ts` is a **supervisor**: it spawns the compiled MCP server
as a child process with inherited stdio, restarts it with backoff if it crashes, and
writes heartbeats/errors to `logs/`. Point the OS auto-start entry at the daemon
(`dist/daemon/daemon.js`) if you want a persistent, self-healing process running
independent of whether Claude Desktop is open; point Claude Desktop's own config at
`dist/mcp-server/index.js` directly (as above) for the standard, guaranteed-to-work
per-session connection. Both can coexist — the daemon is for resilience/logging, not a
requirement for Claude Desktop to function.

## Background daemon & auto-start

```bash
npm run build
npm run install-daemon
```

`install-daemon` detects your OS and registers the daemon to start hidden at login:

- **Windows** — writes `start-daemon.bat` (launches Node via
  `powershell -WindowStyle Hidden`) and registers it with Task Scheduler
  (`schtasks /Create /SC ONLOGON`). Remove with
  `schtasks /Delete /TN ResaleMCPDaemon /F`.
- **macOS** — writes `~/Library/LaunchAgents/com.resale.mcp.plist`
  (`RunAtLoad=true`, `KeepAlive=true`) and loads it with `launchctl load`.
  Remove with `launchctl unload ~/Library/LaunchAgents/com.resale.mcp.plist && rm` it.

Run the daemon manually at any time with `npm run start:daemon`, or run the bare
server with `npm start`.

## Preferences (`about-me/preferences.json`)

```json
{
  "targetMarginPct": 30,
  "platformFeeOverridesPct": {
    "ebay": 13.25,
    "depop": 10,
    "mercari": 10,
    "facebook_marketplace": 5,
    "poshmark": 20
  }
}
```

Per-item `platformFeePct` (set via `bulk_add_inventory`) always wins; otherwise the
per-platform override here is used; otherwise a built-in default.

## MCP Tools

### `get_inventory_status`
Filters: `status` (active/sold/delisted), `platform`, `category`. Returns each item
with computed margin (gross revenue, platform fee, shipping, net profit, ROI %,
margin %) plus a portfolio-wide summary.

### `bulk_add_inventory`
`{ items: [{ name, acquisitionCost, sku?, category?, platform?, listingPrice?,
platformFeePct?, shippingCost?, quantity?, notes? }, ...] }` — inserts hundreds of
rows in one atomic transaction. SKU auto-generated if omitted.

### `bulk_batch_execute`
`{ action, ids?, category?, payload? }` — `action` is one of `mark_sold`,
`update_price`, `update_category`, `update_platform`, `delist`. Targets items by
`ids` or, if omitted, every item in `category`. `update_price` supports
`payload.newPrice`, `payload.priceMultiplier`, or `payload.priceDelta`.

### `sync_stock_portfolio`
`{ updates: [{ ticker, quantity?, avgCostBasis?, currentPrice? }, ...] }` — upserts
holdings and returns the full portfolio with market value, cost basis, gain/loss,
and gain/loss %.

### `ingest_shipping_notification`
`{ rawText, sku?, status? }` — regex-parses tracking number (USPS/UPS/FedEx/DHL),
carrier, buyer alias, and source platform out of a raw notification/clipboard dump.
Upserts a shipment row keyed on tracking number, links it to `sku` if given, and
advances fulfillment status through `Unshipped -> Label Created -> In Transit ->
Delivered`.

## Database

SQLite via `better-sqlite3`, WAL mode, foreign keys on. Tables: `inventory`,
`stocks`, `shipments`. See `src/mcp-server/db.ts` for the schema.

## Development

```bash
npm run dev     # run the server directly with tsx, no build step
npm run build   # compile to dist/
```
