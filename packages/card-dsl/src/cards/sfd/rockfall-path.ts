import type { CardProgram } from "../../ir/index.js";

/**
 * Rockfall Path (sfd-216-221) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-216-221):
 *   "Units can't be played here."
 *
 * CR v1.5 anchors:
 * - 054 / 054.1 ("Can't beats Can"): this is a prohibition. It removes a play
 *   destination that other permissions (355.2.b) would otherwise make Valid;
 *   it never grants one.
 * - 355.2 / 355.2.a / 355.2.b: playing a Unit includes choosing a Valid
 *   Location (by default the controller's Base or a Battlefield they control),
 *   and Game Effects may add permitted locations. Those locations become Valid
 *   "for the purposes of Playing the Unit" (355.2.b) — which is exactly the
 *   step a prohibition on this Battlefield has to intercept.
 * - 053.3: Battlefields say "here", so the prohibited destination is this
 *   Battlefield itself.
 *
 * Status: judge-required. The merged surface has no way to install or consume
 * this prohibition (no approximation is written):
 * - continuous.restrict is a RIFT-9 inventory op with no instruction file under
 *   effects/instructions/ (the merged registry holds only the 31 effect.*
 *   primitives), and no merged layer consumer reads it: layers/engine.ts
 *   applyAbility records only movement permissions (kind containing
 *   "movement"), so a continuous.restrict ability-layer effect changes nothing.
 * - No merged producer turns a CardProgram static ability into a
 *   ContinuousEffectSpec registration at all (engine-core never reads card
 *   programs; callers must register effects themselves).
 * - Even with a registration, the merged unit-play slice
 *   (duel/cardplay-unit-v2.ts) binds only the actor's own Base as the entry
 *   location (baseLocationId -> board-base) and consults no Battlefield-level
 *   play restriction, and EffectIR has no play-destination restriction field
 *   (handled by Restriction in contract 3.1, which the chain Finalize check
 *   only accepts as caller-supplied Conditions).
 * The ability keeps the prohibition shape (card type, prohibited destination,
 * 054.1 semantics) for review; nothing here executes today. Dependencies:
 * RIFT-89 (play/cost plumbing, batch3-cost-plan) and the continuous.restrict
 * consumer owed by RIFT-91 layers-continuous.
 */
export default {
  canonicalCardId: "card.hash-0bf84d1f197b32b1d70c409fd2d0f0fe59c23923e72f6f7eeb77cb1e4376db7d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The prohibition 'Units can't be played here' (054/054.1, 355.2/355.2.b, 053.3) has no merged execution path. " +
    "continuous.restrict has no instruction file in effects/instructions/ (RIFT-9 inventory op only), and layers/engine.ts " +
    "applyAbility records only movement permissions, so no layer consumer reads a play restriction; no merged producer registers a " +
    "CardProgram static ability as a ContinuousEffectSpec either. The merged unit-play slice (duel/cardplay-unit-v2.ts) binds only the " +
    "actor's own Base as the entry location (baseLocationId to board-base) and consults no Battlefield play restriction. " +
    "Dependencies: RIFT-89 (play/cost plumbing) and the continuous.restrict consumer owed by RIFT-91 (layers-continuous). " +
    "The prohibition is recorded as a static continuous.restrict ability and is not approximated by an executable instruction.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        // 054.1: a prohibition only removes the option; it grants no permission.
        restriction: "units-cannot-be-played-here",
        prohibits: true,
        // The prohibited action and the population it applies to (355.2).
        action: "play",
        cardType: "unit",
        // "here" is this Battlefield (053.3); the merged ObjectFilter has no
        // source-battlefield anchor, so the destination is carried as the
        // sibling spelling used by rad/rakelstake and ogn/vilemaws-lair.
        location: "self",
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "Units can't be played here."
} satisfies CardProgram;
