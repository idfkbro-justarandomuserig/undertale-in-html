export const DEFAULT_PLATFORM_FEES: Record<string, number> = {
  ebay: 13.25,
  depop: 10,
  mercari: 10,
  facebook_marketplace: 5,
  poshmark: 20,
};

export function normalizePlatform(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function getPlatformFeePct(
  platform: string | null | undefined,
  overrides: Record<string, number> = {},
): number {
  if (!platform) return 0;
  const key = normalizePlatform(platform);
  return overrides[key] ?? DEFAULT_PLATFORM_FEES[key] ?? 0;
}
