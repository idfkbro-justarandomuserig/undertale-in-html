import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const PREFERENCES_PATH = path.join(ROOT_DIR, 'about-me', 'preferences.json');

export interface Preferences {
  targetMarginPct: number;
  platformFeeOverridesPct: Record<string, number>;
}

const DEFAULT_PREFERENCES: Preferences = {
  targetMarginPct: 30,
  platformFeeOverridesPct: {},
};

export function loadPreferences(): Preferences {
  try {
    const raw = fs.readFileSync(PREFERENCES_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      targetMarginPct: parsed.targetMarginPct ?? DEFAULT_PREFERENCES.targetMarginPct,
      platformFeeOverridesPct: parsed.platformFeeOverridesPct ?? DEFAULT_PREFERENCES.platformFeeOverridesPct,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
