import type Database from 'better-sqlite3';
import { parseShippingNotification } from '../lib/parser.js';

const STATUS_FLOW = ['Unshipped', 'Label Created', 'In Transit', 'Delivered'];

export interface IngestShippingInput {
  rawText: string;
  sku?: string;
  status?: string;
}

export function ingestShippingNotification(db: Database.Database, input: IngestShippingInput) {
  if (!input.rawText || typeof input.rawText !== 'string') {
    throw new Error('ingest_shipping_notification requires a non-empty "rawText" string.');
  }

  const parsed = parseShippingNotification(input.rawText);

  let inventoryId: number | null = null;
  const sku = input.sku ?? null;
  if (sku) {
    const row = db.prepare('SELECT id FROM inventory WHERE sku = ?').get(sku) as { id: number } | undefined;
    if (row) inventoryId = row.id;
  }

  const status = input.status ?? (parsed.trackingNumber ? 'Label Created' : 'Unshipped');
  if (!STATUS_FLOW.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${STATUS_FLOW.join(', ')}`);
  }

  let shipmentId: number;

  if (parsed.trackingNumber) {
    const existing = db.prepare('SELECT id FROM shipments WHERE tracking_number = ?').get(parsed.trackingNumber) as { id: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE shipments SET status = ?, sku = COALESCE(?, sku), inventory_id = COALESCE(?, inventory_id), raw_notification = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(status, sku, inventoryId, input.rawText, existing.id);
      shipmentId = existing.id;
    } else {
      const info = db.prepare(`
        INSERT INTO shipments (inventory_id, sku, tracking_number, carrier, buyer_alias, platform, status, raw_notification)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(inventoryId, sku, parsed.trackingNumber, parsed.carrier, parsed.buyerAlias, parsed.platform, status, input.rawText);
      shipmentId = Number(info.lastInsertRowid);
    }
  } else {
    const info = db.prepare(`
      INSERT INTO shipments (inventory_id, sku, tracking_number, carrier, buyer_alias, platform, status, raw_notification)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
    `).run(inventoryId, sku, parsed.carrier, parsed.buyerAlias, parsed.platform, status, input.rawText);
    shipmentId = Number(info.lastInsertRowid);
  }

  if (inventoryId) {
    db.prepare(`UPDATE inventory SET updated_at = datetime('now') WHERE id = ?`).run(inventoryId);
  }

  return { shipmentId, parsed, status, matchedInventoryId: inventoryId };
}
