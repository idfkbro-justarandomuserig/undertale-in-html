import type Database from 'better-sqlite3';
import { computeMargin, round2 } from '../lib/margin.js';
import { getPlatformFeePct } from '../lib/platforms.js';
import type { Preferences } from '../lib/preferences.js';

export interface InventoryFilters {
  status?: string;
  platform?: string;
  category?: string;
}

export interface InventoryItemInput {
  sku?: string;
  name: string;
  category?: string;
  platform?: string;
  acquisitionCost: number;
  listingPrice?: number;
  platformFeePct?: number;
  shippingCost?: number;
  quantity?: number;
  notes?: string;
}

interface InventoryRow {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  platform: string | null;
  status: string;
  acquisition_cost: number;
  listing_price: number | null;
  sold_price: number | null;
  platform_fee_pct: number | null;
  shipping_cost: number;
  quantity: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
}

export function getInventoryStatus(db: Database.Database, prefs: Preferences, filters: InventoryFilters = {}) {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.status) {
    clauses.push('status = @status');
    params.status = filters.status;
  }
  if (filters.platform) {
    clauses.push('platform = @platform');
    params.platform = filters.platform;
  }
  if (filters.category) {
    clauses.push('category = @category');
    params.category = filters.category;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM inventory ${where} ORDER BY updated_at DESC`).all(params) as InventoryRow[];

  const items = rows.map((row) => {
    const feePct = row.platform_fee_pct ?? getPlatformFeePct(row.platform, prefs.platformFeeOverridesPct);
    const sellPrice = row.status === 'sold' ? row.sold_price : row.listing_price;
    const margin = sellPrice != null
      ? computeMargin({
        acquisitionCost: row.acquisition_cost,
        sellPrice,
        platformFeePct: feePct,
        shippingCost: row.shipping_cost ?? 0,
      })
      : null;
    return { ...row, computedFeePct: feePct, margin };
  });

  const summary = {
    totalItems: items.length,
    totalAcquisitionCost: round2(items.reduce((s, i) => s + (i.acquisition_cost ?? 0), 0)),
    totalNetProfit: round2(items.reduce((s, i) => s + (i.margin?.netProfit ?? 0), 0)),
    soldCount: items.filter((i) => i.status === 'sold').length,
    activeCount: items.filter((i) => i.status === 'active').length,
  };

  return { items, summary };
}

function generateSku(): string {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
}

export function bulkAddInventory(db: Database.Database, items: InventoryItemInput[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('bulk_add_inventory requires a non-empty "items" array.');
  }
  for (const item of items) {
    if (!item.name || typeof item.acquisitionCost !== 'number') {
      throw new Error(`Each item requires "name" (string) and "acquisitionCost" (number). Got: ${JSON.stringify(item)}`);
    }
  }

  const insert = db.prepare(`
    INSERT INTO inventory (sku, name, category, platform, acquisition_cost, listing_price, platform_fee_pct, shipping_cost, quantity, notes)
    VALUES (@sku, @name, @category, @platform, @acquisitionCost, @listingPrice, @platformFeePct, @shippingCost, @quantity, @notes)
  `);

  const insertMany = db.transaction((rows: InventoryItemInput[]) => {
    const ids: number[] = [];
    for (const item of rows) {
      const info = insert.run({
        sku: item.sku ?? generateSku(),
        name: item.name,
        category: item.category ?? null,
        platform: item.platform ?? null,
        acquisitionCost: item.acquisitionCost,
        listingPrice: item.listingPrice ?? null,
        platformFeePct: item.platformFeePct ?? null,
        shippingCost: item.shippingCost ?? 0,
        quantity: item.quantity ?? 1,
        notes: item.notes ?? null,
      });
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  });

  const ids = insertMany(items);
  return { insertedCount: ids.length, ids };
}
