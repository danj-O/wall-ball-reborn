import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_REGISTRY } from './AssetRegistry.ts';
import { ModelLibrary } from './ModelLibrary.ts';

async function glbJson(file: string): Promise<Record<string, any>> {
  const buffer = await readFile(new URL(`../../public/models/${file}`, import.meta.url));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
}

test('Knight and the two Rig_Medium files contain the required compatible clips', async () => {
  const config = ASSET_REGISTRY.player;
  assert.equal(config.file, 'characters/Knight.glb');
  const model = await glbJson(config.file!);
  const modelBones = new Set(model.nodes.map((node: { name?: string }) => node.name));
  assert.ok(modelBones.has('root') && modelBones.has('hips'));
  assert.ok(model.meshes.some((mesh: { name?: string }) => mesh.name === 'Knight_Cape'));
  assert.ok(model.images.every((image: { uri?: string; bufferView?: number }) =>
    image.uri === undefined && image.bufferView !== undefined), 'Knight texture is embedded');

  const names = new Set<string>();
  for (const file of config.animations!.files!) {
    const animations = await glbJson(file);
    const animationBones = new Set(animations.nodes.map((node: { name?: string }) => node.name));
    assert.ok(animationBones.has('root') && animationBones.has('hips'));
    for (const clip of animations.animations) names.add(clip.name);
  }
  for (const clip of ['Idle_A', 'Running_A', 'Jump_Start', 'Jump_Idle', 'Jump_Land']) assert.ok(names.has(clip), clip);
});

test('player GLB and animation sources load once under the Pages base path', async () => {
  const requests: string[] = [];
  const library = new ModelLibrary('/wall-ball-reborn/', { loadAsync: async url => {
    requests.push(url);
    return { scene: new THREE.Group(), animations: [new THREE.AnimationClip(url, 1, [])] } as unknown as GLTF;
  } });
  const first = await library.load('player');
  const second = await library.load('player');
  assert.equal(first, second);
  assert.equal(first?.animations.length, 3);
  assert.deepEqual(requests, [
    '/wall-ball-reborn/models/characters/Knight.glb',
    '/wall-ball-reborn/models/characters/animations/Rig_Medium_General.glb',
    '/wall-ball-reborn/models/characters/animations/Rig_Medium_MovementBasic.glb',
  ]);
});

test('KayKit animation tracks bind to Knight bone names', async () => {
  const model = await glbJson('characters/Knight.glb');
  const rig = new THREE.Group();
  for (const index of model.skins[0].joints) {
    const node = model.nodes[index];
    if (!node.name) continue;
    const bone = new THREE.Bone();
    bone.name = THREE.PropertyBinding.sanitizeNodeName(node.name);
    rig.add(bone);
  }
  const file = await readFile(new URL('../../public/models/characters/animations/Rig_Medium_General.glb', import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const animationAsset = await new GLTFLoader().parseAsync(buffer, '');
  const idle = animationAsset.animations.find(clip => clip.name === 'Idle_A')!;
  assert.ok(idle.tracks.some(track => track.name === 'hips.position'));
  const hips = rig.getObjectByName('hips')!;
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(idle).play();
  mixer.update(0.5);
  assert.ok(hips.position.y > 0.3 && hips.position.y < 0.5);
  mixer.stopAllAction();
  mixer.uncacheRoot(rig);
});
