import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ASSET_REGISTRY, modelUrl } from './AssetRegistry.ts';
import { ModelLibrary } from './ModelLibrary.ts';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

test('registered model paths resolve under both Vite base paths', () => {
  for (const [id, config] of Object.entries(ASSET_REGISTRY)) {
    assert.ok(config.suggestedFile.endsWith('.glb'), id);
    assert.equal(modelUrl('/', config.suggestedFile), `/models/${config.suggestedFile}`);
    assert.equal(modelUrl('/wall-ball-reborn/', config.suggestedFile), `/wall-ball-reborn/models/${config.suggestedFile}`);
    assert.ok(config.scale > 0, id);
    assert.equal(config.rotation.length, 3, id);
    assert.equal(config.offset.length, 3, id);
  }
  assert.throws(() => modelUrl('/wall-ball-reborn/', '../secret.glb'));
  assert.throws(() => modelUrl('/wall-ball-reborn/', '/models/bomb.glb'));
});

test('uninstalled model keeps primitive fallback and toggle is safe', async () => {
  const library = new ModelLibrary('/wall-ball-reborn/');
  const root = new THREE.Group();
  const fallback = new THREE.Group();
  root.add(fallback);
  library.mount('player', root, fallback, { size: { width: 1, height: 2, depth: 1 } });
  await library.load('player');
  assert.equal(root.children.length, 1);
  assert.equal(fallback.visible, true);
  library.setEnabled(false);
  assert.equal(fallback.visible, true);
  library.setEnabled(true);
  assert.equal(fallback.visible, true);
  library.disposeUnder(root);
});

test('loaded model replaces only presentation and responds to model toggle', async () => {
  const template = new THREE.Group();
  template.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial()));
  const oldFile = ASSET_REGISTRY.woodWall.file;
  ASSET_REGISTRY.woodWall.file = 'walls/wood.glb';
  let calls = 0;
  const library = new ModelLibrary('/wall-ball-reborn/', { loadAsync: async url => {
    assert.equal(url, '/wall-ball-reborn/models/walls/wood.glb');
    calls++;
    return { scene: template, animations: [] } as unknown as GLTF;
  } });
  const root = new THREE.Group();
  const fallback = new THREE.Group();
  root.add(fallback);
  library.mount('woodWall', root, fallback, { size: { width: 3, height: 1, depth: 0.5 } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.children.length, 2);
  assert.equal(fallback.visible, false);
  library.setEnabled(false);
  assert.equal(fallback.visible, true);
  library.setEnabled(true);
  assert.equal(fallback.visible, false);
  library.disposeUnder(root);
  assert.equal(root.children.length, 1);
  await library.load('woodWall');
  assert.equal(calls, 1, 'the GLB is loaded once per slot');
  ASSET_REGISTRY.woodWall.file = oldFile;
});
