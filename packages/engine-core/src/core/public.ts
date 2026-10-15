export {
  HOT_FEPR_STEPS,
  RULESET_ID,
  SYNTHETIC_RULESET_ID
} from "./constants.js";
export type { HotFeprStep } from "./constants.js";

export {
  createInitialGame,
  createConfiguredGame
} from "./setup.js";

export {
  submitCommand,
  reconcileLegacyPrompt,
  getHotFeprStep
} from "./commands.js";
export type {
  CommandResult,
  LegacyPromptReconcileResult,
  LegacyPromptReconcileStatus
} from "./contracts.js";

export {
  projectGame,
  projectZones,
  projectObject,
  createRoomSnapshot
} from "./projection.js";

export type {
  CardEffect,
  CreateConfiguredGameOptions,
  CreateGameRulesOptions,
  DamageEffect,
  EffectTarget,
  FoundationGameState,
  FoundationPlayerState,
  EngineCardDefinition,
  GameObject,
  GameObjectType,
  GameState,
  JudgeRequiredEffect,
  OutstandingTask,
  PlayerState,
  Zone,
  ZoneProjection
} from "../state.js";
export type {
  CardInstance,
  Command,
  EngineError,
  GameEvent,
  GameProjection,
  PlayerCommand,
  PlayerId,
  PlayerProjection,
  Prompt,
  PromptOption,
  RoomSnapshot
} from "@riftbound/protocol";
