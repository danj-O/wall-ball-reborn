import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA as DEFAULT_ARENA } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { Game } from './Game.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };

function throwPastWall(wallX: number, rotation = 0) {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'test-wall', type: 'stone', position: { x: wallX, z: 0 }, width: 0.8, depth: 3, rotation }];
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  game.state.players.red.position = { x: -3, z: 0 };
  game.update(1 / 120, idle);
  game.beginDeployAim('red', 'bomb');
  const preview = game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, 1)!;
  assert.equal(preview.valid, true);
  assert.ok(preview.trajectory);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'placed');
  const bomb = game.deployments.bombs[0];
  for (let i = 0; i < 180 && bomb.phase === 'flying'; i++) game.update(1 / 120, idle);
  assert.equal(bomb.phase, 'lit');
  return { preview: preview.trajectory!, bomb };
}

test('trajectory stops at a near wall and matches the rigid-body first hit', () => {
  const { preview, bomb } = throwPastWall(-1.8);
  assert.equal(preview.impact.kind, 'wall');
  assert.equal(preview.impact.id, 'test-wall');
  assert.ok(Math.abs(preview.impact.point.x - bomb.position.x) < 0.3);
  assert.ok(Math.abs(preview.impact.point.y - bomb.height - bomb.physicalRadius) < 0.3);
});

test('trajectory visibly clears a farther wall and reaches the floor beyond it', () => {
  const { preview, bomb } = throwPastWall(-0.5);
  assert.equal(preview.impact.kind, 'floor');
  assert.ok(preview.points.some(point => point.x > -0.5 && point.y > 1.35 + bomb.physicalRadius));
  assert.ok(preview.impact.point.x > -0.5);
  assert.ok(Math.abs(preview.impact.point.x - bomb.position.x) < 0.35);
});

test('angled walls use the same rotated footprint in the preview', () => {
  const { preview } = throwPastWall(-1.8, Math.PI / 4);
  assert.equal(preview.impact.kind, 'wall');
});
