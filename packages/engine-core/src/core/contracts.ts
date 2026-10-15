import type {
  GameEvent,
  EngineError,
  PlayerId
} from "@riftbound/protocol";
import type {
  CardEffect,
  DamageEffect,
  EffectTarget,
  FoundationPlayerState,
  GameObjectType,
  GameObject,
  Zone,
  GameState
} from "../state.js";

export type CreateGameOptions = {
  players: readonly {
    id: PlayerId;
    name: string;
  }[];
};

export type CardInstanceLike = {
  instanceId: string;
  cardId: string;
};

export type CreateGamePlayerOptions = {
  id: PlayerId;
  name: string;
  deck?: readonly CardInstanceLike[];
  startingHand?: readonly CardInstanceLike[];
  board?: readonly CardInstanceLike[];
  base?: readonly CardInstanceLike[];
  battlefield?: readonly CardInstanceLike[];
  champion?: readonly CardInstanceLike[];
  legend?: readonly CardInstanceLike[];
  rune?: readonly CardInstanceLike[];
  runeDeck?: readonly CardInstanceLike[];
};

export type DistributiveOmit<T, Keys extends keyof T> = T extends unknown
  ? Omit<T, Keys>
  : never;

export type GameEventInput = DistributiveOmit<
  GameEvent,
  "seq" | "turnNumber" | "activePlayerId"
>;

export type ObjectZone = Extract<Zone, "board" | "base" | "battlefield" | "champion" | "legend" | "rune">;
export type PrimaryObjectType = Extract<GameObjectType, "unit" | "spell" | "battlefield" | "champion" | "legend" | "rune">;

export const ZONE_INSTANCE_KEYS = {
  board: "board",
  base: "base",
  battlefield: "battlefield",
  champion: "champion",
  legend: "legend",
  rune: "rune"
} as const satisfies Record<ObjectZone, keyof FoundationPlayerState>;

export const OBJECT_TYPE_ZONES = {
  unit: "board",
  battlefield: "battlefield",
  champion: "champion",
  legend: "legend",
  rune: "rune"
} as const satisfies Record<Exclude<PrimaryObjectType, "spell">, ObjectZone>;

export type FoundationZoneList =
  | "deck" | "hand" | "board" | "base" | "battlefield" | "champion"
  | "legend" | "rune" | "rune-deck" | "discard" | "banish" | "chain";

export interface CommandResult {
  state: GameState;
  events: readonly GameEvent[];
  error: EngineError | null;
}

export type LegacyPromptReconcileStatus =
  | "unchanged"
  | "resolved"
  | "judge-required"
  | "rejected";

export interface LegacyPromptReconcileResult {
  /** A cloned state; the supplied state is never mutated. */
  state: GameState;
  changed: boolean;
  events: readonly GameEvent[];
  status: LegacyPromptReconcileStatus;
}

export type ValuedEffect = DamageEffect | Extract<CardEffect, { kind: "gain-points" }>;
export type { CardEffect, EffectTarget, GameObject, GameObjectType };
