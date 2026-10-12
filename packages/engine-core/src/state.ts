import type {
  CardInstance,
  GameEvent,
  PlayerId,
  Prompt
} from "@riftbound/protocol";

export type Zone =
  | "deck"
  | "hand"
  | "board"
  | "base"
  | "battlefield"
  | "champion"
  | "legend"
  | "rune"
  | "rune-deck"
  | "discard"
  | "banish"
  | "chain";

export type GameObjectType =
  | "unit"
  | "spell"
  | "battlefield"
  | "champion"
  | "legend"
  | "rune"
  | "base"
  | "token";

export interface GameObject {
  objectId: string;
  instanceId: string;
  cardId: string;
  ownerPlayerId: PlayerId;
  controllerPlayerId: PlayerId;
  zone: Zone;
  damage: number;
  counters: Readonly<Record<string, number>>;
}

export type EffectTarget =
  | { kind: "player"; playerId: PlayerId }
  | { kind: "object"; objectId: string };

export interface DamageEffect {
  kind: "damage";
  amount: number;
  targets: readonly EffectTarget[];
}

export interface GainPointsEffect {
  kind: "gain-points";
  amount: number;
  targets: readonly EffectTarget[];
}

export interface JudgeRequiredEffect {
  kind: "judge-required";
  reason: string;
}

export type CardEffect =
  | DamageEffect
  | GainPointsEffect
  | JudgeRequiredEffect;

export interface EngineCardDefinition {
  id: string;
  name: string;
  cost: number;
  types: readonly GameObjectType[];
  health?: number;
  effect?: CardEffect;
}

export interface CreateGamePlayerOptions {
  id: PlayerId;
  name: string;
  deck?: readonly CardInstance[];
  startingHand?: readonly CardInstance[];
  board?: readonly CardInstance[];
  base?: readonly CardInstance[];
  battlefield?: readonly CardInstance[];
  champion?: readonly CardInstance[];
  legend?: readonly CardInstance[];
  rune?: readonly CardInstance[];
  runeDeck?: readonly CardInstance[];
}

export type RulesetId = "synthetic-demo" | "riftbound-foundation";

export interface CreateGameRulesOptions {
  rulesetId?: RulesetId;
  startingPoints?: number;
  targetPoints?: number;
  startingRunes?: number;
  startingEnergy?: number;
  maximumRunes?: number;
  maximumEnergy?: number;
  drawOnTurnStart?: boolean;
  battlefieldCapacity?: number;
}

export interface CreateConfiguredGameOptions {
  players: readonly CreateGamePlayerOptions[];
  cards: readonly EngineCardDefinition[];
  rules?: CreateGameRulesOptions;
}

export interface GameRules {
  rulesetId: RulesetId;
  startingPoints: number;
  targetPoints: number;
  startingRunes: number;
  startingEnergy: number;
  maximumRunes: number;
  maximumEnergy: number;
  drawOnTurnStart: boolean;
  battlefieldCapacity: number;
}

export interface SyntheticGameRules extends GameRules {
  rulesetId: "synthetic-demo";
}

export interface FoundationGameRules extends GameRules {
  rulesetId: "riftbound-foundation";
}

export interface ZoneProjection {
  deck: readonly string[];
  hand: readonly CardInstance[];
  board: readonly string[];
  base: readonly string[];
  battlefield: readonly string[];
  champion: readonly string[];
  legend: readonly string[];
  rune: readonly string[];
  runeDeck: readonly string[];
  discard: readonly string[];
  banish: readonly string[];
  chain: readonly string[];
}

export interface FoundationPlayerState {
  id: PlayerId;
  name: string;
  score: number;
  energy: number;
  power: Record<string, number>;
  deck: string[];
  hand: CardInstance[];
  board: string[];
  base: string[];
  battlefield: string[];
  champion: string[];
  legend: string[];
  rune: string[];
  runeDeck: string[];
  discard: string[];
  banish: string[];
  chain: string[];
}

export interface SyntheticPlayerState {
  id: PlayerId;
  name: string;
  points: number;
  runes: number;
  hand: CardInstance[];
}

export type PlayerState = SyntheticPlayerState | FoundationPlayerState;

export interface OutstandingTask {
  id: string;
  sourceCardId: string;
  sourceObjectId: string;
  sourcePlayerId: PlayerId;
  reason: string;
  optional: boolean;
  effect?: CardEffect;
  targetChoices?: readonly EffectTarget[];
  requiresTargetChoice?: boolean;
}

export type SyntheticGameState = GameStateShape<
  SyntheticPlayerState,
  SyntheticGameRules
>;
export type FoundationGameState = GameStateShape<
  FoundationPlayerState,
  FoundationGameRules
>;

export type GameState =
  | SyntheticGameState
  | FoundationGameState;

export interface GameStateShape<Player, Rules extends GameRules> {
  version: number;
  eventSeq: number;
  turnNumber: number;
  phase: "main" | "ended";
  turnPhase: "main" | "combat" | "cleanup" | "ended";
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  winnerPlayerId: PlayerId | null;
  rules: Rules;
  cards: Record<string, EngineCardDefinition>;
  objects: Record<string, GameObject>;
  players: readonly Player[];
  prompt: Prompt | null;
  outstandingTasks: OutstandingTask[];
  eventLog: GameEvent[];
}
