import type Database from 'better-sqlite3';
import { round2 } from '../lib/margin.js';

export interface StockUpdateInput {
  ticker: string;
  quantity?: number;
  avgCostBasis?: number;
  currentPrice?: number;
}

interface StockRow {
  id: number;
  ticker: string;
  quantity: number;
  avg_cost_basis: number;
  current_price: number;
  last_updated: string;
  created_at: string;
}

export function syncStockPortfolio(db: Database.Database, updates: StockUpdateInput[]) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('sync_stock_portfolio requires a non-empty "updates" array.');
  }
  for (const u of updates) {
    if (!u.ticker) {
      throw new Error(`Each update requires a "ticker". Got: ${JSON.stringify(u)}`);
    }
  }

  const upsert = db.prepare(`
    INSERT INTO stocks (ticker, quantity, avg_cost_basis, current_price, last_updated)
    VALUES (@ticker, @quantity, @avgCostBasis, @currentPrice, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      quantity = COALESCE(@quantity, quantity),
      avg_cost_basis = COALESCE(@avgCostBasis, avg_cost_basis),
      current_price = COALESCE(@currentPrice, current_price),
      last_updated = datetime('now')
  `);

  const run = db.transaction((rows: StockUpdateInput[]) => {
    for (const row of rows) {
      upsert.run({
        ticker: row.ticker.toUpperCase(),
        quantity: row.quantity ?? null,
        avgCostBasis: row.avgCostBasis ?? null,
        currentPrice: row.currentPrice ?? null,
      });
    }
  });
  run(updates);

  const rows = db.prepare('SELECT * FROM stocks ORDER BY ticker').all() as StockRow[];
  const portfolio = rows.map((r) => {
    const marketValue = round2(r.quantity * r.current_price);
    const costValue = round2(r.quantity * r.avg_cost_basis);
    const gainLoss = round2(marketValue - costValue);
    const gainLossPct = costValue > 0 ? round2((gainLoss / costValue) * 100) : 0;
    return { ...r, marketValue, costValue, gainLoss, gainLossPct };
  });

  const summary = {
    totalMarketValue: round2(portfolio.reduce((s, r) => s + r.marketValue, 0)),
    totalCostValue: round2(portfolio.reduce((s, r) => s + r.costValue, 0)),
    totalGainLoss: round2(portfolio.reduce((s, r) => s + r.gainLoss, 0)),
  };

  return { portfolio, summary };
}
