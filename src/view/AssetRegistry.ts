export type ModelId =
  | 'player' | 'woodWall' | 'stoneWall' | 'bomb' | 'megaBomb'
  | 'redFlag' | 'blueFlag' | 'wallDepot' | 'bombDepot'
  | 'speedPowerup' | 'shieldPowerup' | 'megaBombPowerup'
  | 'scenery/tree' | 'scenery/bush' | 'scenery/rock' | 'scenery/grass' | 'scenery/fence';

export interface ModelDefinition {
  /** Relative to public/models. Leave null until a licensed asset is added. */
  file: string | null;
  suggestedFile: string;
  scale: number;
  rotation: readonly [number, number, number];
  offset: readonly [number, number, number];
  fit: 'bounds' | 'uniform' | 'native';
  castShadow: boolean;
  receiveShadow: boolean;
  /** Only materials named TEAM_ACCENT are recolored. */
  teamAccent?: boolean;
  animations?: { idle?: string; run?: string; airborne?: string };
}

const slot = (file: string, options: Partial<ModelDefinition> = {}): ModelDefinition => ({
  file: null, suggestedFile: file, scale: 1, rotation: [0, 0, 0], offset: [0, 0, 0],
  fit: 'bounds', castShadow: true, receiveShadow: true, ...options,
});

export const ASSET_REGISTRY: Record<ModelId, ModelDefinition> = {
  player: slot('characters/player.glb', { teamAccent: true, animations: { idle: 'idle', run: 'run', airborne: 'airborne' } }),
  woodWall: slot('walls/wood.glb'),
  stoneWall: slot('walls/stone.glb'),
  bomb: slot('projectiles/bomb.glb'),
  megaBomb: slot('projectiles/mega-bomb.glb'),
  redFlag: slot('objectives/red-flag.glb'),
  blueFlag: slot('objectives/blue-flag.glb'),
  wallDepot: slot('depots/wall.glb'),
  bombDepot: slot('depots/bomb.glb'),
  speedPowerup: slot('powerups/speed.glb'),
  shieldPowerup: slot('powerups/shield.glb'),
  megaBombPowerup: slot('powerups/mega-bomb.glb'),
  'scenery/tree': slot('environment/tree.glb'),
  'scenery/bush': slot('environment/bush.glb'),
  'scenery/rock': slot('environment/rock.glb'),
  'scenery/grass': slot('environment/grass.glb', { castShadow: false }),
  'scenery/fence': slot('environment/fence.glb'),
};

export function modelUrl(baseUrl: string, file: string): string {
  if (!baseUrl.startsWith('/') || !baseUrl.endsWith('/') || file.startsWith('/') ||
    !/^[a-zA-Z0-9/_-]+\.glb$/.test(file) || file.includes('..')) {
    throw new Error('Invalid model path');
  }
  return `${baseUrl}models/${file}`;
}
