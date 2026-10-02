import type { ArenaDefinition, Team } from './arena.ts';
import type { GameMode, GameState } from './GameMode.ts';

const other = (team: Team): Team => team === 'red' ? 'blue' : 'red';
const distanceSquared = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export class CaptureTheFlag implements GameMode {
  readonly name = 'Capture the Flag';
  private readonly pickupRadius = 0.9;
  private readonly tagRadius = 0.9;
  private pickupLocked: Record<Team, boolean> = { red: false, blue: false };
  private noticeSequence = 0;

  createState(arena: ArenaDefinition): GameState {
    this.pickupLocked = { red: false, blue: false };
    this.noticeSequence = 0;
    return {
      players: {
        red: { team: 'red', position: { ...arena.playerSpawns.red }, height: 0, airborne: false, facing: Math.PI / 2, carrying: null },
        blue: { team: 'blue', position: { ...arena.playerSpawns.blue }, height: 0, airborne: false, facing: -Math.PI / 2, carrying: null },
      },
      flags: { red: { team: 'red', carrier: null }, blue: { team: 'blue', carrier: null } },
      winner: null,
      event: 'Grab the enemy flag and bring it to your base.',
      notice: null,
    };
  }

  update(state: GameState, arena: ArenaDefinition): void {
    if (state.winner) return;

    for (const team of ['red', 'blue'] as const) {
      if (distanceSquared(state.players[team].position, arena.flagPositions[other(team)]) >= this.pickupRadius ** 2) {
        this.pickupLocked[team] = false;
      }
    }

    const red = state.players.red;
    const blue = state.players.blue;
    if (!red.airborne && !blue.airborne && distanceSquared(red.position, blue.position) < this.tagRadius ** 2) {
      // Resolve both carriers together so a mutual tag returns both flags.
      const returned = (['red', 'blue'] as const).filter(team => state.players[team].carrying !== null);
      for (const team of returned) {
        const flagTeam = state.players[team].carrying!;
        state.players[team].carrying = null;
        state.flags[flagTeam].carrier = null;
        this.pickupLocked[team] = true;
      }
      if (returned.length) {
        state.event = `${returned.map(team => team.toUpperCase()).join(' and ')} tagged — flag returned!`;
        state.notice = { sequence: ++this.noticeSequence, kind: 'flag-return',
          team: returned.length === 1 ? other(returned[0]) : null,
          flagTeam: returned.length === 1 ? other(returned[0]) : null };
      }
    }

    for (const team of ['red', 'blue'] as const) {
      const player = state.players[team];
      const enemy = other(team);
      if (!player.airborne && player.carrying === null && !this.pickupLocked[team] && state.flags[enemy].carrier === null &&
          distanceSquared(player.position, arena.flagPositions[enemy]) < this.pickupRadius ** 2) {
        player.carrying = enemy;
        state.flags[enemy].carrier = team;
        state.event = `${team.toUpperCase()} stole the ${enemy} flag!`;
        state.notice = { sequence: ++this.noticeSequence, kind: 'flag-pickup', team, flagTeam: enemy };
      }
      if (!player.airborne && player.carrying === enemy &&
          distanceSquared(player.position, arena.flagPositions[team]) < arena.baseRadius ** 2) {
        state.winner = team;
        state.event = `${team.toUpperCase()} wins!`;
        return;
      }
    }
  }
}
