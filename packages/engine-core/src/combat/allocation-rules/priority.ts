/**
 * Public allocation-rule seam for combat consumers.
 *
 * The kernel stays import-free so its standalone source tests can still be
 * transpiled as a data URL.  These names are re-exported from the canonical
 * combat allocator and are the preferred production import for new consumers.
 */
export {
  compileDuelCombatPriorityRules,
  deriveDuelCombatAssignmentRulesFromIR,
  type DuelBaseCombatAssignmentRule,
  type DuelBaseCombatAssignmentRules,
} from '../base-combat-allocation.js';

