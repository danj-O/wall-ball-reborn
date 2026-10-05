import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ModelLibrary } from './ModelLibrary.ts';
import { PlayerVisual, runPlaybackRate } from './PlayerVisual.ts';

function pose(name: string, y: number, duration = 1): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack('hips.position', [0, duration], [0, y, 0, 0, y, 0]),
  ]);
}

test('semantic Knight animations transition, reset and dispose without new model loads', async () => {
  const template = new THREE.Group();
  const hips = new THREE.Group();
  hips.name = 'hips';
  template.add(hips, new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  let loads = 0;
  const library = new ModelLibrary('/', { loadAsync: async url => {
    loads++;
    const animations = url.includes('General') ? [pose('Idle_A', 0)] :
      url.includes('MovementBasic') ? [pose('Running_A', 2), pose('Jump_Start', 3, 0.1),
        pose('Jump_Idle', 4), pose('Jump_Land', 1, 0.1)] : [];
    return { scene: template, animations } as unknown as GLTF;
  } });
  const visual = new PlayerVisual(library, new THREE.Group(), '#ff0000');
  await library.load('player');
  await new Promise(resolve => setTimeout(resolve, 0));
  const modelHips = visual.root.getObjectByName('hips')!;
  assert.ok(modelHips);
  visual.setMovementState('run', 8);
  visual.update(0.3);
  assert.ok(modelHips.position.y > 0, 'Running_A affects the compatible rig');
  visual.setMovementState('airborne');
  visual.update(0.2);
  visual.update(0.2);
  assert.ok(modelHips.position.y > 2, 'takeoff advances into Jump_Idle');
  visual.setMovementState('idle');
  visual.update(0.2);
  visual.reset();
  visual.update(0.2);
  assert.equal(loads, 3, 'replay does not allocate another model or animation load');
  visual.dispose();
  library.disposeUnder(visual.root);
  assert.equal(visual.root.children.length, 1, 'the mounted model is released');
});

test('run cadence scales with distance and motion survives empty render frames', async () => {
  assert.ok(runPlaybackRate(1, 0.8) < runPlaybackRate(10.8, 0.8));
  assert.ok(runPlaybackRate(1, 0.8) < 0.2, 'slow movement does not trigger the old minimum sprint rate');
  const library = new ModelLibrary('/', { loadAsync: async () => ({ scene: new THREE.Group(), animations: [] }) as unknown as GLTF });
  const visual = new PlayerVisual(library, new THREE.Group(), '#ff0000');
  await library.load('player');
  assert.equal(visual.sampleGroundSpeed({ x: 0, z: 0 }, 0), 0);
  const movingSpeed = visual.sampleGroundSpeed({ x: 0.08, z: 0 }, 16);
  assert.ok(movingSpeed > 4);
  assert.equal(visual.sampleGroundSpeed({ x: 0.08, z: 0 }, 24), movingSpeed, 'an empty 120 Hz render frame does not interrupt the run');
  assert.equal(visual.sampleGroundSpeed({ x: 0.08, z: 0 }, 120), 0, 'stopping eventually returns to idle');
  visual.reset();
  assert.equal(visual.sampleGroundSpeed({ x: 0.08, z: 0 }, 136), 0, 'reset forgets previous motion');
  visual.dispose();
  library.disposeUnder(visual.root);
});
