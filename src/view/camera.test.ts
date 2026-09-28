import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DEFAULT_ARENA } from '../game/arena.ts';
import { CAMERA_SETTINGS, frameArena } from './camera.ts';

test('perspective framing keeps the full raised arena visible in wide and tall viewports', () => {
  for (const [width, height] of [[1280, 720], [884, 620], [480, 800]]) {
    const camera = new THREE.PerspectiveCamera(
      CAMERA_SETTINGS.fovDegrees, width / height, CAMERA_SETTINGS.near, CAMERA_SETTINGS.far,
    );
    frameArena(camera, DEFAULT_ARENA, width, height);
    const bounds = DEFAULT_ARENA.bounds;
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
});
