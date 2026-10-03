import * as THREE from 'three';
import { ASSET_REGISTRY } from './AssetRegistry.ts';
import { ModelLibrary } from './ModelLibrary.ts';

export type PlayerMovementState = 'idle' | 'run' | 'airborne';

/** Owns only player presentation. Rules and physics never inspect this object. */
export class PlayerVisual {
  readonly root: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<PlayerMovementState, THREE.AnimationAction>();
  private movementState: PlayerMovementState = 'idle';

  constructor(library: ModelLibrary, primitive: THREE.Group, teamColor: string) {
    this.root = new THREE.Group();
    this.root.add(primitive);
    library.mount('player', this.root, primitive, {
      size: { width: 0.95, height: 1.65, depth: 0.95 },
      teamColor,
      onReady: (clips, scene) => this.bindAnimations(clips, scene),
    });
  }

  private bindAnimations(clips: THREE.AnimationClip[], scene: THREE.Object3D): void {
    const names = ASSET_REGISTRY.player.animations;
    if (!names || !clips.length) return;
    for (const state of ['idle', 'run', 'airborne'] as const) {
      const name = names[state];
      const clip = clips.find(candidate => candidate.name.toLowerCase() === name?.toLowerCase());
      if (!clip) continue;
      this.mixer ??= new THREE.AnimationMixer(scene);
      this.actions.set(state, this.mixer.clipAction(clip));
    }
    this.actions.get(this.movementState)?.play();
  }

  setMovementState(state: PlayerMovementState): void {
    if (state === this.movementState) return;
    this.actions.get(this.movementState)?.fadeOut(0.12);
    this.movementState = state;
    this.actions.get(state)?.reset().fadeIn(0.12).play();
  }

  update(deltaSeconds: number): void { this.mixer?.update(deltaSeconds); }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.actions.clear();
    this.mixer = null;
  }
}
