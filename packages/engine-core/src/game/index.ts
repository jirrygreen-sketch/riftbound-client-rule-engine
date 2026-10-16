/**
 * RIFT-262: Match lifecycle over the batch 4/5 rules layer.
 *
 * Match state stays with the host created by the caller; this module only
 * issues primitive actions and structural rules tasks through the same
 * TurnFlow / ChainEngine / EventPipeline path that production uses.
 */
export {
  createMatch,
  concede,
  type Match,
  type MatchOptions,
  type MatchSetupReport,
  type MatchDeck,
  type MatchResult,
  type MatchPrograms,
} from './lifecycle.js';
