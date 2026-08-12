import type Database from 'better-sqlite3';
import { parseShippingNotification } from '../lib/parser.js';

export const STATUS_FLOW = ['Unshipped', 'Label Created', 'In Transit', 'Delivered'];

export interface ShipmentRecordInput {
  trackingNumber: string | null;
  carrier: string | null;
  buyerAlias: string | null;
  platform: string | null;
  sku: string | null;
  status: string;
  rawNotification: string;
}

export interface IngestShippingInput {
  rawText: string;
  sku?: string;
  status?: string;
}

/**
 * Shared upsert used by both the raw-text parser (ingestShippingNotification)
 * and structured integrations (eBay API, Gmail-parsed messages) so every
 * ingestion path funnels through the same dedupe-by-tracking-number logic.
 */
export function upsertShipmentRecord(db: Database.Database, input: ShipmentRecordInput) {
  if (!STATUS_FLOW.includes(input.status)) {
    throw new Error(`Invalid status "${input.status}". Must be one of: ${STATUS_FLOW.join(', ')}`);
  }

  let inventoryId: number | null = null;
  if (input.sku) {
    const row = db.prepare('SELECT id FROM inventory WHERE sku = ?').get(input.sku) as { id: number } | undefined;
    if (row) inventoryId = row.id;
  }

  let shipmentId: number;

  if (input.trackingNumber) {
    const existing = db.prepare('SELECT id FROM shipments WHERE tracking_number = ?').get(input.trackingNumber) as { id: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE shipments SET status = ?, sku = COALESCE(?, sku), inventory_id = COALESCE(?, inventory_id), carrier = COALESCE(?, carrier), buyer_alias = COALESCE(?, buyer_alias), platform = COALESCE(?, platform), raw_notification = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(input.status, input.sku, inventoryId, input.carrier, input.buyerAlias, input.platform, input.rawNotification, existing.id);
      shipmentId = existing.id;
    } else {
      const info = db.prepare(`
        INSERT INTO shipments (inventory_id, sku, tracking_number, carrier, buyer_alias, platform, status, raw_notification)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(inventoryId, input.sku, input.trackingNumber, input.carrier, input.buyerAlias, input.platform, input.status, input.rawNotification);
      shipmentId = Number(info.lastInsertRowid);
    }
  } else {
    const info = db.prepare(`
      INSERT INTO shipments (inventory_id, sku, tracking_number, carrier, buyer_alias, platform, status, raw_notification)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
    `).run(inventoryId, input.sku, input.carrier, input.buyerAlias, input.platform, input.status, input.rawNotification);
    shipmentId = Number(info.lastInsertRowid);
  }

  if (inventoryId) {
    db.prepare(`UPDATE inventory SET updated_at = datetime('now') WHERE id = ?`).run(inventoryId);
  }

  return { shipmentId, matchedInventoryId: inventoryId };
}

export function ingestShippingNotification(db: Database.Database, input: IngestShippingInput) {
  if (!input.rawText || typeof input.rawText !== 'string') {
    throw new Error('ingest_shipping_notification requires a non-empty "rawText" string.');
  }

  const parsed = parseShippingNotification(input.rawText);
  const sku = input.sku ?? null;
  const status = input.status ?? (parsed.trackingNumber ? 'Label Created' : 'Unshipped');

  const { shipmentId, matchedInventoryId } = upsertShipmentRecord(db, {
    trackingNumber: parsed.trackingNumber,
    carrier: parsed.carrier,
    buyerAlias: parsed.buyerAlias,
    platform: parsed.platform,
    sku,
    status,
    rawNotification: input.rawText,
  });

  return { shipmentId, parsed, status, matchedInventoryId };
}

export function listShipments(db: Database.Database, limit = 100) {
  return db.prepare('SELECT * FROM shipments ORDER BY updated_at DESC LIMIT ?').all(limit);
}
