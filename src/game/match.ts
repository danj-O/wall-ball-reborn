import type { Team } from './arena.ts';

export type MatchPhase = 'ready' | 'playing' | 'finished';
export type PlayerMatchStats = {
  wallsPlaced: number;
  bombsThrown: number;
  wallsDestroyed: number;
  powerUpsCollected: number;
  resourcesStolen: number;
};
export type MatchState = {
  phase: MatchPhase;
  duration: number;
  winner: Team | null;
  stats: Record<Team, PlayerMatchStats>;
};

export function createMatchState(): MatchState {
  const player = (): PlayerMatchStats => ({
    wallsPlaced: 0, bombsThrown: 0, wallsDestroyed: 0, powerUpsCollected: 0, resourcesStolen: 0,
  });
  return { phase: 'ready', duration: 0, winner: null, stats: { red: player(), blue: player() } };
}
