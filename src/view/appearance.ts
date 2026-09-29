import savedDefaults from './appearanceDefaults.json' with { type: 'json' };

export type AppearanceTheme = {
  field: string;
  contestedField: string;
  outside: string;
  stone: string;
  wood: string;
  sand: string;
  red: string;
  blue: string;
  uiNeutral: string;
  keyLight: string;
  keyIntensity: number;
  ambientSky: string;
  ambientGround: string;
  ambientIntensity: number;
  exposure: number;
};

export const APPEARANCE_STORAGE_KEY = 'wall-ball-reborn-appearance-v1';
export const APPEARANCE_COLOR_FIELDS = [
  ['field', 'Main field'], ['contestedField', 'Contested center'], ['outside', 'Outside'],
  ['stone', 'Stone'], ['wood', 'Wood'], ['sand', 'Sand / neutral'],
  ['red', 'Red team'], ['blue', 'Blue team'], ['uiNeutral', 'Dark UI'],
  ['keyLight', 'Key light'], ['ambientSky', 'Ambient sky'], ['ambientGround', 'Ambient ground'],
] as const satisfies readonly (readonly [keyof AppearanceTheme, string])[];
export const APPEARANCE_LIGHT_RANGES = {
  keyIntensity: { min: 0.5, max: 5, step: 0.1 },
  ambientIntensity: { min: 0.2, max: 3, step: 0.1 },
  exposure: { min: 0.7, max: 1.5, step: 0.05 },
} as const;

const colorFields = APPEARANCE_COLOR_FIELDS.map(([field]) => field);
const colorPattern = /^#[0-9a-fA-F]{6}$/;

export function validateAppearance(value: unknown): AppearanceTheme | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  for (const field of colorFields) if (typeof input[field] !== 'string' || !colorPattern.test(input[field])) return null;
  for (const [field, range] of Object.entries(APPEARANCE_LIGHT_RANGES)) {
    const number = input[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < range.min || number > range.max) return null;
  }
  return Object.fromEntries([...colorFields.map(field => [field, (input[field] as string).toUpperCase()]),
    ...Object.keys(APPEARANCE_LIGHT_RANGES).map(field => [field, input[field]])]) as AppearanceTheme;
}

export const DEFAULT_APPEARANCE = validateAppearance(savedDefaults)!;

export function loadAppearance(storage: Pick<Storage, 'getItem'>): AppearanceTheme {
  try { return validateAppearance(JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')) ?? { ...DEFAULT_APPEARANCE }; }
  catch { return { ...DEFAULT_APPEARANCE }; }
}
