import * as THREE from 'three';
import type { ArenaDefinition } from '../game/arena.ts';
import savedDefaults from './cameraDefaults.json' with { type: 'json' };

export type CameraTuning = { pitchDegrees: number; yawDegrees: number; distanceScale: number };
export const CAMERA_STORAGE_KEY = 'wall-ball-reborn-camera-v1';
export const CAMERA_TUNING_RANGES = {
  pitchDegrees: { min: 35, max: 90, step: 1 },
  yawDegrees: { min: -60, max: 60, step: 1 },
  distanceScale: { min: 0.85, max: 1.7, step: 0.01 },
} as const;

export function validateCameraTuning(value: unknown): CameraTuning | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  for (const [field, range] of Object.entries(CAMERA_TUNING_RANGES)) {
    const number = input[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < range.min || number > range.max) return null;
  }
  return {
    pitchDegrees: input.pitchDegrees as number,
    yawDegrees: input.yawDegrees as number,
    distanceScale: input.distanceScale as number,
  };
}

export const DEFAULT_CAMERA_TUNING = validateCameraTuning(savedDefaults)!;

export function loadCameraTuning(storage: Pick<Storage, 'getItem'>): CameraTuning {
  try { return validateCameraTuning(JSON.parse(storage.getItem(CAMERA_STORAGE_KEY) ?? 'null')) ?? { ...DEFAULT_CAMERA_TUNING }; }
  catch { return { ...DEFAULT_CAMERA_TUNING }; }
}

// The remaining camera parameters stay fixed; tuning only changes viewpoint and spacing.
export const CAMERA_SETTINGS = {
  fovDegrees: 42,
  framingPadding: 1.035,
  minimumDistance: 18,
  near: 0.1,
  far: 220,
} as const;

export function frameArena(camera: THREE.PerspectiveCamera, arena: ArenaDefinition, width: number, height: number, tuning: CameraTuning = DEFAULT_CAMERA_TUNING): void {
  const aspect = width / Math.max(1, height);
  camera.aspect = aspect;
  camera.fov = CAMERA_SETTINGS.fovDegrees;
  camera.updateProjectionMatrix();

  const pitch = THREE.MathUtils.degToRad(tuning.pitchDegrees);
  const yaw = THREE.MathUtils.degToRad(tuning.yawDegrees);
  const backward = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
  const bounds = arena.bounds;
  const target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0.35, (bounds.minZ + bounds.maxZ) / 2);
  camera.position.copy(target).addScaledVector(backward, CAMERA_SETTINGS.minimumDistance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * aspect;
  let distance: number = CAMERA_SETTINGS.minimumDistance;
  // Include the plinth, perimeter and tallest flags in the fit.
  for (const x of [bounds.minX - 0.8, bounds.maxX + 0.8]) {
    for (const z of [bounds.minZ - 0.8, bounds.maxZ + 0.8]) {
      for (const y of [-1.1, 2.3]) {
        const point = new THREE.Vector3(x, y, z).sub(target);
        distance = Math.max(distance,
          point.dot(backward) + Math.abs(point.dot(right)) / tanH,
          point.dot(backward) + Math.abs(point.dot(up)) / tanV);
      }
    }
  }
  camera.position.copy(target).addScaledVector(backward, distance * CAMERA_SETTINGS.framingPadding * tuning.distanceScale);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}
