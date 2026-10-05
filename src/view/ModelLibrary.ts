import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';
import { ASSET_REGISTRY, modelUrl, type ModelId } from './AssetRegistry.ts';

export interface ModelSize { width: number; height: number; depth: number }
export interface ModelMountOptions {
  size: ModelSize;
  anchorY?: number;
  teamColor?: string;
  onReady?: (clips: THREE.AnimationClip[], scene: THREE.Object3D) => void;
}

export class ModelMount {
  private model: THREE.Group | null = null;
  private disposed = false;
  private readonly library: ModelLibrary;
  private readonly root: THREE.Object3D;
  private readonly fallback: THREE.Object3D;
  private readonly id: ModelId;
  private readonly options: ModelMountOptions;

  constructor(library: ModelLibrary, root: THREE.Object3D, fallback: THREE.Object3D, id: ModelId, options: ModelMountOptions) {
    this.library = library;
    this.root = root;
    this.fallback = fallback;
    this.id = id;
    this.options = options;
    root.userData.modelMount = this;
    void this.install();
  }

  private async install(): Promise<void> {
    try {
      const asset = await this.library.load(this.id);
      if (!asset || this.disposed) return;
      const config = ASSET_REGISTRY[this.id];
      const scene = cloneSkinnedScene(asset.scene);
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = config.castShadow;
        object.receiveShadow = config.receiveShadow;
        object.userData.assetManaged = true;
        if (this.options.teamColor && config.teamAccent) {
          const meshAccent = config.teamAccentMeshes?.includes(object.name) ?? false;
          const replace = (material: THREE.Material) =>
            meshAccent || material.name === 'TEAM_ACCENT'
              ? this.library.teamMaterial(this.id, this.options.teamColor!, material, meshAccent)
              : material;
          object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
        }
      });
      const pivot = new THREE.Group();
      pivot.add(scene);
      scene.rotation.set(...config.rotation);
      scene.scale.setScalar(config.scale);
      const box = new THREE.Box3().setFromObject(pivot);
      if (box.isEmpty()) return;
      const current = box.getSize(new THREE.Vector3());
      const desired = this.options.size;
      if (config.fit !== 'native') {
        const ratios = [desired.width / current.x, desired.height / current.y, desired.depth / current.z]
          .filter(value => Number.isFinite(value) && value > 0);
        if (ratios.length) {
          if (config.fit === 'uniform') pivot.scale.setScalar(Math.min(...ratios));
          else pivot.scale.set(
            current.x > 0 ? desired.width / current.x : 1,
            current.y > 0 ? desired.height / current.y : 1,
            current.z > 0 ? desired.depth / current.z : 1,
          );
        }
      }
      box.setFromObject(pivot);
      pivot.position.set(
        -(box.min.x + box.max.x) / 2 + config.offset[0],
        -box.min.y + (this.options.anchorY ?? 0) + config.offset[1],
        -(box.min.z + box.max.z) / 2 + config.offset[2],
      );
      if (this.disposed) return;
      this.root.add(pivot);
      this.model = pivot;
      this.fallback.visible = !this.library.enabled;
      pivot.visible = this.library.enabled;
      this.options.onReady?.(asset.animations, scene);
    } catch (error) {
      if (this.disposed) return;
      if (this.model) this.root.remove(this.model);
      this.model = null;
      this.fallback.visible = true;
      console.warn(`Model ${this.id} could not be prepared; using primitive fallback.`, error);
    }
  }

  setEnabled(enabled: boolean): void {
    this.fallback.visible = !enabled || !this.model;
    if (this.model) this.model.visible = enabled;
  }

  dispose(): void {
    this.disposed = true;
    this.root.userData.modelMount = undefined;
    if (this.model) this.root.remove(this.model);
    this.library.release(this);
  }
}

export class ModelLibrary {
  enabled = true;
  private readonly baseUrl: string;
  private readonly loader: { loadAsync(url: string): Promise<GLTF> };
  private readonly cache = new Map<ModelId, Promise<GLTF | null>>();
  private readonly mounts = new Set<ModelMount>();
  private readonly teamMaterials = new Map<string, THREE.Material>();

  constructor(baseUrl: string, loader: { loadAsync(url: string): Promise<GLTF> } = new GLTFLoader()) {
    this.baseUrl = baseUrl;
    this.loader = loader;
  }

  load(id: ModelId): Promise<GLTF | null> {
    const config = ASSET_REGISTRY[id];
    if (!config.file) return Promise.resolve(null);
    let loaded = this.cache.get(id);
    if (!loaded) {
      let url: string;
      try { url = modelUrl(this.baseUrl, config.file); }
      catch {
        console.warn(`Model ${id} has an invalid path; using primitive fallback.`);
        const unavailable = Promise.resolve(null);
        this.cache.set(id, unavailable);
        return unavailable;
      }
      loaded = this.loader.loadAsync(url).then(async gltf => {
        const files = config.animations?.files ?? [];
        const extra = await Promise.all(files.map(async file => {
          try { return (await this.loader.loadAsync(modelUrl(this.baseUrl, file))).animations; }
          catch (error) {
            console.warn(`Animations ${file} could not load; model remains available.`, error);
            return [];
          }
        }));
        return { ...gltf, animations: [...gltf.animations, ...extra.flat()] };
      }).catch(error => {
        console.warn(`Model ${id} could not load; using primitive fallback.`, error);
        return null;
      });
      this.cache.set(id, loaded);
    }
    return loaded;
  }

  mount(id: ModelId, root: THREE.Object3D, fallback: THREE.Object3D, options: ModelMountOptions): ModelMount {
    const mount = new ModelMount(this, root, fallback, id, options);
    this.mounts.add(mount);
    return mount;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const mount of this.mounts) mount.setEnabled(enabled);
  }

  clearTeamMaterials(): void {
    for (const material of this.teamMaterials.values()) material.dispose();
    this.teamMaterials.clear();
  }

  disposeUnder(root: THREE.Object3D): void {
    const mounts: ModelMount[] = [];
    root.traverse(object => {
      if (object.userData.modelMount instanceof ModelMount) mounts.push(object.userData.modelMount);
    });
    for (const mount of mounts) mount.dispose();
  }

  release(mount: ModelMount): void { this.mounts.delete(mount); }

  teamMaterial(id: ModelId, color: string, source: THREE.Material, solidAccent = false): THREE.Material {
    const key = `${id}:${color}:${source.uuid}:${solidAccent}`;
    const cached = this.teamMaterials.get(key);
    if (cached) return cached;
    const variant = source.clone();
    if (variant instanceof THREE.MeshStandardMaterial) {
      if (solidAccent) variant.map = null;
      variant.color.set(color);
      variant.needsUpdate = true;
    }
    this.teamMaterials.set(key, variant);
    return variant;
  }
}
