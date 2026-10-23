import type {
  V2Command,
  V2PendingChoice,
  V2Projection
} from "../../../protocol/src/v2/index.js";

export const V2_DUEL_FIXED_SEEDS = [
  "RIFT-955-v2-02",
  "RIFT-955-v2-10",
  "RIFT-955-v2-11",
  "RIFT-955-v2-03",
  "RIFT-955-v2-07",
  "RIFT-955-v2-08"
] as const;

export type V2DuelTermination = "winner" | "blocked" | "guard";

export type V2DuelCoverageAction =
  | "play" | "play-target" | "rune-energy" | "rune-power" | "recycle"
  | "move" | "attack" | "defense" | "combat-damage" | "choose-optional"
  | "choose-mode" | "choose-select-objects" | "choose-order" | "choose-number"
  | "pass" | "advance" | "end-turn";

export interface V2DuelRejection {
  readonly playerId: string;
  readonly commandId: string;
  readonly commandType: V2Command["type"] | "recorded";
  readonly code: string;
  readonly reason: string;
  readonly phase: V2Projection["phase"];
  readonly turnNumber: number;
  readonly cardName: string | null;
}

export interface V2DuelSideStats {
  readonly playerId: string;
  readonly precon: "rumble-sfd" | "fiora-sfd";
  readonly rejectedCommandCount: number;
  readonly firstRejections: readonly V2DuelRejection[];
}

export interface V2DuelResult {
  readonly seed: string;
  readonly firstPlayerId: string;
  readonly firstPlayerSeat: "player-1" | "player-2";
  readonly turnCount: number;
  readonly score: Readonly<Record<string, number>>;
  readonly winnerPlayerId: string | null;
  readonly termination: V2DuelTermination;
  readonly blockedReason: string | null;
  readonly rejectedCommands: Readonly<Record<string, number>>;
  readonly rejectionReasons: Readonly<Record<string, readonly V2DuelRejection[]>>;
  readonly judgeRequiredOccurrences: Readonly<Record<string, number>>;
  readonly judgeRequiredCards: readonly string[];
  readonly judgeRequiredProjectionExposure: readonly {
    readonly playerId: string;
    readonly cardIds: readonly string[];
  }[];
  readonly privacy: {
    readonly passed: boolean;
    readonly checkedProjections: number;
    readonly violations: readonly string[];
  };
  readonly commandCount: number;
  readonly coverage: Readonly<Record<V2DuelCoverageAction, number>>;
  readonly trace: readonly {
    readonly index: number;
    readonly playerId: string;
    readonly type: V2Command["type"];
    readonly accepted: boolean;
    readonly stateVersion: number;
    readonly phase: V2Projection["phase"];
    readonly cardName: string | null;
    readonly code?: string;
    readonly rejection?: string;
  }[];
  readonly elapsedMs: number;
  readonly sides: readonly [V2DuelSideStats, V2DuelSideStats];
}

export interface V2DuelSummary {
  readonly games: number;
  readonly winners: number;
  readonly blocked: number;
  readonly guards: number;
  readonly winnerRatio: number;
  readonly winsBySeat: Readonly<Record<string, number>>;
  readonly firstPlayerWins: number;
  readonly firstPlayerWinRatio: number;
  readonly averageTurns: number;
  readonly blockerDistribution: Readonly<Record<string, number>>;
  readonly results: readonly V2DuelResult[];
}

export interface PendingChoiceSnapshot extends Extract<V2PendingChoice, { readonly status: "pending" }> {}
