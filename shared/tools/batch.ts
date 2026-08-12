import type Database from 'better-sqlite3';

export type BatchAction = 'mark_sold' | 'update_price' | 'update_category' | 'update_platform' | 'delist';

export interface BatchPayload {
  soldPrice?: number;
  platform?: string;
  priceDelta?: number;
  priceMultiplier?: number;
  newPrice?: number;
  newCategory?: string;
}

export interface BatchExecuteInput {
  action: BatchAction;
  ids?: number[];
  category?: string;
  payload?: BatchPayload;
}

const VALID_ACTIONS: BatchAction[] = ['mark_sold', 'update_price', 'update_category', 'update_platform', 'delist'];

export function bulkBatchExecute(db: Database.Database, input: BatchExecuteInput) {
  const { action, ids, category, payload = {} } = input;

  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`Invalid action "${action}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
  }

  const targetIds = ids && ids.length > 0
    ? ids
    : category
      ? (db.prepare('SELECT id FROM inventory WHERE category = ?').all(category) as { id: number }[]).map((r) => r.id)
      : [];

  if (targetIds.length === 0) {
    return { updatedCount: 0, ids: [] as number[] };
  }

  const placeholders = targetIds.map(() => '?').join(',');

  const exec = db.transaction(() => {
    switch (action) {
      case 'mark_sold': {
        db.prepare(
          `UPDATE inventory SET status = 'sold', sold_price = COALESCE(?, listing_price), platform = COALESCE(?, platform), sold_at = datetime('now'), updated_at = datetime('now') WHERE id IN (${placeholders})`,
        ).run(payload.soldPrice ?? null, payload.platform ?? null, ...targetIds);
        break;
      }
      case 'update_price': {
        if (payload.newPrice != null) {
          db.prepare(`UPDATE inventory SET listing_price = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(payload.newPrice, ...targetIds);
        } else if (payload.priceMultiplier != null) {
          db.prepare(`UPDATE inventory SET listing_price = ROUND(listing_price * ?, 2), updated_at = datetime('now') WHERE id IN (${placeholders})`).run(payload.priceMultiplier, ...targetIds);
        } else if (payload.priceDelta != null) {
          db.prepare(`UPDATE inventory SET listing_price = ROUND(listing_price + ?, 2), updated_at = datetime('now') WHERE id IN (${placeholders})`).run(payload.priceDelta, ...targetIds);
        } else {
          throw new Error('update_price requires one of payload.newPrice, payload.priceMultiplier, or payload.priceDelta.');
        }
        break;
      }
      case 'update_category': {
        db.prepare(`UPDATE inventory SET category = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(payload.newCategory ?? null, ...targetIds);
        break;
      }
      case 'update_platform': {
        db.prepare(`UPDATE inventory SET platform = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(payload.platform ?? null, ...targetIds);
        break;
      }
      case 'delist': {
        db.prepare(`UPDATE inventory SET status = 'delisted', updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...targetIds);
        break;
      }
    }
  });

  exec();
  return { updatedCount: targetIds.length, ids: targetIds };
}
