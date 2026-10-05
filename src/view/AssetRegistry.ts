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
  /** Named TEAM_ACCENT materials or configured accent meshes receive team color. */
  teamAccent?: boolean;
  /** For texture atlases without a separate accent material, recolor only these meshes. */
  teamAccentMeshes?: readonly string[];
  animations?: {
    files?: readonly string[];
    idle?: string; run?: string; takeoff?: string; airborne?: string; landing?: string;
  };
}

const slot = (file: string, options: Partial<ModelDefinition> = {}): ModelDefinition => ({
  file: null, suggestedFile: file, scale: 1, rotation: [0, 0, 0], offset: [0, 0, 0],
  fit: 'bounds', castShadow: true, receiveShadow: true, ...options,
});

export const ASSET_REGISTRY: Record<ModelId, ModelDefinition> = {
  player: slot('characters/Knight.glb', {
    file: 'characters/Knight.glb', fit: 'uniform', rotation: [0, 0, 0], offset: [0, 0, 0],
    teamAccent: true, teamAccentMeshes: ['Knight_Cape', 'Knight_HelmetVisor'],
    animations: {
      files: ['characters/animations/Rig_Medium_General.glb', 'characters/animations/Rig_Medium_MovementBasic.glb'],
      idle: 'Idle_A', run: 'Running_A', takeoff: 'Jump_Start', airborne: 'Jump_Idle', landing: 'Jump_Land',
    },
  }),
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
