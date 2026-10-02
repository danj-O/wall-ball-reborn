import type { Team, Vec2 } from '../game/arena.ts';

export function localControlAllowed(team: Team, remoteOwner: Team | null): boolean {
  return team !== remoteOwner;
}

export function selectedMovement(team: Team, remoteOwner: Team | null,
  keyboard: Vec2, touch: Vec2, remote: Vec2): Vec2 {
  return !localControlAllowed(team, remoteOwner) ? remote :
    { x: keyboard.x + touch.x, z: keyboard.z + touch.z };
}
