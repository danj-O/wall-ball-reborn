import * as THREE from 'three';
import { ASSET_REGISTRY } from './AssetRegistry.ts';
import { ModelLibrary } from './ModelLibrary.ts';
import type { Vec2 } from '../game/arena.ts';

export type PlayerMovementState = 'idle' | 'run' | 'airborne';
type AnimationState = PlayerMovementState | 'takeoff' | 'landing';

// One Running_A loop covers roughly this much ground at normal game speed.
// Playback follows distance traveled, so short acceleration/braking steps do not look like a sprint.
const RUN_CYCLE_DISTANCE = 7.2;
export function runPlaybackRate(horizontalSpeed: number, clipDuration: number): number {
  return THREE.MathUtils.clamp(horizontalSpeed * clipDuration / RUN_CYCLE_DISTANCE, 0.08, 1.5);
}

/** Owns only player presentation. Rules and physics never inspect this object. */
export class PlayerVisual {
  readonly root: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private modelScene: THREE.Object3D | null = null;
  private readonly actions = new Map<AnimationState, THREE.AnimationAction>();
  private movementState: PlayerMovementState = 'idle';
  private activeState: AnimationState | null = null;
  private lastGroundPosition: Vec2 | null = null;
  private lastPositionChangeMs = 0;
  private groundSpeed = 0;

  constructor(library: ModelLibrary, primitive: THREE.Group, teamColor: string) {
    this.root = new THREE.Group();
    this.root.add(primitive);
    library.mount('player', this.root, primitive, {
      size: { width: 1.45, height: 1.82, depth: 1.15 },
      teamColor,
      onReady: (clips, scene) => this.bindAnimations(clips, scene),
    });
  }

  private bindAnimations(clips: THREE.AnimationClip[], scene: THREE.Object3D): void {
    const names = ASSET_REGISTRY.player.animations;
    if (!names || !clips.length) return;
    for (const state of ['idle', 'run', 'takeoff', 'airborne', 'landing'] as const) {
      const name = names[state];
      const clip = clips.find(candidate => candidate.name === name);
      if (!clip) continue;
      this.mixer ??= new THREE.AnimationMixer(scene);
      const action = this.mixer.clipAction(clip);
      if (state === 'takeoff' || state === 'landing') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }
    if (!this.mixer) return;
    this.modelScene = scene;
    this.mixer.addEventListener('finished', this.onAnimationFinished);
    this.play(this.movementState, 0);
  }

  private readonly onAnimationFinished = (event: { action: THREE.AnimationAction }): void => {
    if (event.action === this.actions.get('takeoff') && this.movementState === 'airborne') {
      this.play('airborne');
    } else if (event.action === this.actions.get('landing') && this.movementState !== 'airborne') {
      this.play(this.movementState);
    }
  };

  private play(state: AnimationState, fadeSeconds = 0.14): void {
    const next = this.actions.get(state) ?? (state === 'takeoff' ? this.actions.get('airborne') :
      state === 'landing' ? this.actions.get(this.movementState) : undefined);
    if (!next || this.activeState === state) return;
    const previous = this.activeState ? this.actions.get(this.activeState) : null;
    next.reset().setEffectiveWeight(1).play();
    if (previous && previous !== next) {
      previous.fadeOut(fadeSeconds);
      next.fadeIn(fadeSeconds);
    }
    this.activeState = state;
  }

  setMovementState(state: PlayerMovementState, horizontalSpeed = 0): void {
    const previous = this.movementState;
    this.movementState = state;
    if (state === 'run') {
      const run = this.actions.get('run');
      if (run) run.timeScale = runPlaybackRate(horizontalSpeed, run.getClip().duration);
    }
    if (state === previous) return;
    if (state === 'airborne') this.play('takeoff');
    else if (previous === 'airborne') this.play('landing');
    else this.play(state);
  }

  update(deltaSeconds: number): void { this.mixer?.update(deltaSeconds); }

  sampleGroundSpeed(position: Vec2, nowMs: number): number {
    if (!this.lastGroundPosition) {
      this.lastGroundPosition = { ...position };
      this.lastPositionChangeMs = nowMs;
      return 0;
    }
    const distance = Math.hypot(position.x - this.lastGroundPosition.x, position.z - this.lastGroundPosition.z);
    if (distance > 0.001) {
      const elapsedMs = nowMs - this.lastPositionChangeMs;
      // A long idle gap means this is a fresh step, not motion spread over the whole pause.
      const sampleMs = elapsedMs > 100 ? 1000 / 60 : Math.max(8, elapsedMs);
      this.groundSpeed = distance / (sampleMs / 1000);
      this.lastGroundPosition = { ...position };
      this.lastPositionChangeMs = nowMs;
    } else if (nowMs - this.lastPositionChangeMs > 80) {
      this.groundSpeed = 0;
    }
    return this.groundSpeed;
  }

  reset(): void {
    this.mixer?.stopAllAction();
    this.lastGroundPosition = null;
    this.groundSpeed = 0;
    this.lastPositionChangeMs = 0;
    this.movementState = 'idle';
    this.activeState = null;
    this.play('idle', 0);
  }

  dispose(): void {
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.onAnimationFinished);
      this.mixer.stopAllAction();
      if (this.modelScene) this.mixer.uncacheRoot(this.modelScene);
    }
    this.actions.clear();
    this.mixer = null;
    this.modelScene = null;
    this.activeState = null;
    this.lastGroundPosition = null;
    this.groundSpeed = 0;
  }
}
