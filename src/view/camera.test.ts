import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BASE_ARENA as DEFAULT_ARENA, resizedArena } from '../game/arena.ts';
import { CAMERA_SETTINGS, CAMERA_STORAGE_KEY, DEFAULT_CAMERA_TUNING, frameArena, loadCameraTuning, validateCameraTuning } from './camera.ts';

test('standard-distance perspective framing keeps the full raised arena visible in wide and tall viewports', () => {
  for (const arena of [DEFAULT_ARENA, resizedArena(DEFAULT_ARENA, 80, 48)!]) {
    for (const [width, height] of [[1280, 720], [884, 620], [480, 800]]) {
      const camera = new THREE.PerspectiveCamera(
        CAMERA_SETTINGS.fovDegrees, width / height, CAMERA_SETTINGS.near, CAMERA_SETTINGS.far,
      );
      frameArena(camera, arena, width, height, { ...DEFAULT_CAMERA_TUNING, distanceScale: 1 });
      const bounds = arena.bounds;
      for (const x of [bounds.minX - 0.8, bounds.maxX + 0.8]) {
        for (const z of [bounds.minZ - 0.8, bounds.maxZ + 0.8]) {
          for (const y of [-1.1, 2.3]) {
            const projected = new THREE.Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(projected.x) < 1, `x clipped at ${width}x${height}`);
            assert.ok(Math.abs(projected.y) < 1, `y clipped at ${width}x${height}`);
            assert.ok(projected.z > -1 && projected.z < 1, `depth clipped at ${width}x${height}`);
          }
        }
      }
    }
  }
});

test('saved camera tuning is validated before loading', () => {
  assert.deepEqual(validateCameraTuning(DEFAULT_CAMERA_TUNING), DEFAULT_CAMERA_TUNING);
  assert.equal(validateCameraTuning({ pitchDegrees: 12, yawDegrees: 0, distanceScale: 1 }), null);
  assert.equal(validateCameraTuning({ pitchDegrees: 60, yawDegrees: Infinity, distanceScale: 1 }), null);
  const saved = { pitchDegrees: 56, yawDegrees: -25, distanceScale: 1.24 };
  assert.deepEqual(loadCameraTuning({ getItem: key => key === CAMERA_STORAGE_KEY ? JSON.stringify(saved) : null }), saved);
  assert.deepEqual(loadCameraTuning({ getItem: () => '{broken' }), DEFAULT_CAMERA_TUNING);
});

test('angled camera keeps the arena in frame at standard or farther distance', () => {
  const arena = resizedArena(DEFAULT_ARENA, 80, 48)!;
  for (const tuning of [
    { pitchDegrees: 35, yawDegrees: -60, distanceScale: 1 },
    { pitchDegrees: 55, yawDegrees: 60, distanceScale: 1.4 },
  ]) {
    for (const [width, height] of [[1280, 720], [480, 800]]) {
      const camera = new THREE.PerspectiveCamera(CAMERA_SETTINGS.fovDegrees, width / height, CAMERA_SETTINGS.near, CAMERA_SETTINGS.far);
      frameArena(camera, arena, width, height, tuning);
      for (const x of [arena.bounds.minX - 0.8, arena.bounds.maxX + 0.8]) {
        for (const z of [arena.bounds.minZ - 0.8, arena.bounds.maxZ + 0.8]) {
          for (const y of [-1.1, 2.3]) {
            const projected = new THREE.Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, `clipped at ${width}×${height}`);
          }
        }
      }
    }
  }
});
