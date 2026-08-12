#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { openDatabase } from './db.js';
import { loadPreferences } from './lib/preferences.js';
import { appendHeartbeat, logError } from './lib/log.js';
import { getInventoryStatus, bulkAddInventory } from './tools/inventory.js';
import { bulkBatchExecute } from './tools/batch.js';
import { syncStockPortfolio } from './tools/stocks.js';
import { ingestShippingNotification } from './tools/shipping.js';

const db = openDatabase();
const prefs = loadPreferences();

const server = new Server(
  { name: 'resale-command-center', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'get_inventory_status',
    description:
      'Get inventory items with computed margin/profit/ROI, optionally filtered by status, platform, or category.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: active, sold, delisted' },
        platform: { type: 'string', description: 'Filter by platform: ebay, depop, mercari, facebook_marketplace, poshmark' },
        category: { type: 'string', description: 'Filter by category' },
      },
    },
  },
  {
    name: 'bulk_add_inventory',
    description:
      'Bulk-ingest an array of inventory items in a single atomic transaction. Handles hundreds of items at once.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', description: 'Optional; auto-generated if omitted' },
              name: { type: 'string' },
              category: { type: 'string' },
              platform: { type: 'string' },
              acquisitionCost: { type: 'number' },
              listingPrice: { type: 'number' },
              platformFeePct: { type: 'number', description: 'Overrides the platform default fee percentage' },
              shippingCost: { type: 'number' },
              quantity: { type: 'number' },
              notes: { type: 'string' },
            },
            required: ['name', 'acquisitionCost'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'bulk_batch_execute',
    description:
      'Execute a batch action across multiple inventory items selected by id or by category: mark_sold, update_price, update_category, update_platform, or delist.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['mark_sold', 'update_price', 'update_category', 'update_platform', 'delist'],
        },
        ids: { type: 'array', items: { type: 'number' }, description: 'Inventory item ids to target' },
        category: { type: 'string', description: 'Target all items in this category (used if ids is omitted)' },
        payload: {
          type: 'object',
          description: 'Action-specific parameters',
          properties: {
            soldPrice: { type: 'number', description: 'For mark_sold; defaults to current listing_price' },
            platform: { type: 'string', description: 'For mark_sold or update_platform' },
            priceDelta: { type: 'number', description: 'For update_price: add this amount to listing_price' },
            priceMultiplier: { type: 'number', description: 'For update_price: multiply listing_price by this factor' },
            newPrice: { type: 'number', description: 'For update_price: set listing_price to this exact value' },
            newCategory: { type: 'string', description: 'For update_category' },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'sync_stock_portfolio',
    description:
      'Upsert stock holdings (ticker, quantity, cost basis, current price) and return computed portfolio performance (market value, gain/loss, gain/loss %).',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ticker: { type: 'string' },
              quantity: { type: 'number' },
              avgCostBasis: { type: 'number' },
              currentPrice: { type: 'number' },
            },
            required: ['ticker'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'ingest_shipping_notification',
    description:
      'Parse a raw shipping/notification text dump (from eBay, Mercari, Depop, Facebook Marketplace, Poshmark, etc.) to extract tracking number, carrier, buyer alias, and platform. Auto-binds to a matching inventory SKU and updates fulfillment status (Unshipped -> Label Created -> In Transit -> Delivered).',
    inputSchema: {
      type: 'object',
      properties: {
        rawText: { type: 'string', description: 'The raw notification text or clipboard dump' },
        sku: { type: 'string', description: 'Inventory SKU to associate this shipment with' },
        status: { type: 'string', enum: ['Unshipped', 'Label Created', 'In Transit', 'Delivered'] },
      },
      required: ['rawText'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    let result: unknown;
    switch (name) {
      case 'get_inventory_status':
        result = getInventoryStatus(db, prefs, args as Parameters<typeof getInventoryStatus>[2]);
        break;
      case 'bulk_add_inventory':
        result = bulkAddInventory(db, (args as { items: Parameters<typeof bulkAddInventory>[1] }).items);
        break;
      case 'bulk_batch_execute':
        result = bulkBatchExecute(db, args as unknown as Parameters<typeof bulkBatchExecute>[1]);
        break;
      case 'sync_stock_portfolio':
        result = syncStockPortfolio(db, (args as { updates: Parameters<typeof syncStockPortfolio>[1] }).updates);
        break;
      case 'ingest_shipping_notification':
        result = ingestShippingNotification(db, args as unknown as Parameters<typeof ingestShippingNotification>[1]);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    logError(err);
    return {
      content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  appendHeartbeat('mcp-server started');
}

main().catch((err) => {
  logError(err);
  process.exit(1);
});
