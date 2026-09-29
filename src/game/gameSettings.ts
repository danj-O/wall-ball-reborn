import savedDefaults from './gameSettingsDefaults.json' with { type: 'json' };
import { BASE_GAME_SETTINGS, migrateGameSettings, type GameSettings } from './gameSettingsSchema.ts';

export const DEFAULT_GAME_SETTINGS: GameSettings = migrateGameSettings(savedDefaults) ?? BASE_GAME_SETTINGS;

export function loadGameSettings(storage: Pick<Storage, 'getItem'>): GameSettings {
  try { return migrateGameSettings(JSON.parse(storage.getItem('wall-ball-reborn-game-settings-v1') ?? 'null'), DEFAULT_GAME_SETTINGS) ?? DEFAULT_GAME_SETTINGS; }
  catch { return DEFAULT_GAME_SETTINGS; }
}
