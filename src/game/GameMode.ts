import type { ArenaDefinition, Team, Vec2 } from './arena.ts';

export type PlayerState = { team: Team; position: Vec2; facing: number; carrying: Team | null };
export type FlagState = { team: Team; carrier: Team | null };
export type GameState = {
  players: Record<Team, PlayerState>;
  flags: Record<Team, FlagState>;
  winner: Team | null;
  event: string;
};

export interface GameMode {
  readonly name: string;
  createState(arena: ArenaDefinition): GameState;
  update(state: GameState, arena: ArenaDefinition): void;
}
