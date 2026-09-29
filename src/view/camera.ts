import * as THREE from 'three';
import type { ArenaDefinition } from '../game/arena.ts';

// All presentation camera tuning lives here. Pitch is degrees above the ground.
export const CAMERA_SETTINGS = {
  pitchDegrees: 88,
  yawDegrees: 0,
  fovDegrees: 42,
  framingPadding: 1.035,
  minimumDistance: 18,
  near: 0.1,
  far: 220,
} as const;

export function frameArena(camera: THREE.PerspectiveCamera, arena: ArenaDefinition, width: number, height: number): void {
  const aspect = width / Math.max(1, height);
  camera.aspect = aspect;
  camera.fov = CAMERA_SETTINGS.fovDegrees;
  camera.updateProjectionMatrix();

  const pitch = THREE.MathUtils.degToRad(CAMERA_SETTINGS.pitchDegrees);
  const yaw = THREE.MathUtils.degToRad(CAMERA_SETTINGS.yawDegrees);
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
  camera.position.copy(target).addScaledVector(backward, distance * CAMERA_SETTINGS.framingPadding);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}
