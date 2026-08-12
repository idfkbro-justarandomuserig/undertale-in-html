export interface MarginInput {
  acquisitionCost: number;
  sellPrice: number;
  platformFeePct: number;
  shippingCost: number;
}

export interface MarginResult {
  grossRevenue: number;
  platformFee: number;
  shippingCost: number;
  totalCost: number;
  netProfit: number;
  roiPct: number;
  marginPct: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeMargin(input: MarginInput): MarginResult {
  const acquisitionCost = input.acquisitionCost ?? 0;
  const sellPrice = input.sellPrice ?? 0;
  const platformFeePct = input.platformFeePct ?? 0;
  const shippingCost = input.shippingCost ?? 0;

  const platformFee = round2(sellPrice * (platformFeePct / 100));
  const totalCost = round2(acquisitionCost + platformFee + shippingCost);
  const netProfit = round2(sellPrice - totalCost);
  const roiPct = acquisitionCost > 0 ? round2((netProfit / acquisitionCost) * 100) : 0;
  const marginPct = sellPrice > 0 ? round2((netProfit / sellPrice) * 100) : 0;

  return {
    grossRevenue: round2(sellPrice),
    platformFee,
    shippingCost: round2(shippingCost),
    totalCost,
    netProfit,
    roiPct,
    marginPct,
  };
}
