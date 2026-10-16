export {
  bindReplacement,
  type ReplacementPlanContext
} from "./bind.js";
export {
  actionMatchesEventPattern,
  actionObjectRef,
  filterMatchesSnapshot,
  type PatternMatchInput,
  type PatternTarget
} from "./pattern.js";
export {
  planInstruction,
  planReplacementBody,
  type PlannerContext
} from "./planner.js";
export {
  BlockedReplacementError,
  REPLACED_EVENT_LINK,
  REPLACEMENT_ACTIVE_ZONES,
  type BoundReplacement,
  type ReplacementAbilityInput,
  type ReplacementDependencies,
  type ReplacementHostAdapter,
  type ReplacementPipelineAdapter,
  type ReplacementPlanInput
} from "./types.js";
