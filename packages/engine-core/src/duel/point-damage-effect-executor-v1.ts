/**
 * Point-damage v1 is the narrow Core adapter for the source-bound point
 * damage IR.  The lifecycle, epoch, native-commit and response-window guards
 * remain in the protected V2 kernel; this module only admits the independent
 * point-damage semantic tag and exposes a versioned API for its caller.
 */

import {
  createDuelKillDamageEffectAuthorityV2,
  beginDuelKillDamageEffectV2,
  submitDuelKillDamageEffectChoiceV2,
  resumeDuelKillDamageEffectV2,
  type DuelKillDamageEffectAuthorityOptionsV2,
  type DuelKillDamageEffectAuthorityV2,
  type DuelKillDamageEffectCursorV2,
  type DuelKillDamageChoiceV2,
  type DuelKillDamageEffectResultV2,
  type DuelKillDamageBlockCodeV2,
  type DuelDamageProposalV2,
  type DuelLethalCandidateProofV2,
  type DuelLethalProofRequestV2,
  DuelKillDamageEffectBlockedErrorV2,
} from "./kill-damage-effect-executor-v2.js";
import { enumerateDuelObjectsV2 } from "./core-v2.js";

import type { DuelOfficialProgramRegistry } from "@riftbound/card-dsl/duel";

export { DuelKillDamageEffectBlockedErrorV2 } from "./kill-damage-effect-executor-v2.js";

export type DuelPointDamageEffectAuthorityOptionsV1 = DuelKillDamageEffectAuthorityOptionsV2;
export type DuelPointDamageEffectAuthorityV1 = DuelKillDamageEffectAuthorityV2;
export type DuelPointDamageEffectCursorV1 = DuelKillDamageEffectCursorV2;
export type DuelPointDamageEffectChoiceV1 = DuelKillDamageChoiceV2;
export type DuelPointDamageEffectResultV1 = DuelKillDamageEffectResultV2;
export type DuelPointDamageProposalV1 = DuelDamageProposalV2;
export type DuelPointLethalCandidateProofV1 = DuelLethalCandidateProofV2;
export type DuelPointLethalProofRequestV1 = DuelLethalProofRequestV2;

function reject(code: DuelKillDamageBlockCodeV2 = "source-program-mismatch"): never {
  throw new DuelKillDamageEffectBlockedErrorV2(code);
}

function assertPointDamageProgram(options: DuelPointDamageEffectAuthorityOptionsV1): void {
  const source = options?.source;
  if (!source || source.phase !== "spell-resolution") reject();
  try {
    const live = enumerateDuelObjectsV2(options.state).find((entry) => entry.uid === source.sourceUID);
    if (!live || live.zone.kind !== "chain") reject("source-not-live");
  } catch (error) {
    if (error instanceof DuelKillDamageEffectBlockedErrorV2) throw error;
    reject("source-not-live");
  }
  try {
    const registry = options.registry as DuelOfficialProgramRegistry;
    if (registry === null || typeof registry !== "object" ||
        typeof registry.reference !== "function" || typeof registry.resolve !== "function") reject();
    const reference = registry.reference(source.cardId);
    if (!reference || reference.cardId !== source.cardId || reference.programId !== source.programId ||
        reference.dataVersion !== source.dataVersion || reference.sourceCatalogDigest !== source.catalogDigest) reject();
    const binding = registry.resolve(reference);
    if (binding.status !== "resolved" || binding.program === null ||
        binding.program.semantics.kind !== "point-damage-spell-resolution" ||
        binding.program.semantics.effects.length !== 1 ||
        binding.program.semantics.effects[0]?.kind !== "point-damage") reject();
  } catch (error) {
    if (error instanceof DuelKillDamageEffectBlockedErrorV2) throw error;
    reject();
  }
}

/** Issue a point-damage authority only for the independent point-damage IR. */
export function createDuelPointDamageEffectAuthorityV1(
  options: DuelPointDamageEffectAuthorityOptionsV1,
): DuelPointDamageEffectAuthorityV1 {
  assertPointDamageProgram(options);
  return createDuelKillDamageEffectAuthorityV2(options);
}

export function beginDuelPointDamageEffectV1(
  authority: DuelPointDamageEffectAuthorityV1,
): DuelPointDamageEffectResultV1 {
  return beginDuelKillDamageEffectV2(authority);
}

export function submitDuelPointDamageEffectChoiceV1(
  authority: DuelPointDamageEffectAuthorityV1,
  choice: DuelPointDamageEffectChoiceV1,
): DuelPointDamageEffectResultV1 {
  return submitDuelKillDamageEffectChoiceV2(authority, choice);
}

export function resumeDuelPointDamageEffectV1(
  cursor: DuelPointDamageEffectCursorV1,
  choice: DuelPointDamageEffectChoiceV1,
  state: DuelPointDamageEffectAuthorityOptionsV1["state"],
): DuelPointDamageEffectResultV1 {
  return resumeDuelKillDamageEffectV2(cursor, choice, state);
}

export const resolveDuelPointDamageEffectV1 = submitDuelPointDamageEffectChoiceV1;
