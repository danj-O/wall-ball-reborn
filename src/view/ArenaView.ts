import * as THREE from 'three';
import { WALL_HEIGHT, WALL_TYPES, type ArenaDefinition, type DepotDefinition, type Team, type Vec2 } from '../game/arena.ts';
import type { GameState } from '../game/GameMode.ts';
import { BOMB_RADIUS, BOMB_THROW, DEPLOYABLES, type DeployableId, type DeploymentState, type RuntimeBomb, type RuntimeWall, type Explosion } from '../game/deployables.ts';
import type { EconomyState, RuntimeDepot } from '../game/economy.ts';
import { CAMERA_SETTINGS, frameArena } from './camera.ts';

const COLORS = { red: 0xe95750, blue: 0x4a9bf0 };

export class ArenaView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private readonly scene = new THREE.Scene();
  private readonly arenaGroup = new THREE.Group();
  private readonly wallsGroup = new THREE.Group();
  private readonly depotsGroup = new THREE.Group();
  private readonly deployGroup = new THREE.Group();
  private readonly playerGroups: Record<Team, THREE.Group>;
  private readonly flagGroups: Record<Team, THREE.Group>;
  private readonly wallMeshes = new Map<string, THREE.Mesh>();
  private readonly depotMeshes = new Map<string, THREE.Mesh>();
  private readonly flagBaseMeshes: THREE.Mesh[] = [];
  private readonly bombGroups = new Map<string, THREE.Group>();
  private readonly explosionGroups = new Map<string, THREE.Group>();
  private readonly previewGroups = new Map<string, { group: THREE.Group; material: THREE.MeshStandardMaterial; trajectory?: THREE.Line }>();
  private wallSignature = '';
  private depotSignature = '';
  private selectedId: string | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(container: HTMLElement, arena: ArenaDefinition) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_SETTINGS.fovDegrees, 1, CAMERA_SETTINGS.near, CAMERA_SETTINGS.far,
    );
    this.scene.background = new THREE.Color(0x101923);
    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x5d6b72, 1.9));
    const sun = new THREE.DirectionalLight(0xfff2de, 3.1);
    sun.position.set(-8, 19, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 55;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    this.scene.add(this.arenaGroup);
    this.scene.add(this.wallsGroup);
    this.scene.add(this.depotsGroup);
    this.scene.add(this.deployGroup);

    const tabletop = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), this.material(0x101923));
    tabletop.rotation.x = -Math.PI / 2;
    tabletop.position.y = -1.14;
    tabletop.receiveShadow = true;
    this.scene.add(tabletop);

    this.playerGroups = { red: this.makePlayer('red'), blue: this.makePlayer('blue') };
    this.flagGroups = { red: this.makeFlag('red'), blue: this.makeFlag('blue') };
    this.rebuildArena(arena);
    new ResizeObserver(() => this.resize(container, arena)).observe(container);
    this.resize(container, arena);
  }

  resizeToContainer(container: HTMLElement, arena: ArenaDefinition): void {
    this.resize(container, arena);
  }

  private material(color: number, metalness = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.73, metalness });
  }

  private solid(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private makePlayer(team: Team): THREE.Group {
    const group = new THREE.Group();
    const suit = this.material(COLORS[team]);
    const dark = this.material(team === 'red' ? 0x8d302e : 0x276099);
    const face = this.material(0xf4e7cc);
    const eyes = this.material(0x16202c);
    // Local +Z is forward, matching Game's facing angle.
    group.add(this.solid(new THREE.BoxGeometry(0.26, 0.26, 0.38), dark, -0.19, 0.15, 0.08));
    group.add(this.solid(new THREE.BoxGeometry(0.26, 0.26, 0.38), dark, 0.19, 0.15, 0.08));
    group.add(this.solid(new THREE.CylinderGeometry(0.31, 0.37, 0.75, 10), suit, 0, 0.68, 0));
    group.add(this.solid(new THREE.SphereGeometry(0.29, 12, 9), face, 0, 1.26, 0));
    group.add(this.solid(
      new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), suit, 0, 1.34, 0,
    ));
    for (const side of [-1, 1]) {
      const arm = this.solid(new THREE.CylinderGeometry(0.115, 0.13, 0.65, 8), suit, side * 0.43, 0.71, 0);
      arm.rotation.z = side * 0.28;
      group.add(arm);
      group.add(this.solid(new THREE.SphereGeometry(0.035, 7, 5), eyes, side * 0.11, 1.27, 0.275));
    }
    group.add(this.solid(new THREE.BoxGeometry(0.23, 0.11, 0.065), this.material(0xf1f5f6), 0, 0.76, 0.33));
    this.scene.add(group);
    return group;
  }

  private makeFlag(team: Team): THREE.Group {
    const group = new THREE.Group();
    group.userData.flagId = `flag:${team}`;
    const pole = this.material(0xe7edf1, 0.25);
    const cloth = this.material(COLORS[team]);
    group.add(this.solid(new THREE.CylinderGeometry(0.2, 0.22, 0.11, 12), pole, 0, 0.06, 0));
    group.add(this.solid(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8), pole, 0, 0.83, 0));
    const pennant = new THREE.Shape();
    pennant.moveTo(0, 1.48);
    pennant.lineTo(0.69, 1.48);
    pennant.lineTo(0.55, 1.28);
    pennant.lineTo(0.69, 1.08);
    pennant.lineTo(0, 1.08);
    pennant.closePath();
    group.add(this.solid(
      new THREE.ExtrudeGeometry(pennant, { depth: 0.075, bevelEnabled: false }), cloth, 0, 0, -0.037,
    ));
    group.traverse(object => { object.userData.flagId = `flag:${team}`; });
    this.scene.add(group);
    return group;
  }

  private clearArena(): void {
    this.disposeChildren(this.arenaGroup);
  }

  private disposeChildren(group: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    group.clear();
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    });
  }

  rebuildArena(arena: ArenaDefinition, selectedId: string | null = null): void {
    this.clearArena();
    this.flagBaseMeshes.length = 0;
    const b = arena.bounds;
    const width = b.maxX - b.minX;
    const depth = b.maxZ - b.minZ;
    const centerX = (b.minX + b.maxX) / 2;
    const centerZ = (b.minZ + b.maxZ) / 2;

    this.arenaGroup.add(this.solid(
      new THREE.BoxGeometry(width + 1.5, 0.28, depth + 1.5), this.material(0x172636), centerX, -0.98, centerZ,
    ));
    const floorMaterials = [
      this.material(0x263b4d), this.material(0x263b4d), this.material(0x33495a),
      this.material(0x172636), this.material(0x263b4d), this.material(0x263b4d),
    ];
    const floor = this.solid(new THREE.BoxGeometry(width + 0.9, 0.8, depth + 0.9), floorMaterials[0], centerX, -0.4, centerZ);
    floor.material = floorMaterials;
    this.arenaGroup.add(floor);

    const lines: number[] = [];
    for (let x = Math.ceil(b.minX); x <= b.maxX; x++) lines.push(x, 0.008, b.minZ, x, 0.008, b.maxZ);
    for (let z = Math.ceil(b.minZ); z <= b.maxZ; z++) lines.push(b.minX, 0.008, z, b.maxX, 0.008, z);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.arenaGroup.add(new THREE.LineSegments(
      gridGeometry, new THREE.LineBasicMaterial({ color: 0x455e6e, transparent: true, opacity: 0.5 }),
    ));

    for (const region of arena.territories.contested) {
      const area = region.bounds;
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(area.maxX - area.minX, area.maxZ - area.minZ),
        new THREE.MeshBasicMaterial({ color: 0x527b55, transparent: true, opacity: 0.19, depthWrite: false }),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set((area.minX + area.maxX) / 2, 0.018, (area.minZ + area.maxZ) / 2);
      this.arenaGroup.add(patch);
    }

    const edge = this.material(0x8599a4);
    for (const [x, z, w, d] of [
      [centerX, b.minZ - 0.21, width + 0.8, 0.42],
      [centerX, b.maxZ + 0.21, width + 0.8, 0.42],
      [b.minX - 0.21, centerZ, 0.42, depth],
      [b.maxX + 0.21, centerZ, 0.42, depth],
    ]) this.arenaGroup.add(this.solid(new THREE.BoxGeometry(w, 0.72, d), edge, x, 0.36, z));

    for (const team of ['red', 'blue'] as const) {
      const p = arena.flagPositions[team];
      const base = new THREE.Group();
      base.position.set(p.x, 0, p.z);
      const bottom = this.solid(
        new THREE.CylinderGeometry(1.25, 1.37, 0.24, 32),
        this.material(team === 'red' ? 0x8e3938 : 0x2d6091), 0, 0.12, 0,
      );
      const top = this.solid(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 32),
        this.material(selectedId === `flag:${team}` ? 0xffde81 : COLORS[team]), 0, 0.27, 0);
      for (const mesh of [bottom, top]) {
        mesh.userData.flagId = `flag:${team}`;
        this.flagBaseMeshes.push(mesh);
        base.add(mesh);
      }
      if (selectedId === `flag:${team}`) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.08, 8, 40),
          new THREE.MeshBasicMaterial({ color: 0xffdf82 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.08;
        base.add(ring);
      }
      this.arenaGroup.add(base);
    }

    this.selectedId = selectedId;
    this.wallSignature = '';
    this.depotSignature = '';
    this.syncWalls(arena.walls, true);
    this.syncDepots(arena.depots, true);
  }

  private syncWalls(walls: readonly import('../game/arena.ts').WallDefinition[], editing: boolean): void {
    const selectedId = editing ? this.selectedId : null;
    const signature = JSON.stringify([editing, selectedId, walls]);
    if (signature === this.wallSignature) return;
    this.wallSignature = signature;
    this.disposeChildren(this.wallsGroup);
    this.wallMeshes.clear();
    for (const wall of walls) {
      const runtime = 'hp' in wall ? wall as RuntimeWall : null;
      const selected = wall.id === selectedId;
      const material = WALL_TYPES[wall.type];
      const health = runtime ? Math.max(0, runtime.hp / material.maxHealth) : 1;
      const sides = this.material(selected ? 0xe9b849 : material.appearance.side);
      const top = this.material(selected ? 0xffdf82 : material.appearance.top);
      if (runtime?.owner === 'red') top.color.lerp(new THREE.Color(COLORS.red), 0.32);
      if (runtime?.owner === 'blue') top.color.lerp(new THREE.Color(COLORS.blue), 0.32);
      if (health < 1) {
        sides.color.multiplyScalar(0.65 + health * 0.35);
        top.color.multiplyScalar(0.65 + health * 0.35);
      }
      const mesh = this.solid(new THREE.BoxGeometry(wall.width, WALL_HEIGHT, wall.depth), sides, wall.position.x, WALL_HEIGHT / 2, wall.position.z);
      mesh.material = [sides, sides, top, sides, sides, sides];
      mesh.rotation.y = wall.rotation;
      mesh.userData.wallId = wall.id;
      this.wallsGroup.add(mesh);
      this.wallMeshes.set(wall.id, mesh);
      if (runtime && runtime.hp < material.maxHealth) {
        const bar = this.solid(new THREE.BoxGeometry(wall.width * 0.7 * health, 0.035, 0.08),
          this.material(health > 0.34 ? 0xf4cd74 : 0xff715d), wall.position.x, 1.39, wall.position.z);
        bar.rotation.y = wall.rotation;
        this.wallsGroup.add(bar);
      }
    }
  }

  private syncDepots(depots: readonly DepotDefinition[], editing: boolean): void {
    const signature = JSON.stringify([editing, editing ? this.selectedId : null,
      depots.map(depot => [depot.id, depot.type, depot.position.x, depot.position.z, depot.radius, depot.capacity,
        'stock' in depot ? depot.stock : 1])]);
    if (signature === this.depotSignature) return;
    this.depotSignature = signature;
    this.disposeChildren(this.depotsGroup);
    this.depotMeshes.clear();
    for (const depot of depots) {
      const runtime = 'stock' in depot ? depot as RuntimeDepot : null;
      const selected = editing && depot.id === this.selectedId;
      const color = depot.type === 'wall' ? 0xe5bd76 : 0xf28b67;
      const group = new THREE.Group();
      group.position.set(depot.position.x, 0, depot.position.z);
      const zone = new THREE.Mesh(
        new THREE.CylinderGeometry(depot.radius, depot.radius, 0.018, 48),
        new THREE.MeshBasicMaterial({ color: selected ? 0xffe08a : color, transparent: true, opacity: selected ? 0.4 : 0.2, depthWrite: false }),
      );
      zone.position.y = 0.042;
      zone.userData.depotId = depot.id;
      group.add(zone);
      this.depotMeshes.set(depot.id, zone);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(depot.radius, selected ? 0.075 : 0.045, 6, 48),
        new THREE.MeshBasicMaterial({ color: selected ? 0xffe08a : color, transparent: true, opacity: 0.82 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.065;
      group.add(rim);
      if (depot.type === 'wall') {
        const icon = this.solid(new THREE.BoxGeometry(0.8, 0.52, 0.25), this.material(0xc49b6d), 0, 0.31, 0);
        icon.castShadow = false;
        group.add(icon);
      } else {
        const icon = this.solid(new THREE.SphereGeometry(0.34, 12, 10), this.material(0x343a42), 0, 0.4, 0);
        icon.castShadow = false;
        group.add(icon);
        group.add(this.solid(new THREE.CylinderGeometry(0.04, 0.04, 0.18), this.material(0xffc16b), 0, 0.79, 0));
      }
      const stock = runtime?.stock ?? 1;
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 256;
      labelCanvas.height = 96;
      const context = labelCanvas.getContext('2d')!;
      context.fillStyle = 'rgba(12,26,36,0.86)';
      context.fillRect(8, 8, 240, 80);
      context.fillStyle = '#fff2d5';
      context.font = 'bold 54px system-ui';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(`${stock}/${depot.capacity}`, 128, 49);
      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.51),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      label.rotation.x = -Math.PI / 2;
      label.position.set(0, 0.11, -0.82);
      group.add(label);
      this.depotsGroup.add(group);
    }
  }

  private makeBomb(bomb: RuntimeBomb): THREE.Group {
    const group = new THREE.Group();
    const projectile = new THREE.Group();
    projectile.name = 'projectile';
    const dark = this.material(0x202b34, 0.2);
    const teamColor = this.material(bomb.owner === 'red' ? COLORS.red : COLORS.blue);
    projectile.add(this.solid(new THREE.SphereGeometry(0.34, 16, 12), dark, 0, 0.38, 0));
    const band = this.solid(new THREE.TorusGeometry(0.29, 0.045, 8, 24), teamColor, 0, 0.38, 0);
    band.rotation.x = Math.PI / 2;
    projectile.add(band);
    projectile.add(this.solid(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 8), this.material(0xe5e7d6), 0, 0.76, 0));
    const spark = this.material(0xffb54b);
    spark.emissive.setHex(0xff8a17);
    spark.emissiveIntensity = 1.5;
    const ember = this.solid(new THREE.SphereGeometry(0.09, 10, 8), spark, 0, 0.88, 0);
    ember.name = 'ember';
    projectile.add(ember);
    group.add(projectile);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(BOMB_RADIUS - 0.06, BOMB_RADIUS + 0.06, 64),
      new THREE.MeshBasicMaterial({ color: 0xffb15c, transparent: true, opacity: 0.56, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    ring.name = 'danger-ring';
    group.add(ring);
    group.position.set(bomb.target.x, 0, bomb.target.z);
    this.deployGroup.add(group);
    return group;
  }

  private makeExplosion(explosion: Explosion): THREE.Group {
    const group = new THREE.Group();
    const shell = this.solid(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffa234, transparent: true, opacity: 0.36, depthWrite: false }),
      0, 0.45, 0,
    );
    shell.name = 'shell';
    group.add(shell);
    const core = this.solid(
      new THREE.SphereGeometry(0.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7, depthWrite: false }),
      0, 0.45, 0,
    );
    core.name = 'core';
    group.add(core);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.89, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xff6e32, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.name = 'ring';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);
    group.add(new THREE.PointLight(0xff8d38, 2.5, 6));
    group.position.set(explosion.position.x, 0, explosion.position.z);
    this.deployGroup.add(group);
    return group;
  }

  private syncDeployments(deployments: DeploymentState, editing: boolean, state: GameState): void {
    this.deployGroup.visible = !editing;
    const bombIds = new Set(deployments.bombs.map(bomb => bomb.id));
    for (const [id, group] of this.bombGroups) {
      if (!bombIds.has(id)) { this.disposeChildren(group); this.deployGroup.remove(group); this.bombGroups.delete(id); }
    }
    for (const bomb of deployments.bombs) {
      let group = this.bombGroups.get(bomb.id);
      if (!group) { group = this.makeBomb(bomb); this.bombGroups.set(bomb.id, group); }
      const projectile = group.getObjectByName('projectile');
      group.position.set(bomb.phase === 'lit' ? bomb.position.x : bomb.target.x, 0,
        bomb.phase === 'lit' ? bomb.position.z : bomb.target.z);
      projectile?.position.set(bomb.phase === 'lit' ? 0 : bomb.position.x - bomb.target.x,
        bomb.height, bomb.phase === 'lit' ? 0 : bomb.position.z - bomb.target.z);
      const ring = group.getObjectByName('danger-ring');
      if (ring) ring.position.y = bomb.phase === 'lit' ? bomb.height + 0.025 : 0.025;
      const lit = bomb.phase === 'lit';
      const ember = group.getObjectByName('ember');
      if (ember) {
        ember.visible = lit;
        if (lit) ember.scale.setScalar(0.8 + 0.4 * Math.sin((1 - bomb.fuseRemaining / bomb.fuseDuration) * 28));
      }
      if (ring) ring.visible = lit;
    }
    const explosionIds = new Set(deployments.explosions.map(explosion => explosion.id));
    for (const [id, group] of this.explosionGroups) {
      if (!explosionIds.has(id)) { this.disposeChildren(group); this.deployGroup.remove(group); this.explosionGroups.delete(id); }
    }
    for (const explosion of deployments.explosions) {
      let group = this.explosionGroups.get(explosion.id);
      if (!group) { group = this.makeExplosion(explosion); this.explosionGroups.set(explosion.id, group); }
      const progress = 1 - explosion.remaining / explosion.duration;
      group.getObjectByName('shell')?.scale.setScalar(0.3 + progress * explosion.radius);
      group.getObjectByName('core')?.scale.setScalar(0.5 + progress * 1.2);
      group.getObjectByName('ring')?.scale.setScalar(0.3 + progress * explosion.radius);
      for (const name of ['shell', 'core', 'ring']) {
        const mesh = group.getObjectByName(name) as THREE.Mesh | undefined;
        const material = mesh?.material as THREE.MeshBasicMaterial | undefined;
        if (material) material.opacity = (name === 'shell' ? 0.36 : 0.7) * (1 - progress);
      }
    }
    for (const team of ['red', 'blue'] as const) {
      for (const id of Object.keys(DEPLOYABLES) as DeployableId[]) {
        const key = `${team}:${id}`;
        const preview = deployments.aim[team][id]?.preview;
        let current = this.previewGroups.get(key);
        if (!preview || editing) {
          if (current) current.group.visible = false;
          continue;
        }
        if (!current) {
        const shape = DEPLOYABLES[id].preview;
        const material = new THREE.MeshStandardMaterial({
          color: 0x63e4a2, emissive: 0x163c2a, transparent: true, opacity: 0.45,
          roughness: 0.5, depthWrite: false,
        });
        const group = new THREE.Group();
        const geometry = shape.kind === 'box'
          ? new THREE.BoxGeometry(shape.width, shape.height, shape.depth)
          : new THREE.SphereGeometry(shape.radius, 16, 12);
        const ghost = this.solid(geometry, material, 0, shape.kind === 'box' ? shape.height / 2 : shape.radius, 0);
        ghost.castShadow = false;
        group.add(ghost);
        let trajectory: THREE.Line | undefined;
        if (id === 'bomb') {
          trajectory = new THREE.Line(new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0xf5dc9a, transparent: true, opacity: 0.8, depthTest: false }));
          group.add(trajectory);
          const marker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32),
            new THREE.MeshBasicMaterial({ color: 0xf5dc9a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
          marker.rotation.x = -Math.PI / 2;
          marker.position.y = 0.04;
          group.add(marker);
        }
        this.deployGroup.add(group);
        current = { group, material, trajectory };
        this.previewGroups.set(key, current);
        }
        current.group.visible = true;
        current.group.position.set(preview.position.x, preview.landingHeight, preview.position.z);
        current.group.rotation.y = id === 'wall' ? preview.rotation : 0;
        current.material.color.setHex(preview.valid ? 0x6beca4 : 0xff6659);
        current.material.emissive.setHex(preview.valid ? 0x164a2d : 0x6a1717);
        if (current.trajectory) {
          const origin = state.players[team].position;
          const points = Array.from({ length: 17 }, (_, index) => {
            const t = index / 16;
            return new THREE.Vector3(
              (origin.x - preview.position.x) * (1 - t),
              0.45 - preview.landingHeight * (1 - t) + 4 * BOMB_THROW.trajectoryHeight * t * (1 - t),
              (origin.z - preview.position.z) * (1 - t),
            );
          });
          current.trajectory.geometry.dispose();
          current.trajectory.geometry = new THREE.BufferGeometry().setFromPoints(points);
          (current.trajectory.material as THREE.LineBasicMaterial).color.setHex(preview.valid ? 0xf5dc9a : 0xff6659);
        }
      }
    }
  }

  sync(state: GameState, arena: ArenaDefinition, editing: boolean, deployments: DeploymentState, economy: EconomyState): void {
    this.syncWalls(editing ? arena.walls : deployments.walls, editing);
    this.syncDepots(editing ? arena.depots : economy.depots, editing);
    this.syncDeployments(deployments, editing, state);
    for (const team of ['red', 'blue'] as const) {
      const player = this.playerGroups[team];
      const data = state.players[team];
      player.visible = !editing;
      player.position.set(data.position.x, 0, data.position.z);
      player.rotation.y = data.facing;

      const flag = this.flagGroups[team];
      const carrier = state.flags[team].carrier;
      if (carrier) {
        const holder = state.players[carrier];
        const sideX = Math.cos(holder.facing) * 0.5 - Math.sin(holder.facing) * 0.25;
        const sideZ = -Math.sin(holder.facing) * 0.5 - Math.cos(holder.facing) * 0.25;
        flag.position.set(holder.position.x + sideX, 0.34, holder.position.z + sideZ);
      } else {
        const p = arena.flagPositions[team];
        flag.position.set(p.x, 0.3, p.z);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  pickArenaObject(clientX: number, clientY: number): string | null {
    this.setPointer(clientX, clientY);
    const hit = this.raycaster.intersectObjects([
      ...this.wallMeshes.values(), ...this.depotMeshes.values(), ...this.flagBaseMeshes,
      this.flagGroups.red, this.flagGroups.blue,
    ], true)[0];
    return hit ? String(hit.object.userData.wallId ?? hit.object.userData.depotId ?? hit.object.userData.flagId) : null;
  }

  groundPoint(clientX: number, clientY: number): Vec2 | null {
    this.setPointer(clientX, clientY);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, point) ? { x: point.x, z: point.z } : null;
  }

  screenDirectionToGround(dx: number, dy: number): Vec2 {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    right.y = 0;
    up.y = 0;
    right.normalize();
    up.normalize();
    const direction = right.multiplyScalar(dx).add(up.multiplyScalar(-dy));
    const length = Math.hypot(direction.x, direction.z);
    return length > 0 ? { x: direction.x / length, z: direction.z / length } : { x: 0, z: 0 };
  }

  private setPointer(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private resize(container: HTMLElement, arena: ArenaDefinition): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    frameArena(this.camera, arena, width, height);
    this.renderer.setSize(width, height);
  }
}
