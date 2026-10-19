import type { PlayerId } from '../effects/contract.js';

export interface VictoryScoreView {
  readonly victoryScore: number;
}

export function validateVictoryScore(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Victory Score must be a positive safe integer');
  return value;
}

/** CR 323.1 / 474: at or above the threshold and strictly ahead. */
export function winnerAtCleanup(
  players: readonly PlayerId[],
  score: (player: PlayerId) => number,
  victoryScore: number,
): PlayerId | null {
  validateVictoryScore(victoryScore);
  const leader = players.find(player => score(player) >= victoryScore &&
    players.every(other => other === player || score(player) > score(other)));
  return leader ?? null;
}

export interface FinalPointDecision {
  /** The Conquer point is replaced by drawing one card (473.1.b.1). */
  readonly drawInstead: boolean;
}

export function finalPointDecision(
  currentScore: number,
  victoryScore: number,
  scoredEveryBattlefield: boolean,
): FinalPointDecision {
  validateVictoryScore(victoryScore);
  if (!Number.isSafeInteger(currentScore) || currentScore < 0) throw new TypeError('Player score must be a non-negative safe integer');
  return { drawInstead: currentScore >= victoryScore - 1 && !scoredEveryBattlefield };
}
