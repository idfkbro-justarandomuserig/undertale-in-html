export type Carrier = 'USPS' | 'UPS' | 'FedEx' | 'DHL';

export interface ParsedShipment {
  trackingNumber: string | null;
  carrier: Carrier | null;
  buyerAlias: string | null;
  platform: string | null;
}

// Order matters: more specific/unambiguous formats first.
const CARRIER_PATTERNS: { carrier: Carrier; regex: RegExp }[] = [
  { carrier: 'UPS', regex: /\b1Z[0-9A-Z]{16}\b/i },
  { carrier: 'USPS', regex: /\b(94|93|92|95|82)\d{20}\b/ },
  { carrier: 'USPS', regex: /\b[A-Z]{2}\d{9}US\b/i },
  { carrier: 'FedEx', regex: /\b\d{15}\b/ },
  { carrier: 'FedEx', regex: /\b\d{12}\b/ },
  { carrier: 'DHL', regex: /\b\d{10}\b/ },
];

const PLATFORM_PATTERNS: { platform: string; regex: RegExp }[] = [
  { platform: 'ebay', regex: /\bebay\b/i },
  { platform: 'mercari', regex: /\bmercari\b/i },
  { platform: 'depop', regex: /\bdepop\b/i },
  { platform: 'facebook_marketplace', regex: /\b(facebook marketplace|fb marketplace)\b/i },
  { platform: 'poshmark', regex: /\bposhmark\b/i },
];

const BUYER_PATTERNS: RegExp[] = [
  /(?:sold to|buyer|purchased by)\s*[:\-]?\s*([A-Za-z0-9_.\-]{2,30})/i,
  /shipping (?:to|address for)\s+([A-Za-z0-9_.\-]{2,30})/i,
  /from\s+([A-Za-z0-9_.\-]{2,30})\s+has (?:shipped|been shipped)/i,
];

export function parseShippingNotification(raw: string): ParsedShipment {
  const text = raw ?? '';

  let carrier: Carrier | null = null;
  let trackingNumber: string | null = null;
  for (const { carrier: c, regex } of CARRIER_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      carrier = c;
      trackingNumber = match[0].replace(/\s+/g, '').toUpperCase();
      break;
    }
  }

  let platform: string | null = null;
  for (const { platform: p, regex } of PLATFORM_PATTERNS) {
    if (regex.test(text)) {
      platform = p;
      break;
    }
  }

  let buyerAlias: string | null = null;
  for (const regex of BUYER_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      buyerAlias = match[1].replace(/[.,;:]+$/, '');
      break;
    }
  }

  return { trackingNumber, carrier, buyerAlias, platform };
}
