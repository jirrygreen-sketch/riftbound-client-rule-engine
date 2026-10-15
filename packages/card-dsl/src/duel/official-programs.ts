/**
 * Strict, source-bound Duel official ability programs.
 *
 * This is deliberately a small, independent IR.  It is not the experimental
 * full-product EffectIR, does not import Core state types, and does not execute
 * any card effect.  A program describes the complete verified meaning of one
 * printing (or explicitly reports that the printing is unresolved).  Token
 * creation, timing, target selection, payment and scoring remain executor
 * responsibilities.
 *
 * The source envelope is a projection of an upstream verified catalog.  This
 * module checks the complete printing tuple it receives and carries the
 * catalog's dataVersion/digest, but it does not recompute or authenticate the
 * digest.  Origin sourceUID/epoch attestation is intentionally outside this
 * package.
 */

import {
  ENTER_READY_TEXT,
  GANKING_REMINDER_TEXT,
  normalizeAbilityText,
} from "./ability-bindings.js";
import { describeDuelAssaultV1 } from "./assault-description-v1.js";
import {
  describeDuelShieldV1,
  DUEL_SHIELD_CATALOG_DATA_VERSION,
  DUEL_SHIELD_CATALOG_DIGEST,
} from "./shield-description-v1.js";
import {
  DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS,
  describeDuelOptionalPlayCostV1,
} from "./optional-play-cost-v1.js";
import type { DuelOptionalPlayCostV1Semantics } from "./optional-play-cost-v1.js";
import {
  describeDuelPointDamageV1,
  type DuelPointDamageLocationV1,
} from "./point-damage-description-v1.js";
import {
  describeDuelEquipV1,
  DUEL_EQUIP_RUNE_DOMAINS,
  type DuelEquipV1PowerCost,
} from "./equip-description-v1.js";
import { describeDuelBeginningDrawV1 } from "./beginning-draw-description-v1.js";

export const DUEL_OFFICIAL_IR_KIND = "duel-official-program" as const;
export const DUEL_OFFICIAL_IR_SCHEMA_VERSION = 1 as const;
export const DUEL_OFFICIAL_RULESET = "riftbound-duel-official-v1" as const;
export const DUEL_OFFICIAL_REFERENCE_KIND = "duel-official-program-reference" as const;
export const DUEL_OFFICIAL_REFERENCE_SCHEMA_VERSION = 1 as const;

/** Whole Premonition text in the verified catalog; CR 813.1.c/813.3.
 * Extra costs, Hidden, additional instructions or conditions do not match. */
export const DUEL_PREMONITION_REACTION_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\nDraw 3.";

/** CR 187.5, not a catalog card or a client-registerable printing program. */
export const DUEL_GOLD_INTRINSIC_REFERENCE_KIND = "duel-intrinsic-token-ability-reference" as const;
export const DUEL_GOLD_INTRINSIC_ABILITY_KIND = "duel-intrinsic-token-ability" as const;
export const DUEL_GOLD_INTRINSIC_SCHEMA_VERSION = 1 as const;
export const DUEL_GOLD_INTRINSIC_ID = `${DUEL_OFFICIAL_RULESET}:intrinsic-token:gold-gear` as const;

export interface DuelGoldIntrinsicAbilityReference {
  readonly kind: typeof DUEL_GOLD_INTRINSIC_REFERENCE_KIND;
  readonly schemaVersion: typeof DUEL_GOLD_INTRINSIC_SCHEMA_VERSION;
  readonly ruleset: typeof DUEL_OFFICIAL_RULESET;
  readonly intrinsicId: typeof DUEL_GOLD_INTRINSIC_ID;
}

/** A rule-bound token ability, deliberately separate from printing programs. */
export interface DuelGoldIntrinsicTokenAbilitySpec {
  readonly kind: typeof DUEL_GOLD_INTRINSIC_ABILITY_KIND;
  readonly schemaVersion: typeof DUEL_GOLD_INTRINSIC_SCHEMA_VERSION;
  readonly ruleset: typeof DUEL_OFFICIAL_RULESET;
  readonly intrinsicId: typeof DUEL_GOLD_INTRINSIC_ID;
  readonly sourceRule: "CR-v1.4:187.5";
  readonly token: "Gold gear token";
  readonly event: "activate";
  /** Reaction permits activation in Closed States; timing/ready checks belong to the executor. */
  readonly permission: "reaction";
  readonly sourceScope: "source-gold-gear-token";
  /** CR 187.5 order: Kill this, [E]. Both are costs, neither is an effect. */
  readonly costs: readonly [{ readonly kind: "kill-source" }, DuelExhaustSourceCost];
  readonly effects: readonly [{
    readonly kind: "add-universal-power";
    readonly amount: 1;
    readonly recipient: "ability-controller";
    readonly destination: "rune-pool";
    readonly expiration: "rune-pool-reset";
  }];
}

/** The catalog fields that are part of the source-bound printing tuple. */
export interface DuelSourcePrintingCard {
  readonly id: string;
  readonly cardType: string;
  readonly ability: string | null | undefined;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly canonicalCardId: string;
  readonly name: string;
  readonly fullName: string;
  readonly localizedName: string;
  readonly setCode: string;
  readonly cardNumber: string;
  readonly variant: string;
}

/** A complete source envelope from the upstream verified catalog layer. */
export interface DuelAbilitySource {
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
  readonly cards: readonly DuelSourcePrintingCard[];
}

export interface DuelCatalogEnvelope {
  readonly dataVersion: string;
  readonly digest: string;
  readonly cards: readonly DuelSourcePrintingCard[];
}

export type DuelStaticAbilityKind = "ganking" | "enter-ready";

export interface DuelStaticAbility {
  readonly kind: DuelStaticAbilityKind;
  readonly subject: "self";
  readonly scope: "standard-move" | "unit-enter";
  readonly mode: "permission" | "replacement";
}

export interface DuelStaticSemantics {
  readonly kind: "static";
  readonly abilities: readonly DuelStaticAbility[];
}

export interface DuelNoAbilityPlayability {
  readonly kind: "printed-unit" | "recruit-token";
  readonly fromHand: boolean;
  readonly energyCost: number | null;
  readonly tokenOnly: boolean;
}

export interface DuelNoAbilitySemantics {
  readonly kind: "no-ability";
  readonly playability: DuelNoAbilityPlayability;
}

export interface DuelCondition {
  readonly kind: "assigned-excess-damage-at-least";
  readonly amount: 3;
}

export interface DuelEnergyCost {
  readonly kind: "energy";
  readonly amount: 1;
  readonly payer: "ability-controller";
}

export interface DuelExhaustSourceCost {
  readonly kind: "exhaust-source";
}

/** CR 164.2.b: recycle is the cost, not an exhaust or an Energy payment. */
export interface DuelRecycleBasicRuneCost {
  readonly kind: "recycle-source";
  readonly destination: "source-owner-rune-deck";
  /** Recycling an already exhausted Rune is legal; Core checks the live source. */
  readonly readiness: "ready-or-exhausted";
}

export type DuelBasicRuneDomain = "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order";

export interface DuelAddEnergyEffect {
  readonly kind: "add-energy";
  readonly amount: 1;
  readonly recipient: "ability-controller";
  readonly destination: "rune-pool";
  readonly expiration: "rune-pool-reset";
}

export interface DuelAddBasicRuneDomainPowerEffect {
  readonly kind: "add-domain-power";
  readonly amount: 1;
  /** Bound printing's sole domain; runtime must attest the physical source Rune. */
  readonly domain: DuelBasicRuneDomain;
  readonly domainSource: "source-rune-domain";
  readonly recipient: "ability-controller";
  readonly destination: "rune-pool";
  readonly expiration: "rune-pool-reset";
}

export type DuelCost = DuelEnergyCost | DuelExhaustSourceCost | DuelRecycleBasicRuneCost;

export interface DuelReadyUnitEffect {
  readonly kind: "ready-unit";
  readonly target: {
    readonly kind: "unit";
    /** `any` is intentional: the source text does not say friendly/your. */
    readonly controller: "any";
    readonly scope: "legal-unit";
  };
}

export interface DuelRecruitTokenSpec {
  readonly kind: "unit-token";
  readonly cardType: "Unit";
  readonly domains: readonly [];
  readonly domainless: true;
  readonly tags: readonly ["Recruit"];
  readonly energy: null;
  readonly power: null;
  readonly might: 1;
  /** A token effect does not select a physical catalog printing. */
  readonly physicalPrintingCardId: null;
}

export interface DuelPlayRecruitTokenEffect {
  readonly kind: "play-recruit-token";
  readonly token: DuelRecruitTokenSpec;
  /** The later executor resolves this relative to the effect controller. */
  readonly controller: "effect-controller";
  readonly owner: "effect-controller";
  readonly destination: "base" | "executor-defined";
  /** This module never creates an engine unit or claims a resolved play. */
  readonly resolution: "deferred-token-play";
}

/** CR 187.5: a Gear Game Object, not a physical card or a 1-Might Recruit. */
export interface DuelGoldGearTokenSpec {
  readonly kind: "gear-token";
  readonly tokenName: "Gold";
  readonly cardType: "Gear";
  readonly domains: readonly [];
  readonly domainless: true;
  readonly energy: null;
  readonly power: null;
  readonly might: null;
  readonly physicalPrintingCardId: null;
  /** CR 149.1. The creating effect below overrides this default. */
  readonly defaultEntryReady: true;
  readonly intrinsicAbility: DuelGoldIntrinsicAbilityReference;
}

export interface DuelPlayGoldGearTokenEffect {
  readonly kind: "play-gold-gear-token";
  readonly token: DuelGoldGearTokenSpec;
  /** CR 182/183: effect controller controls the creating ability/effect. */
  readonly controller: "effect-controller";
  readonly owner: "effect-controller";
  /** CR 149.2: Gear can only be played to a player's Base absent a stated override. */
  readonly destination: "effect-controller-base";
  /** CR 184.1: explicitly overrides Gear's Ready entry; NOT immediately spendable. */
  readonly entryExhausted: true;
  readonly resolution: "deferred-token-play";
}

/** CR 413. The executor must preserve Burn Out and Recycle continuations. */
export interface DuelDrawCardsEffect {
  readonly kind: "draw-cards";
  readonly amount: number;
  readonly recipient: "effect-controller";
}

export type DuelKillUnitEffect =
  | { readonly kind: "kill-unit"; readonly controller: "any" | "enemy"; readonly selection: "target" }
  | { readonly kind: "kill-units"; readonly controller: "any"; readonly selection: "all" }
  | { readonly kind: "each-player-kills-unit"; readonly selection: "each-player-choice" };

export interface DuelDealDamageEffect {
  readonly kind: "deal-damage";
  readonly amount: 6;
  readonly distribution: "each";
  readonly targets: { readonly kind: "unit"; readonly controller: "any";
    readonly minSelections: 0; readonly maxSelections: 2 };
}

/** Independent IR tag for the four reviewed single-target point-damage Spells. */
export interface DuelPointDamageEffect {
  readonly kind: "point-damage";
  readonly amount: 2 | 3 | 6 | 8;
  readonly target: {
    readonly kind: "unit";
    readonly controller: "any";
    readonly location: DuelPointDamageLocationV1;
    readonly minSelections: 1;
    readonly maxSelections: 1;
  };
}

export interface DuelPointDamageSpellResolutionSemantics {
  readonly kind: "point-damage-spell-resolution";
  readonly effects: readonly [DuelPointDamageEffect];
}

export interface DuelReadySourceEffect { readonly kind: "ready-source" }

export type DuelEffect = DuelReadyUnitEffect | DuelPlayRecruitTokenEffect | DuelPlayGoldGearTokenEffect |
  DuelDrawCardsEffect | DuelKillUnitEffect | DuelDealDamageEffect | DuelPointDamageEffect | DuelReadySourceEffect;

/** Only whole, verified Spell instructions are represented by this variant. */
export interface DuelSpellResolutionSemantics {
  readonly kind: "spell-resolution";
  readonly permission?: "reaction";
  readonly effects: readonly [DuelDrawCardsEffect | DuelKillUnitEffect | DuelDealDamageEffect];
}

/** These are separate events; a generic play event never proves their predicates. */
export type DuelUnitEventTriggerSemantics = {
  readonly kind: "trigger";
  readonly event: "unit-enter" | "play-gear" | "card-play-on-opponent-turn";
  readonly sourceScope: "played-source-unit" | "controller-plays-gear" | "controller-plays-card-on-opponent-turn";
  readonly eventPredicate:
    | { readonly kind: "source-play-completed"; readonly source: "ability-source"; readonly countered: false }
    | { readonly kind: "controller-play-completed"; readonly actor: "source-controller-at-event";
        readonly cardType: "Gear" | "any"; readonly turn: "any" | "opponent"; readonly countered: false };
  readonly condition: null;
  readonly optional: false;
  readonly costs: readonly [];
  readonly effects: readonly [DuelDrawCardsEffect | DuelKillUnitEffect | DuelReadySourceEffect | DuelPlayRecruitTokenEffect];
};

export interface DuelContinuousTokenMightSemantics {
  readonly kind: "continuous";
  readonly sourceScope: "source-unit-on-board";
  readonly modifier: { readonly kind: "token-unit-might"; readonly amount: 1;
    readonly controller: "ability-controller"; readonly scope: "board" };
}

export interface DuelConquerTriggerSemantics {
  readonly kind: "trigger";
  readonly event: "conquer";
  readonly sourceScope: "ability-source";
  readonly condition: DuelCondition;
  readonly optional: true;
  readonly costs: readonly [DuelExhaustSourceCost];
  readonly effects: readonly [DuelReadyUnitEffect];
}

/** CR 383.4.c.2.a: this participating Unit was present at the conquered Battlefield.
 * The conquer remains an event even if the victory point is negated or replaced.
 * A controller-conquers predicate ("When you conquer") is not interchangeable.
 */
export interface DuelSourceUnitConquerTriggerSemantics {
  readonly kind: "trigger";
  readonly event: "conquer";
  readonly sourceScope: "conquering-source-unit";
  readonly eventPredicate: {
    readonly kind: "source-unit-present-at-conquered-battlefield";
    readonly participant: "ability-source-unit";
    readonly battlefield: "conquered-battlefield";
    /** CR 383.4.c.2.c: the conquest event is not erased by a point replacement. */
    readonly pointOutcome: "including-negated-or-replaced";
  };
  readonly condition: null;
  readonly optional: false;
  readonly costs: readonly [];
  readonly effects: readonly [DuelPlayGoldGearTokenEffect];
}

export interface DuelHoldTriggerSemantics {
  readonly kind: "trigger";
  readonly event: "hold";
  /** The holder/controller of this battlefield, not an arbitrary player. */
  readonly sourceScope: "battlefield-controller";
  readonly condition: null;
  readonly optional: false;
  readonly costs: readonly [];
  readonly effects: readonly [DuelPlayRecruitTokenEffect | DuelDrawCardsEffect];
}

export type DuelTriggerSemantics = DuelConquerTriggerSemantics | DuelSourceUnitConquerTriggerSemantics |
  DuelHoldTriggerSemantics | DuelUnitEventTriggerSemantics;

export interface DuelActivatedSemantics {
  readonly kind: "activated";
  readonly event: "activate";
  readonly sourceScope: "ability-source";
  readonly costs: readonly [DuelEnergyCost, DuelExhaustSourceCost];
  readonly effects: readonly [DuelPlayRecruitTokenEffect];
}

export interface DuelPassiveSemantics {
  readonly kind: "passive";
  readonly event: "hide";
  readonly sourceScope: "source-battlefield";
  readonly modifier: {
    readonly kind: "additional-hide-permission";
    readonly amount: 1;
    readonly optional: true;
    readonly scope: "source-battlefield";
  };
}

/** CR 807: the narrow printed Assault passive.  No granted, aura, conditional,
 * dynamic or multi-instruction Assault is represented by this program. */
export interface DuelAssaultPassiveSemantics {
  readonly kind: "passive";
  readonly event: "attacker";
  readonly sourceScope: "source-unit-on-board";
  readonly modifier: {
    readonly kind: "self-assault";
    readonly amount: number;
  };
}

/** CR 814: the narrow printed Shield passive.  No granted, aura, conditional,
 * dynamic or multi-instruction Shield is represented by this program. */
export interface DuelShieldPassiveSemantics {
  readonly kind: "passive";
  readonly event: "defender";
  readonly sourceScope: "source-unit-on-board";
  readonly modifier: {
    readonly kind: "self-shield";
    readonly amount: number;
  };
}

/**
 * The two complete Vi, Destructive printings.  This is deliberately a
 * separate semantic kind: the Recycle instruction selects one card from the
 * controller's trash and the resulting Might bonus targets this Unit.  It is
 * not the older Legend activation that plays a Recruit token.
 */
export interface DuelViTrashRecycleCost {
  readonly kind: "recycle-from-trash";
  readonly amount: 1;
  readonly selector: "one-card";
  readonly zone: "controller-trash";
  readonly payer: "ability-controller";
}

export interface DuelViSelfMightEffect {
  readonly kind: "add-might";
  readonly amount: 1;
  readonly recipient: "ability-source-unit";
  readonly duration: "this-turn";
}

export interface DuelViDestructiveCompoundSemantics {
  readonly kind: "compound-vi-self";
  readonly sourceScope: "source-unit-on-board";
  readonly ganking: {
    readonly kind: "ganking";
    readonly subject: "self";
    readonly scope: "standard-move";
    readonly mode: "permission";
  };
  readonly activation: {
    readonly event: "activate";
    readonly sourceScope: "source-unit-on-board";
    readonly costs: readonly [DuelViTrashRecycleCost];
    readonly effects: readonly [DuelViSelfMightEffect];
  };
}

/** CR 809.1.c/d: each choice imposes a mandatory additional play cost. */
export interface DuelDeflectSemantics {
  readonly kind: "deflect";
  readonly sourceScope: "source-unit-on-board";
  readonly event: "opponent-choice";
  readonly modifier: {
    readonly kind: "additional-opponent-power-cost";
    readonly amount: 1;
    readonly powerDomain: "wildcard";
    readonly payer: "opponent";
    readonly timing: "additional-play-cost";
    readonly per: "each-choice-of-source";
    readonly optional: false;
    readonly automaticPayment: false;
    readonly choice: {
      readonly source: "spell-or-ability";
      readonly target: "source-unit-on-board";
    };
  };
}

/**
 * CR 818.1.c.2: the narrow, source-closed resource-only Equip ability.  The
 * descriptor's literal is carried in full; the runtime status deliberately
 * remains pending until Core supplies source-controller and activation services.
 */
export interface DuelEquipActivatedAbilitySemantics {
  readonly kind: "equip-activated-ability";
  readonly event: "activate";
  readonly sourceScope: "source-gear-on-board";
  readonly abilityClass: "activated-ability";
  readonly cost: {
    readonly kind: "base-cost";
    readonly literal: string;
    readonly energy: number;
    readonly power: DuelEquipV1PowerCost | null;
    readonly nonResourceLiteral: null;
  };
  readonly costAlternatives: readonly [];
  readonly costAlterations: readonly [];
  readonly target: {
    readonly kind: "unit";
    readonly controller: "source-controller";
    readonly scope: "controlled-unit";
    readonly selection: "target";
  };
  readonly attach: {
    readonly kind: "attach-source-gear";
    readonly destination: "target-unit";
    readonly resolution: "deferred-attachment";
  };
  readonly timing: "main-open-outside-showdown";
  readonly runtime: {
    readonly status: "pending";
    readonly required: readonly ["canonical-source-controller", "equip-activation-executor"];
  };
}

/** CR 383.2.a.1: Loose Cannon's effect-side hand condition. */
export interface DuelBeginningDrawSemantics {
  readonly kind: "beginning-phase-conditional-draw";
  readonly trigger: {
    readonly event: "beginning-phase";
    readonly phase: "begin";
    readonly step: "beginning-step";
    readonly scope: "controller-beginning-phase";
    readonly timing: "start";
    readonly enqueue: "unconditional-pending-item";
  };
  readonly effect: {
    readonly kind: "draw-cards";
    readonly amount: 1;
    readonly recipient: "ability-controller";
    readonly condition: {
      readonly kind: "hand-size-at-most";
      readonly maximum: 1;
      readonly scope: "ability-controller-hand";
      readonly clauseRole: "effect";
      readonly evaluatedAt: "resolution";
      readonly readsPublicInformationOnly: true;
    };
  };
  readonly controller: {
    readonly kind: "ability-controller";
    readonly source: "canonical-source-controller";
    readonly status: "pending";
  };
  readonly runtime: {
    readonly status: "pending";
    readonly required: readonly ["canonical-source-controller", "beginning-phase-trigger-executor", "draw-burnout-continuation"];
  };
}

/** CR 164.2 grants both abilities to Basic Runes; neither is printed text. */
export interface DuelBasicRuneSemantics {
  readonly kind: "basic-rune";
  readonly sourceRule: "CR-v1.4:164.2";
  readonly domain: DuelBasicRuneDomain;
  readonly abilities: readonly [
    {
      readonly kind: "basic-rune-energy";
      readonly sourceRule: "CR-v1.4:164.2.a";
      readonly event: "activate";
      readonly sourceScope: "source-basic-rune";
      readonly permission: "reaction";
      readonly costs: readonly [DuelExhaustSourceCost];
      readonly effects: readonly [DuelAddEnergyEffect];
    },
    {
      readonly kind: "basic-rune-power";
      readonly sourceRule: "CR-v1.4:164.2.b/164.2.b.1";
      readonly event: "activate";
      readonly sourceScope: "source-basic-rune";
      readonly permission: "reaction";
      readonly costs: readonly [DuelRecycleBasicRuneCost];
      readonly effects: readonly [DuelAddBasicRuneDomainPowerEffect];
    },
  ];
}

export type DuelProgramSemantics =
  | DuelStaticSemantics
  | DuelNoAbilitySemantics
  | DuelTriggerSemantics
  | DuelActivatedSemantics
  | DuelPassiveSemantics
  | DuelAssaultPassiveSemantics
  | DuelShieldPassiveSemantics
  | DuelSpellResolutionSemantics
  | DuelPointDamageSpellResolutionSemantics
  | DuelContinuousTokenMightSemantics
  | DuelBasicRuneSemantics
  | DuelViDestructiveCompoundSemantics
  | DuelDeflectSemantics
  | DuelEquipActivatedAbilitySemantics
  | DuelBeginningDrawSemantics
  /** Explicit opt-in only: the whole pure Accelerate optional play choice. */
  | DuelOptionalPlayCostV1Semantics;

/** Exact source fingerprint embedded in every resolved program. */
export interface DuelProgramSourceFingerprint {
  readonly cardId: string;
  readonly cardType: string;
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly canonicalCardId: string;
  readonly name: string;
  readonly fullName: string;
  readonly localizedName: string;
  readonly setCode: string;
  readonly cardNumber: string;
  readonly variant: string;
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
}

export interface DuelOfficialProgram {
  readonly kind: typeof DUEL_OFFICIAL_IR_KIND;
  readonly schemaVersion: typeof DUEL_OFFICIAL_IR_SCHEMA_VERSION;
  readonly ruleset: typeof DUEL_OFFICIAL_RULESET;
  readonly programId: string;
  readonly cardId: string;
  readonly source: DuelProgramSourceFingerprint;
  readonly semantics: DuelProgramSemantics;
}

export type DuelUnresolvedReason =
  | "unsupported-whole-ability"
  | "empty-unit-is-not-a-verified-playability-template"
  | "equip-non-resource-cost"
  | "equip-cost-alteration"
  | "equip-timing-or-target-alteration";

export interface DuelOfficialProgramBinding {
  readonly status: "resolved" | "unknown";
  readonly cardId: string;
  readonly sourceDataVersion: string;
  readonly sourceCatalogDigest: string;
  readonly normalizedAbilityText: string;
  readonly program: DuelOfficialProgram | null;
  readonly unresolvedReason?: DuelUnresolvedReason;
}

export interface DuelOfficialProgramReference {
  readonly kind: typeof DUEL_OFFICIAL_REFERENCE_KIND;
  readonly schemaVersion: typeof DUEL_OFFICIAL_REFERENCE_SCHEMA_VERSION;
  readonly programId: string;
  readonly cardId: string;
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
}

export type DuelEventName =
  | "begin"
  | "awaken"
  | "conquer"
  | "hold"
  | "hide"
  | "unit-enter"
  | "standard-move"
  | "activate"
  | "play"
  | "attack"
  | "defend"
  | "become-exhausted"
  | "death"
  | "spell-resolution"
  | "play-gear"
  | "card-play-on-opponent-turn";

export const DUEL_EVENT_NAMES: readonly DuelEventName[] = [
  "begin",
  "awaken",
  "conquer",
  "hold",
  "hide",
  "unit-enter",
  "standard-move",
  "activate",
  "play",
  "attack",
  "defend",
  "become-exhausted",
  "death",
  "spell-resolution",
  "play-gear",
  "card-play-on-opponent-turn",
];

export type DuelEventScopeStatus =
  | "known-no-handler"
  | "handlers-or-modifiers"
  | "unknown";

export interface DuelEventScopeResult {
  readonly status: DuelEventScopeStatus;
  readonly event: string;
  readonly programId: string | null;
  readonly handlers: readonly string[];
  readonly modifiers: readonly string[];
  readonly reason?: "unresolved-program" | "unknown-event" | "unsupported-runtime-scope";
}

/**
 * The phase boundary vocabulary is deliberately separate from the legacy card
 * event vocabulary above.  Core owns these twelve boundaries; keeping a second
 * vocabulary prevents an old `queryDuelEventScope` caller from accidentally
 * turning a newly introduced phase into a proven no-op.
 */
export type DuelPhaseEventName =
  | "awaken"
  | "begin"
  | "hold"
  | "channel"
  | "draw"
  | "main"
  | "ending"
  | "expiration"
  | "fepr"
  | "required-cleanup"
  | "lethal-kill"
  | "burnout";

// Runtime immutable: a consumer may not promote an unrelated card event into a
// reviewed Core phase merely by modifying the exported vocabulary.
export const DUEL_PHASE_EVENT_NAMES: readonly DuelPhaseEventName[] = Object.freeze([
  "awaken",
  "begin",
  "hold",
  "channel",
  "draw",
  "main",
  "ending",
  "expiration",
  "fepr",
  "required-cleanup",
  "lethal-kill",
  "burnout",
]);

/** Why a phase result cannot yet be a whole-program negative proof. */
export type DuelPhaseScopeRequirement =
  | "hidden-zone-event-subjects"
  | "continuous-effect-registry"
  | "cleanup-queue-and-replacements"
  | "pre-exit-event-journal"
  | "kill-trigger-effect-cases";

export type DuelPhaseEventScopeReason =
  | "unresolved-program"
  | "unknown-event"
  | "unsupported-phase-event";

/**
 * A provider-facing phase result. The positive/negative states are emitted only
 * for the small phase subset whose complete meaning is represented by the
 * current official-program IR (`awaken`, `begin`, and `hold`). The other Core
 * boundaries remain explicit `unknown` until their required runtime evidence is
 * available. In particular, this result is a printing-scope proof, not an
 * executor, queue, target, replacement, or source-epoch proof.
 *
 * `reference` is the strict source-bound reference object, never a bare card id.
 * It is present only when `status` is not `unknown`, so a protected provider can
 * bind both the program id and the catalog reference before asking Core to
 * execute anything.
 */
export interface DuelPhaseEventScopeResult {
  readonly status: DuelEventScopeStatus;
  readonly scope: DuelEventScopeStatus;
  readonly event: string;
  readonly programId: string | null;
  readonly reference: DuelOfficialProgramReference | null;
  readonly handlers: readonly string[];
  readonly modifiers: readonly string[];
  /** True only for the phase subset with a defined DSL contract. */
  readonly eventSupported: boolean;
  /** These four fields mirror Core's protected-provider evidence contract. */
  readonly replacementsCovered: boolean;
  readonly staticCovered: boolean;
  readonly continuousCovered: boolean;
  readonly triggersCovered: boolean;
  readonly reason?: DuelPhaseEventScopeReason;
  readonly requiredContracts?: readonly DuelPhaseScopeRequirement[];
  /** Strict source identity used by the protected provider's evidence tuple. */
  readonly sourceCardId: string | null;
  readonly sourceDataVersion: string | null;
  readonly sourceCatalogDigest: string | null;
}

/**
 * The scope of the newer source-program query is deliberately not the scope of
 * a Core phase audit.  It answers only: "what does this one complete printing
 * program say about this boundary, and which runtime closure must Core still
 * provide?"  It never certifies that the whole match has no event, queue item,
 * replacement, or hidden-zone subject.
 */
/**
 * `atomic-boundary` selects direct phase effects; `runtime-subevents` also
 * identifies possible nested events. Neither mode executes a handler or audits
 * runtime facts; a string phase name defaults to `atomic-boundary`.
 */
export type DuelSourceProgramPhaseScopeMode = "atomic-boundary" | "runtime-subevents";

export interface DuelSourceProgramPhaseScopeContext {
  readonly phase: DuelPhaseEventName;
  readonly mode: DuelSourceProgramPhaseScopeMode;
}

/** Runtime facts that are outside one printing's official program. */
export type DuelSourceProgramGlobalRuntimeClosureRequirement =
  | "all-source-candidate-closure"
  | "hidden-zone-event-subjects"
  | "continuous-effect-registry"
  | "cleanup-queue-and-replacements"
  | "pre-exit-event-journal"
  | "kill-trigger-effect-cases"
  | "draw-subject-journal"
  | "runtime-subevent-journal"
  | "recursive-conquer-event-journal";

/** A potential subevent is descriptive only; it is not an executed event. */
export interface DuelSourceProgramPhaseRuntimeSubevent {
  readonly event: DuelEventName;
  readonly handlers: readonly string[];
  readonly modifiers: readonly string[];
}

export type DuelSourceProgramPhaseScopeReason =
  | "unresolved-program"
  | "unknown-event"
  | "invalid-context"
  | "unsupported-runtime-scope";

/**
 * A registry-bound *source-local* applicability result. Deliberately not
 * structurally assignable to Core's `DuelPhaseProgramEvidenceV2`: neither a
 * direct-boundary absence nor `eventRecognized` attests global event closure,
 * source UID/zone/epoch admission, execution, or a whole-program Core audit.
 * `runtimeSubevents` names potential applicability, not observed events.
 * `mode` selects the query, NOT a source's runtime ownership mode.
 */
export interface DuelSourceProgramPhaseScopeResult {
  readonly scope: "source-program" | "unknown";
  readonly directBoundaryStatus: DuelEventScopeStatus;
  /** Potential subevents also affect this status only in runtime-subevents mode. */
  readonly sourceApplicabilityStatus: DuelEventScopeStatus;
  readonly globalClosureStatus: "unverified";
  readonly event: string;
  readonly mode: DuelSourceProgramPhaseScopeMode;
  readonly programId: string | null;
  readonly reference: DuelOfficialProgramReference | null;
  readonly handlers: readonly string[];
  readonly modifiers: readonly string[];
  readonly runtimeSubevents: readonly DuelSourceProgramPhaseRuntimeSubevent[];
  /** Recognized fixed phase vocabulary, not proof of a runtime audit. */
  readonly eventRecognized: boolean;
  readonly sourceProgramComplete: boolean;
  /** Global obligations exist even when this particular printing has no ability. */
  readonly requiredGlobalRuntimeClosure: readonly DuelSourceProgramGlobalRuntimeClosureRequirement[];
  readonly reason?: DuelSourceProgramPhaseScopeReason;
  readonly sourceCardId: string | null;
  readonly sourceDataVersion: string | null;
  readonly sourceCatalogDigest: string | null;
}

export type DuelOfficialProgramResolution = DuelOfficialProgramBinding;

/** Registry facade. It has no public arbitrary-register operation by design. */
export interface DuelOfficialProgramRegistry {
  readonly size: number;
  readonly knownProgramCount: number;
  has(cardId: string): boolean;
  cardIds(): readonly string[];
  get(cardId: string): DuelOfficialProgramResolution | undefined;
  getProgram(cardId: string): DuelOfficialProgram | undefined;
  reference(cardId: string): DuelOfficialProgramReference | undefined;
  resolve(reference: DuelOfficialProgramReference): DuelOfficialProgramResolution;
  eventScope(cardId: string, event: string): DuelEventScopeResult;
  phaseEventScope(cardId: string, event: string): DuelPhaseEventScopeResult;
  sourceProgramPhaseScope(
    cardId: string,
    eventOrContext: string | DuelSourceProgramPhaseScopeContext,
    reference?: DuelOfficialProgramReference,
  ): DuelSourceProgramPhaseScopeResult;
}

/** Source-scope authority is the exact facade identity, never a caller's binding. */
const SOURCE_PROGRAM_REGISTRIES = new WeakMap<DuelOfficialProgramRegistry, ReadonlyMap<string, DuelOfficialProgramBinding>>();

export type DuelValidationIssue = Readonly<{
  readonly path: string;
  readonly code: string;
  readonly message: string;
}>;

export type DuelValidationResult =
  | { readonly ok: true; readonly value: DuelOfficialProgram; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly DuelValidationIssue[] };

export class DuelOfficialProgramValidationError extends Error {
  readonly issues: readonly DuelValidationIssue[];

  constructor(issues: readonly DuelValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "DuelOfficialProgramValidationError";
    this.issues = issues;
  }
}

const SOURCE_FIELDS = [
  "cardId",
  "cardType",
  "normalizedAbilityText",
  "energy",
  "power",
  "might",
  "domains",
  "tags",
  "canonicalCardId",
  "name",
  "fullName",
  "localizedName",
  "setCode",
  "cardNumber",
  "variant",
  "dataVersion",
  "sourceCatalogDigest",
] as const;

const PROGRAM_FIELDS = [
  "kind",
  "schemaVersion",
  "ruleset",
  "programId",
  "cardId",
  "source",
  "semantics",
] as const;

const REFERENCE_FIELDS = [
  "kind",
  "schemaVersion",
  "programId",
  "cardId",
  "dataVersion",
  "sourceCatalogDigest",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`Duel official program: ${label} must be an object.`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Duel official program: ${label} must be a non-empty string.`);
  }
}

function assertSafeIntegerOrNull(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel official program: ${label} must be a nonnegative integer or null.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const item = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !item?.enumerable || !("value" in item)) {
      throw new TypeError(`Duel official program: ${label} requires enumerable own data fields.`);
    }
  }
  const actual = (keys as string[]).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(
      `Duel official program: ${label} has unknown or missing fields; expected exactly ${expected.join(", ")}.`,
    );
  }
}

/** Read own data descriptors once; validation and encoding share this detached value. */
function snapshotData(raw: unknown, label: string, ancestors = new Set<object>()): unknown {
  if (raw === null || raw === undefined || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "object" || ancestors.has(raw) || ancestors.size >= 64) {
    throw new TypeError(`Duel official program: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel official program: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(raw, "length");
      if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0 ||
          keys.length !== length.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel official program: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < length.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel official program: ${label}[${index}] must be an own data property.`);
        }
        output.push(snapshotData(item.value, `${label}[${index}]`, ancestors));
      }
      return output;
    }
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const item = Object.getOwnPropertyDescriptor(raw, key);
      if (typeof key !== "string" || !item || !("value" in item) || !item.enumerable) {
        throw new TypeError(`Duel official program: ${label} requires enumerable own data fields.`);
      }
      Object.defineProperty(output, key, { value: snapshotData(item.value, `${label}.${key}`, ancestors),
        enumerable: true, writable: true, configurable: true });
    }
    return output;
  } finally { ancestors.delete(raw); }
}

function assertExactDenseArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel official program: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 ||
      keys.some((key) => typeof key !== "string" ||
        (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel official program: ${label} must have exactly its dense indices and length.`);
  }
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (property === undefined || !("value" in property)) {
      throw new TypeError(`Duel official program: ${label}[${index}] must be an own data property.`);
    }
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  assertExactDenseArray(value, label);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`Duel official program: ${label} must contain non-empty strings.`);
  }
}

function assertNullableNumberFields(card: DuelSourcePrintingCard, label: string): void {
  assertSafeIntegerOrNull(card.energy, `${label}.energy`);
  assertSafeIntegerOrNull(card.power, `${label}.power`);
  assertSafeIntegerOrNull(card.might, `${label}.might`);
}

function assertSourceCard(value: unknown, label: string): asserts value is DuelSourcePrintingCard {
  assertObject(value, label);
  const required = [
    "id",
    "cardType",
    "ability",
    "energy",
    "power",
    "might",
    "domains",
    "tags",
    "canonicalCardId",
    "name",
    "fullName",
    "localizedName",
    "setCode",
    "cardNumber",
    "variant",
  ] as const;
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel official program: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel official program: ${label}.ability must be a string, null or undefined.`);
  }
  assertSafeIntegerOrNull(value.energy, `${label}.energy`);
  assertSafeIntegerOrNull(value.power, `${label}.power`);
  assertSafeIntegerOrNull(value.might, `${label}.might`);
  assertStringArray(value.domains, `${label}.domains`);
  assertStringArray(value.tags, `${label}.tags`);
  for (const key of [
    "canonicalCardId",
    "name",
    "fullName",
    "localizedName",
    "setCode",
    "cardNumber",
    "variant",
  ] as const) {
    assertNonEmptyString(value[key], `${label}.${key}`);
  }
}

function cloneSourceCard(card: DuelSourcePrintingCard): DuelSourcePrintingCard {
  return {
    id: card.id,
    cardType: card.cardType,
    ability: card.ability,
    energy: card.energy,
    power: card.power,
    might: card.might,
    domains: [...card.domains],
    tags: [...card.tags],
    canonicalCardId: card.canonicalCardId,
    name: card.name,
    fullName: card.fullName,
    localizedName: card.localizedName,
    setCode: card.setCode,
    cardNumber: card.cardNumber,
    variant: card.variant,
  };
}

function assertSourceEnvelope(source: DuelAbilitySource): void {
  assertObject(source, "source");
  assertNonEmptyString(source.dataVersion, "source.dataVersion");
  assertNonEmptyString(source.sourceCatalogDigest, "source.sourceCatalogDigest");
  if (!Array.isArray(source.cards)) throw new TypeError("Duel official program: source.cards must be an array.");
  assertExactDenseArray(source.cards, "source.cards");
  const ids = new Set<string>();
  source.cards.forEach((card, index) => {
    assertSourceCard(card, `source.cards[${index}]`);
    if (ids.has(card.id)) {
      throw new TypeError(`Duel official program: duplicate printing id \"${card.id}\".`);
    }
    ids.add(card.id);
  });
}

/**
 * Build the strict source projection used by this module. Extra catalog fields
 * are intentionally not authority for semantics, but all printing metadata
 * needed for a whole-tuple check is copied and later compared.
 */
export function duelAbilitySourceFromCatalog(catalog: DuelCatalogEnvelope): DuelAbilitySource {
  catalog = snapshotData(catalog, "catalog") as DuelCatalogEnvelope;
  assertObject(catalog, "catalog");
  assertNonEmptyString(catalog.dataVersion, "catalog.dataVersion");
  assertNonEmptyString(catalog.digest, "catalog.digest");
  if (!Array.isArray(catalog.cards)) throw new TypeError("Duel official program: catalog.cards must be an array.");
  assertExactDenseArray(catalog.cards, "catalog.cards");
  const cards = catalog.cards.map((card, index) => {
    assertSourceCard(card, `catalog.cards[${index}]`);
    return cloneSourceCard(card);
  });
  const source: DuelAbilitySource = {
    dataVersion: catalog.dataVersion,
    sourceCatalogDigest: catalog.digest,
    cards,
  };
  assertSourceEnvelope(source);
  return source;
}

/** Alias with an explicit official-Duel name for archive callers. */
export const officialDuelAbilitySourceFromCatalog = duelAbilitySourceFromCatalog;

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Verified deck-catalog.json (sha256:06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766).
// This table is an exact 30-printing allowlist, not a rule that any empty Rune
// (or any [NO TEXT] printing) acquires abilities. Upstream authenticates the
// catalog digest; this projection cannot recompute the full catalog hash.
const BASIC_RUNE_CATALOG_VERSION = "2026-10-12-official-gallery";
const BASIC_RUNE_CATALOG_DIGEST = "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10";
const BASIC_RUNE_IDENTITIES: readonly Readonly<{
  domain: DuelBasicRuneDomain;
  ognNumber: string;
  radNumber: string;
  localizedName: string;
  canonicalCardId: string;
}>[] = [
  { domain: "Fury", ognNumber: "007", radNumber: "01", localizedName: "炽烈符文", canonicalCardId: "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902" },
  { domain: "Calm", ognNumber: "042", radNumber: "02", localizedName: "翠意符文", canonicalCardId: "card.hash-efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed" },
  { domain: "Mind", ognNumber: "089", radNumber: "03", localizedName: "灵光符文", canonicalCardId: "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b" },
  { domain: "Body", ognNumber: "126", radNumber: "04", localizedName: "摧破符文", canonicalCardId: "card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17" },
  { domain: "Chaos", ognNumber: "166", radNumber: "05", localizedName: "混沌符文", canonicalCardId: "card.hash-055d9ad1c38fc05b800d053d3845209673f5397b39fb7bf76787adbc8cf42743" },
  { domain: "Order", ognNumber: "214", radNumber: "06", localizedName: "序理符文", canonicalCardId: "card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67" },
];

const BASIC_RUNE_PRINTINGS: ReadonlyMap<string, DuelSourcePrintingCard> = (() => {
  const rows = new Map<string, DuelSourcePrintingCard>();
  for (const { domain, ognNumber, radNumber, localizedName, canonicalCardId } of BASIC_RUNE_IDENTITIES) {
    const variants = [
      ["ogn", `ogn-${ognNumber}-298`, `OGN-${ognNumber}/298`, "standard", ""],
      ["ogn", `ogn-${ognNumber}a-298`, `OGN-${ognNumber}a/298`, "alternate", ""],
      ["rad", `rad-r${radNumber}`, `RAD-R${radNumber}`, "standard", ""],
      ["rad", `rad-r${radNumber}a`, `RAD-R${radNumber}a`, "alternate", "[NO TEXT]"],
      ["ven", `ven-r${radNumber}`, `VEN-R${radNumber}`, "standard", ""],
    ] as const;
    for (const [setCode, id, cardNumber, variant, ability] of variants) {
      rows.set(id, {
        id, cardType: "Rune", ability, energy: null, power: null, might: null,
        domains: [domain], tags: ["Basic"], canonicalCardId,
        name: `${domain} Rune`, fullName: `${domain} Rune`, localizedName,
        setCode, cardNumber, variant,
      });
    }
  }
  return rows;
})();

/** Exact catalog tuples for the reviewed whole-ability roster additions. */
const VI_DEFLECT_PRINTINGS: ReadonlyMap<string, DuelSourcePrintingCard> = new Map([
  ["ogn-036-298", {
    id: "ogn-036-298", cardType: "Unit",
    ability: `${GANKING_REMINDER_TEXT}\nRecycle 1 from your trash: Give me +1 :rb_might: this turn.`,
    energy: 2, power: 1, might: 3, domains: ["Fury"], tags: ["Vi", "Piltover", "Champion"],
    canonicalCardId: "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51",
    name: "Vi", fullName: "Vi, Destructive", localizedName: "蔚", setCode: "ogn",
    cardNumber: "OGN-036/298", variant: "standard",
  }],
  ["ven-167-166", {
    id: "ven-167-166", cardType: "Unit",
    ability: `[Ganking]\nRecycle 1 from your trash: Give me +1 :rb_might: this turn.`,
    energy: 2, power: 1, might: 3, domains: ["Fury"], tags: ["Vi", "Champion"],
    canonicalCardId: "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51",
    name: "Vi", fullName: "Vi, Destructive", localizedName: "蔚", setCode: "ven",
    cardNumber: "VEN-167/166", variant: "standard",
  }],
  ["ogn-013-298", {
    id: "ogn-013-298", cardType: "Unit",
    ability: "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)",
    energy: 2, power: null, might: 2, domains: ["Fury"], tags: ["Poro"],
    canonicalCardId: "card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452",
    name: "Pouty Poro", fullName: "Pouty Poro", localizedName: "呸呸魄罗", setCode: "ogn",
    cardNumber: "OGN-013/298", variant: "standard",
  }],
  ["sfd-037-221", {
    id: "sfd-037-221", cardType: "Unit",
    ability: "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)",
    energy: 4, power: null, might: 4, domains: ["Calm"], tags: ["Yordle", "Ionia"],
    canonicalCardId: "card.hash-c75d6f4a1bbeb87090ae0f7135aac4f6a4f1062063662b9ccae6fe99f1c9bc7d",
    name: "Navori Scout", fullName: "Navori Scout", localizedName: "纳沃利侦察兵", setCode: "sfd",
    cardNumber: "SFD-037/221", variant: "standard",
  }],
  ["unl-220-219", {
    id: "unl-220-219", cardType: "Unit", ability: "[Deflect]",
    energy: 2, power: null, might: 2, domains: ["Fury"], tags: ["Poro"],
    canonicalCardId: "card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452",
    name: "Pouty Poro", fullName: "Pouty Poro", localizedName: "呸呸魄罗", setCode: "unl",
    cardNumber: "UNL-220/219", variant: "standard",
  }],
  ["unl-t02", {
    id: "unl-t02", cardType: "Unit",
    ability: "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)",
    energy: null, power: null, might: 1, domains: ["Colorless"], tags: ["Bird", "Token"],
    canonicalCardId: "card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d",
    name: "Bird", fullName: "Bird", localizedName: "战鹰", setCode: "unl",
    cardNumber: "UNL-T02", variant: "standard",
  }],
]);

/** Exact whole-printing source allow-list for the point-damage v1 opt-in. */
const POINT_DAMAGE_CATALOG_VERSION = "2026-10-12-official-gallery";
const POINT_DAMAGE_CATALOG_DIGEST = "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10";
const POINT_DAMAGE_PRINTINGS: ReadonlyMap<string, DuelSourcePrintingCard> = new Map([
  ["ogn-009-298", {
    id: "ogn-009-298", cardType: "Spell",
    ability: "[Action] (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield.",
    energy: 1, power: 1, might: null, domains: ["Fury"], tags: [],
    canonicalCardId: "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d",
    name: "Hextech Ray", fullName: "Hextech Ray", localizedName: "海克斯射线", setCode: "ogn",
    cardNumber: "OGN-009/298", variant: "standard",
  }],
  ["ogn-085-298", {
    id: "ogn-085-298", cardType: "Spell",
    ability: "[Action] (Play on your turn or in showdowns.)\nDeal 6 to a unit at a battlefield.",
    energy: 5, power: null, might: null, domains: ["Mind"], tags: [],
    canonicalCardId: "card.hash-6d7a9531293e32e434c7fe99c6af5db443cfa11aa7c070f842cb759910097458",
    name: "Falling Comet", fullName: "Falling Comet", localizedName: "彗星坠击", setCode: "ogn",
    cardNumber: "OGN-085/298", variant: "standard",
  }],
  ["ogs-003-024", {
    id: "ogs-003-024", cardType: "Spell",
    ability: "[Action] (Play on your turn or in showdowns.)\nDeal 2 to a unit at a battlefield.",
    energy: 2, power: null, might: null, domains: ["Fury"], tags: [],
    canonicalCardId: "card.hash-cda4589f51b52780272f5a9b1db1a1de9e9e57e13ffaa05ab668af2de34c1de9",
    name: "Incinerate", fullName: "Incinerate", localizedName: "焚烧", setCode: "ogs",
    cardNumber: "OGS-003/024", variant: "standard",
  }],
  ["ogs-022-024", {
    id: "ogs-022-024", cardType: "Spell",
    ability: "[Action] (Play on your turn or in showdowns.)\nDeal 8 to a unit.",
    energy: 8, power: null, might: null, domains: ["Mind", "Order"], tags: ["Lux", "Signature"],
    canonicalCardId: "card.hash-eef2050754d1ea5e66dbbe4a0abc9faf47327acb4551170226ebde3e02eccd83",
    name: "Final Spark", fullName: "Final Spark, Lux", localizedName: "终极闪光", setCode: "ogs",
    cardNumber: "OGS-022/024", variant: "standard",
  }],
]);

/** Exact whole-printing source allow-list for the pure Shield v1 opt-in. */
const SHIELD_PRINTINGS: ReadonlyMap<string, DuelSourcePrintingCard> = new Map([
  ["ogn-052-298", {
    id: "ogn-052-298", cardType: "Unit",
    ability: "[Shield] (+1 :rb_might: while I'm a defender.)",
    energy: 2, power: null, might: 2, domains: ["Calm"], tags: ["Poro"],
    canonicalCardId: "card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701",
    name: "Stalwart Poro", fullName: "Stalwart Poro", localizedName: "强强魄罗", setCode: "ogn",
    cardNumber: "OGN-052/298", variant: "standard",
  }],
  ["ogs-005-024", {
    id: "ogs-005-024", cardType: "Unit",
    ability: "[Shield] (+1 :rb_might: while I'm a defender.)",
    energy: 6, power: 1, might: 6, domains: ["Calm"], tags: ["Ionia", "Bird"],
    canonicalCardId: "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6",
    name: "Zephyr Sage", fullName: "Zephyr Sage", localizedName: "和风贤者", setCode: "ogs",
    cardNumber: "OGS-005/024", variant: "standard",
  }],
]);

const OFFICIAL_GALLERY_DATA_VERSION = "2026-10-12-official-gallery";
const OFFICIAL_GALLERY_DIGEST = "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10";

/**
 * Exact reviewed source tuples for the 28 pure Equip printings and
 * the three Loose Cannon printings.  The equality input includes every source
 * field plus the catalog envelope.  This allow-list keeps the source
 * registry closed without trusting a short hash as source authority.
 */
const EQUIP_SOURCE_FINGERPRINTS: ReadonlyMap<string, string> = new Map([
  ["rad-150-167", "{\"id\":\"rad-150-167\",\"cardType\":\"Gear\",\"ability\":\"[Equip] — :rb_rune_rainbow: or exhaust a friendly unit. (Pay the cost: Attach this to a unit you control.)\",\"energy\":3,\"power\":1,\"might\":3,\"domains\":[\"Calm\",\"Chaos\"],\"tags\":[\"Equipment\",\"Riven\",\"Signature\"],\"canonicalCardId\":\"card.hash-d127ec787d0c328ab80a9aa29a656cd77a9dda6050627ec1bad17db1942c9853\",\"name\":\"Blade of the Exile\",\"fullName\":\"Blade of the Exile\",\"localizedName\":\"放逐之锋\",\"setCode\":\"rad\",\"cardNumber\":\"RAD-150/167\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-009-221", "{\"id\":\"sfd-009-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":0,\"domains\":[\"Fury\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-2d46595233b37a0868857eab035ad4fa4dc53fc8c932d35ad32cca2c54ff06d2\",\"name\":\"Serrated Dirk\",\"fullName\":\"Serrated Dirk\",\"localizedName\":\"锯齿短匕\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-009/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-016-221", "{\"id\":\"sfd-016-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)\",\"energy\":2,\"power\":null,\"might\":0,\"domains\":[\"Fury\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-553d60be98d221dc71d4e71eb6ae5938143fa0c4b71e6e96d27d8570521d36eb\",\"name\":\"Recurve Bow\",\"fullName\":\"Recurve Bow\",\"localizedName\":\"反曲之弓\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-016/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-030-221", "{\"id\":\"sfd-030-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":2,\"domains\":[\"Fury\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-63dae663a2ca549dc4704d2814cdc3b2eea4a26845d09029e88d2c8df6ee0013\",\"name\":\"Skyfall of Areion\",\"fullName\":\"Skyfall of Areion\",\"localizedName\":\"阿瑞昂的陨落\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-030/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-033-221", "{\"id\":\"sfd-033-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":1,\"domains\":[\"Calm\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-6ef5f0dfecb89d68422cd4fa23ea64d155ef384d03c974ea67ff920203e89a46\",\"name\":\"Doran's Shield\",\"fullName\":\"Doran's Shield\",\"localizedName\":\"多兰之盾\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-033/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-042-221", "{\"id\":\"sfd-042-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)\",\"energy\":2,\"power\":null,\"might\":1,\"domains\":[\"Calm\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-d5460ff7a266a84e1d15b39abe9c2fab99ba81b021a0b01c90e649cc36071665\",\"name\":\"Brutalizer\",\"fullName\":\"Brutalizer\",\"localizedName\":\"残暴之力\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-042/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-051-221", "{\"id\":\"sfd-051-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)\",\"energy\":2,\"power\":null,\"might\":1,\"domains\":[\"Calm\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-af3547abb5e6d69c2372b62331d6039acaf16cca337eefb27e5734bbee3fb307\",\"name\":\"Guardian Angel\",\"fullName\":\"Guardian Angel\",\"localizedName\":\"守护天使\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-051/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-073-221", "{\"id\":\"sfd-073-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":1,\"domains\":[\"Mind\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-f9773189acce6bbb236b5fe609b108079a3b1b13064783ef685543fb56e8e969\",\"name\":\"Experimental Hexplate\",\"fullName\":\"Experimental Hexplate\",\"localizedName\":\"海克斯注力刚壁\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-073/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-086-221", "{\"id\":\"sfd-086-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":2,\"domains\":[\"Mind\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c\",\"name\":\"World Atlas\",\"fullName\":\"World Atlas\",\"localizedName\":\"云游图鉴\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-086/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-095-221", "{\"id\":\"sfd-095-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)\",\"energy\":2,\"power\":null,\"might\":2,\"domains\":[\"Body\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1\",\"name\":\"Doran's Blade\",\"fullName\":\"Doran's Blade\",\"localizedName\":\"多兰之刃\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-095/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-102-221", "{\"id\":\"sfd-102-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)\",\"energy\":2,\"power\":null,\"might\":1,\"domains\":[\"Body\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-655981631747696ba307a61ac6067d55653bb1215a56106697946c14c7da3146\",\"name\":\"Hexdrinker\",\"fullName\":\"Hexdrinker\",\"localizedName\":\"海克斯饮魔刀\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-102/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-108-221", "{\"id\":\"sfd-108-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":1,\"domains\":[\"Body\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322\",\"name\":\"Warmog's Armor\",\"fullName\":\"Warmog's Armor\",\"localizedName\":\"狂徒铠甲\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-108/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-115-221", "{\"id\":\"sfd-115-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)\",\"energy\":4,\"power\":null,\"might\":2,\"domains\":[\"Body\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-e6073f232b1dbf7483b03684f042e36bd6c5692386fa16bce43630d890454681\",\"name\":\"Trinity Force\",\"fullName\":\"Trinity Force\",\"localizedName\":\"三相之力\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-115/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-118-221", "{\"id\":\"sfd-118-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":2,\"domains\":[\"Body\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-fafaf203c1a2733970ae4f8f4051d2c1b16da75c5e2e637905f8fce0d6287a75\",\"name\":\"Boneshiver\",\"fullName\":\"Boneshiver\",\"localizedName\":\"碎骨棒\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-118/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-124-221", "{\"id\":\"sfd-124-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":1,\"domains\":[\"Chaos\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-7cdb3acf3498b65e29a03912deb195f448b78a9da466c922703fc4edda7a0512\",\"name\":\"Doran's Ring\",\"fullName\":\"Doran's Ring\",\"localizedName\":\"多兰之戒\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-124/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-133-221", "{\"id\":\"sfd-133-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":2,\"domains\":[\"Chaos\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-a22e6e418137f242aaa2ac6403b7a752bfc243cecc9d372bc3dfc04dabced9e0\",\"name\":\"Boots of Swiftness\",\"fullName\":\"Boots of Swiftness\",\"localizedName\":\"轻灵之靴\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-133/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-134-221", "{\"id\":\"sfd-134-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":1,\"domains\":[\"Chaos\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-bb1fcaa45b988af1dbf230e70a71fec0ff63d89d772cedb858639514745d573d\",\"name\":\"Cull\",\"fullName\":\"Cull\",\"localizedName\":\"萃取\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-134/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-150-221", "{\"id\":\"sfd-150-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] — :rb_rune_chaos:, Recycle 2 cards from your trash (Pay the cost: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":2,\"domains\":[\"Chaos\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-a94953e6e26ed3d9751a4dd5e4674a587232a894999224e5ce566be1f0895d89\",\"name\":\"Last Rites\",\"fullName\":\"Last Rites\",\"localizedName\":\"临终仪式\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-150/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-153-221", "{\"id\":\"sfd-153-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":0,\"domains\":[\"Order\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-67da502bedfc109e81093202c4a30a43cf37ca8aada9f1460b33bee5c979fdae\",\"name\":\"Eye of the Herald\",\"fullName\":\"Eye of the Herald\",\"localizedName\":\"先锋之眼\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-153/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-161-221", "{\"id\":\"sfd-161-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)\",\"energy\":4,\"power\":null,\"might\":3,\"domains\":[\"Order\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe\",\"name\":\"B.F. Sword\",\"fullName\":\"B.F. Sword\",\"localizedName\":\"暴风大剑\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-161/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-172-221", "{\"id\":\"sfd-172-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)\",\"energy\":2,\"power\":1,\"might\":1,\"domains\":[\"Order\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0\",\"name\":\"Sacred Shears\",\"fullName\":\"Sacred Shears\",\"localizedName\":\"神圣剪刀\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-172/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["sfd-178-221", "{\"id\":\"sfd-178-221\",\"cardType\":\"Gear\",\"ability\":\"[Equip] — :rb_rune_order:, Kill a friendly unit (Pay the cost: Attach this to a unit you control.)\",\"energy\":3,\"power\":1,\"might\":4,\"domains\":[\"Order\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-f9c6d6052ec4552cfcfc53a0e584e07cb232189ed89b277126630202cc188050\",\"name\":\"Blade of the Ruined King\",\"fullName\":\"Blade of the Ruined King\",\"localizedName\":\"破败王者之刃\",\"setCode\":\"sfd\",\"cardNumber\":\"SFD-178/221\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["unl-019-219", "{\"id\":\"unl-019-219\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)\",\"energy\":4,\"power\":null,\"might\":4,\"domains\":[\"Fury\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-21de7fcaef3e38ea7173a7b6b370c00cc4d0e2893c34cafde3a98ee7b65ac558\",\"name\":\"Blighted Battleaxe\",\"fullName\":\"Blighted Battleaxe\",\"localizedName\":\"枯萎战斧\",\"setCode\":\"unl\",\"cardNumber\":\"UNL-019/219\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["unl-039-219", "{\"id\":\"unl-039-219\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)\",\"energy\":1,\"power\":null,\"might\":1,\"domains\":[\"Calm\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-87e2eedcbebff6711e1c1841d161efbe5d63d047836446fb4ececd034911f1be\",\"name\":\"Soul Sword\",\"fullName\":\"Soul Sword\",\"localizedName\":\"灵魂之剑\",\"setCode\":\"unl\",\"cardNumber\":\"UNL-039/219\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["unl-096-219", "{\"id\":\"unl-096-219\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":2,\"domains\":[\"Body\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-d2580c0f7a993eb938c0e656fc955d9a10d34e35758dbfed9502de2a75828f9d\",\"name\":\"Hunter's Machete\",\"fullName\":\"Hunter's Machete\",\"localizedName\":\"猎人的宽刃刀\",\"setCode\":\"unl\",\"cardNumber\":\"UNL-096/219\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["unl-188-219", "{\"id\":\"unl-188-219\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_energy_3::rb_rune_rainbow:. This ability's Energy cost is reduced by the Might of the unit you choose. (Pay the cost: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":3,\"domains\":[\"Fury\",\"Order\"],\"tags\":[\"Vi\",\"Equipment\",\"Signature\"],\"canonicalCardId\":\"card.hash-955bd858659e4d3eb8edfd20347a7496c51932de05cafd32fc71d86d94f96e47\",\"name\":\"Hextech Gauntlets\",\"fullName\":\"Hextech Gauntlets\",\"localizedName\":\"海克斯科技护手\",\"setCode\":\"unl\",\"cardNumber\":\"UNL-188/219\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["ven-011-166", "{\"id\":\"ven-011-166\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)\",\"energy\":3,\"power\":null,\"might\":1,\"domains\":[\"Fury\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-cf2885ca18787660c4888723a93f4322d32c6a6fcb218d79e11353307fbbe53c\",\"name\":\"Pendulum Blade\",\"fullName\":\"Pendulum Blade\",\"localizedName\":\"悬摆之刃\",\"setCode\":\"ven\",\"cardNumber\":\"VEN-011/166\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["ven-027-166", "{\"id\":\"ven-027-166\",\"cardType\":\"Gear\",\"ability\":\"[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)\",\"energy\":2,\"power\":null,\"might\":1,\"domains\":[\"Calm\"],\"tags\":[\"Equipment\"],\"canonicalCardId\":\"card.hash-e38beb4c962c62133ef5050acc2896b4578a668939323e65af883d81c8ada753\",\"name\":\"Hand Hammer\",\"fullName\":\"Hand Hammer\",\"localizedName\":\"杠锤\",\"setCode\":\"ven\",\"cardNumber\":\"VEN-027/166\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
]);

const BEGINNING_DRAW_SOURCE_FINGERPRINTS: ReadonlyMap<string, string> = new Map([
  ["ogn-251-298", "{\"id\":\"ogn-251-298\",\"cardType\":\"Legend\",\"ability\":\"At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.\",\"energy\":null,\"power\":null,\"might\":null,\"domains\":[\"Fury\",\"Chaos\"],\"tags\":[\"Jinx\"],\"canonicalCardId\":\"card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3\",\"name\":\"Loose Cannon\",\"fullName\":\"Loose Cannon\",\"localizedName\":\"暴走萝莉\",\"setCode\":\"ogn\",\"cardNumber\":\"OGN-251/298\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["ogn-301-298", "{\"id\":\"ogn-301-298\",\"cardType\":\"Legend\",\"ability\":\"At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.\",\"energy\":null,\"power\":null,\"might\":null,\"domains\":[\"Fury\",\"Chaos\"],\"tags\":[\"Jinx\"],\"canonicalCardId\":\"card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3\",\"name\":\"Loose Cannon\",\"fullName\":\"Loose Cannon\",\"localizedName\":\"暴走萝莉\",\"setCode\":\"ogn\",\"cardNumber\":\"OGN-301/298\",\"variant\":\"standard\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
  ["ogn-301-star-298", "{\"id\":\"ogn-301-star-298\",\"cardType\":\"Legend\",\"ability\":\"At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.\",\"energy\":null,\"power\":null,\"might\":null,\"domains\":[\"Fury\",\"Chaos\"],\"tags\":[\"Jinx\"],\"canonicalCardId\":\"card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3\",\"name\":\"Loose Cannon\",\"fullName\":\"Loose Cannon\",\"localizedName\":\"暴走萝莉\",\"setCode\":\"ogn\",\"cardNumber\":\"OGN-301*/298\",\"variant\":\"alternate\",\"dataVersion\":\"2026-10-12-official-gallery\",\"sourceCatalogDigest\":\"sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10\"}"],
]);

function sourceTupleFingerprint(source: DuelAbilitySource, card: DuelSourcePrintingCard): string {
  return JSON.stringify({
    id: card.id, cardType: card.cardType, ability: card.ability,
    energy: card.energy, power: card.power, might: card.might,
    domains: [...card.domains], tags: [...card.tags], canonicalCardId: card.canonicalCardId,
    name: card.name, fullName: card.fullName, localizedName: card.localizedName,
    setCode: card.setCode, cardNumber: card.cardNumber, variant: card.variant,
    dataVersion: source.dataVersion, sourceCatalogDigest: source.sourceCatalogDigest,
  });

}

function isExactSourceFingerprint(source: DuelAbilitySource, card: DuelSourcePrintingCard, expected: ReadonlyMap<string, string>): boolean {
  return source.dataVersion === OFFICIAL_GALLERY_DATA_VERSION &&
    source.sourceCatalogDigest === OFFICIAL_GALLERY_DIGEST &&
    sourceTupleFingerprint(source, card) === expected.get(card.id);
}

function exactShieldPrinting(card: DuelSourcePrintingCard): boolean {
  const expected = SHIELD_PRINTINGS.get(card.id);
  if (expected === undefined) return false;
  return card.cardType === expected.cardType && card.ability === expected.ability &&
    card.energy === expected.energy && card.power === expected.power && card.might === expected.might &&
    arraysEqual(card.domains, expected.domains) && arraysEqual(card.tags, expected.tags) &&
    card.canonicalCardId === expected.canonicalCardId && card.name === expected.name &&
    card.fullName === expected.fullName && card.localizedName === expected.localizedName &&
    card.setCode === expected.setCode && card.cardNumber === expected.cardNumber && card.variant === expected.variant;
}

function exactShieldSourceFingerprint(source: DuelProgramSourceFingerprint): boolean {
  const expected = SHIELD_PRINTINGS.get(source.cardId);
  if (expected === undefined) return false;
  return source.cardType === expected.cardType && source.normalizedAbilityText === expected.ability &&
    source.energy === expected.energy && source.power === expected.power && source.might === expected.might &&
    arraysEqual(source.domains, expected.domains) && arraysEqual(source.tags, expected.tags) &&
    source.canonicalCardId === expected.canonicalCardId && source.name === expected.name &&
    source.fullName === expected.fullName && source.localizedName === expected.localizedName &&
    source.setCode === expected.setCode && source.cardNumber === expected.cardNumber && source.variant === expected.variant;
}

function exactPointDamagePrinting(card: DuelSourcePrintingCard): boolean {
  const expected = POINT_DAMAGE_PRINTINGS.get(card.id);
  if (expected === undefined) return false;
  return card.cardType === expected.cardType && card.ability === expected.ability &&
    card.energy === expected.energy && card.power === expected.power && card.might === expected.might &&
    arraysEqual(card.domains, expected.domains) && arraysEqual(card.tags, expected.tags) &&
    card.canonicalCardId === expected.canonicalCardId && card.name === expected.name &&
    card.fullName === expected.fullName && card.localizedName === expected.localizedName &&
    card.setCode === expected.setCode && card.cardNumber === expected.cardNumber && card.variant === expected.variant;
}

function exactPointDamageSource(source: DuelProgramSourceFingerprint): boolean {
  const expected = POINT_DAMAGE_PRINTINGS.get(source.cardId);
  if (expected === undefined) return false;
  return source.cardType === expected.cardType && source.normalizedAbilityText === expected.ability &&
    source.energy === expected.energy && source.power === expected.power && source.might === expected.might &&
    arraysEqual(source.domains, expected.domains) && arraysEqual(source.tags, expected.tags) &&
    source.canonicalCardId === expected.canonicalCardId && source.name === expected.name &&
    source.fullName === expected.fullName && source.localizedName === expected.localizedName &&
    source.setCode === expected.setCode && source.cardNumber === expected.cardNumber && source.variant === expected.variant;
}

const PURE_DEFLECT_REMINDER_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)";

function exactWholeRosterPrinting(card: DuelSourcePrintingCard): boolean {
  const expected = VI_DEFLECT_PRINTINGS.get(card.id);
  if (expected === undefined) return false;
  if (card.ability !== expected.ability || card.cardType !== expected.cardType ||
      card.energy !== expected.energy || card.power !== expected.power || card.might !== expected.might ||
      !arraysEqual(card.domains, expected.domains) || !arraysEqual(card.tags, expected.tags)) return false;
  return card.canonicalCardId === expected.canonicalCardId && card.name === expected.name &&
    card.fullName === expected.fullName && card.localizedName === expected.localizedName &&
    card.setCode === expected.setCode && card.cardNumber === expected.cardNumber && card.variant === expected.variant;
}

function exactWholeRosterSourceFingerprint(source: DuelProgramSourceFingerprint): boolean {
  const expected = VI_DEFLECT_PRINTINGS.get(source.cardId);
  if (expected === undefined) return false;
  return source.cardType === expected.cardType && source.normalizedAbilityText === expected.ability &&
    source.energy === expected.energy && source.power === expected.power && source.might === expected.might &&
    arraysEqual(source.domains, expected.domains) && arraysEqual(source.tags, expected.tags) &&
    source.canonicalCardId === expected.canonicalCardId && source.name === expected.name &&
    source.fullName === expected.fullName && source.localizedName === expected.localizedName &&
    source.setCode === expected.setCode && source.cardNumber === expected.cardNumber && source.variant === expected.variant;
}

function isVerifiedBasicRune(source: DuelAbilitySource, card: DuelSourcePrintingCard): card is DuelSourcePrintingCard & { readonly domains: readonly [DuelBasicRuneDomain] } {
  const expected = BASIC_RUNE_PRINTINGS.get(card.id);
  if (expected === undefined || source.dataVersion !== BASIC_RUNE_CATALOG_VERSION || source.sourceCatalogDigest !== BASIC_RUNE_CATALOG_DIGEST) return false;
  return card.cardType === expected.cardType && card.ability === expected.ability &&
    card.energy === null && card.power === null && card.might === null &&
    arraysEqual(card.domains, expected.domains) && arraysEqual(card.tags, expected.tags) &&
    card.canonicalCardId === expected.canonicalCardId && card.name === expected.name &&
    card.fullName === expected.fullName && card.localizedName === expected.localizedName &&
    card.setCode === expected.setCode && card.cardNumber === expected.cardNumber && card.variant === expected.variant;
}

function basicRuneSemantics(domain: DuelBasicRuneDomain): DuelBasicRuneSemantics {
  return {
    kind: "basic-rune", sourceRule: "CR-v1.4:164.2", domain,
    abilities: [
      {
        kind: "basic-rune-energy", sourceRule: "CR-v1.4:164.2.a", event: "activate",
        sourceScope: "source-basic-rune", permission: "reaction",
        costs: [{ kind: "exhaust-source" }],
        effects: [{ kind: "add-energy", amount: 1, recipient: "ability-controller", destination: "rune-pool", expiration: "rune-pool-reset" }],
      },
      {
        kind: "basic-rune-power", sourceRule: "CR-v1.4:164.2.b/164.2.b.1", event: "activate",
        sourceScope: "source-basic-rune", permission: "reaction",
        costs: [{ kind: "recycle-source", destination: "source-owner-rune-deck", readiness: "ready-or-exhausted" }],
        effects: [{ kind: "add-domain-power", amount: 1, domain, domainSource: "source-rune-domain", recipient: "ability-controller", destination: "rune-pool", expiration: "rune-pool-reset" }],
      },
    ],
  };
}

function assertBasicRuneProgramSource(source: Record<string, unknown>): void {
  const card = typeof source.cardId === "string" ? BASIC_RUNE_PRINTINGS.get(source.cardId) : undefined;
  if (card === undefined || source.dataVersion !== BASIC_RUNE_CATALOG_VERSION || source.sourceCatalogDigest !== BASIC_RUNE_CATALOG_DIGEST ||
      source.cardType !== card.cardType || source.normalizedAbilityText !== card.ability ||
      source.energy !== null || source.power !== null || source.might !== null ||
      !Array.isArray(source.domains) || !arraysEqual(source.domains, card.domains) ||
      !Array.isArray(source.tags) || !arraysEqual(source.tags, card.tags) ||
      source.canonicalCardId !== card.canonicalCardId || source.name !== card.name ||
      source.fullName !== card.fullName || source.localizedName !== card.localizedName ||
      source.setCode !== card.setCode || source.cardNumber !== card.cardNumber || source.variant !== card.variant) {
    throw new TypeError("Duel official program: Basic Rune source must match the exact verified printing and catalog envelope.");
  }
}

function assertOptionalSourceMetadata(candidate: Record<string, unknown>, source: DuelAbilitySource): void {
  for (const key of ["dataVersion", "sourceDataVersion"] as const) {
    if (Object.prototype.hasOwnProperty.call(candidate, key) && candidate[key] !== source.dataVersion) {
      throw new TypeError(`Duel official program: candidate ${key} does not match the source dataVersion.`);
    }
  }
  for (const key of ["digest", "sourceCatalogDigest"] as const) {
    if (Object.prototype.hasOwnProperty.call(candidate, key) && candidate[key] !== source.sourceCatalogDigest) {
      throw new TypeError(`Duel official program: candidate ${key} does not match the source digest.`);
    }
  }
}

/**
 * Verify every field in the complete printing tuple. Normalized ability text
 * is the one intentional textual equivalence; no name/prefix guessing occurs.
 */
function assertCandidateMatchesSource(
  source: DuelAbilitySource,
  candidate: DuelSourcePrintingCard,
  trusted: DuelSourcePrintingCard,
): void {
  assertSourceCard(candidate, "card");
  assertObject(candidate, "card");
  assertOptionalSourceMetadata(candidate as unknown as Record<string, unknown>, source);
  if (candidate.id !== trusted.id) throw new TypeError(`Duel official program: card id does not match trusted source.`);
  if (candidate.cardType !== trusted.cardType) {
    throw new TypeError(`Duel official program: card \"${candidate.id}\" cardType does not match trusted source.`);
  }
  if (normalizeAbilityText(candidate.ability) !== normalizeAbilityText(trusted.ability) ||
      (BASIC_RUNE_PRINTINGS.has(candidate.id) && candidate.ability !== trusted.ability)) {
    throw new TypeError(`Duel official program: card \"${candidate.id}\" ability text does not match trusted source.`);
  }
  for (const key of ["energy", "power", "might"] as const) {
    if (candidate[key] !== trusted[key]) {
      throw new TypeError(`Duel official program: card \"${candidate.id}\" ${key} does not match trusted source.`);
    }
  }
  for (const key of ["domains", "tags"] as const) {
    if (!arraysEqual(candidate[key], trusted[key])) {
      throw new TypeError(`Duel official program: card \"${candidate.id}\" ${key} does not match trusted source.`);
    }
  }
  for (const key of [
    "canonicalCardId",
    "name",
    "fullName",
    "localizedName",
    "setCode",
    "cardNumber",
    "variant",
  ] as const) {
    if (candidate[key] !== trusted[key]) {
      throw new TypeError(`Duel official program: card \"${candidate.id}\" ${key} does not match trusted source.`);
    }
  }
}

function sourceFingerprint(source: DuelAbilitySource, card: DuelSourcePrintingCard): DuelProgramSourceFingerprint {
  return {
    cardId: card.id,
    cardType: card.cardType,
    normalizedAbilityText: normalizeAbilityText(card.ability),
    energy: card.energy,
    power: card.power,
    might: card.might,
    domains: [...card.domains],
    tags: [...card.tags],
    canonicalCardId: card.canonicalCardId,
    name: card.name,
    fullName: card.fullName,
    localizedName: card.localizedName,
    setCode: card.setCode,
    cardNumber: card.cardNumber,
    variant: card.variant,
    dataVersion: source.dataVersion,
    sourceCatalogDigest: source.sourceCatalogDigest,
  };
}

export function makeDuelOfficialProgramId(cardId: string): string {
  assertNonEmptyString(cardId, "cardId");
  return `${DUEL_OFFICIAL_RULESET}:${cardId}`;
}

function pureAssaultAmountFromText(text: string): number | null {
  const match = /^\[Assault(?: (\d+))?\](?: \(\+(\d+) :rb_might: while I'm an attacker\.\))?$/u.exec(text);
  if (match === null) return null;
  const amount = match[1] === undefined ? 1 : Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 0 ||
      (match[2] !== undefined && Number(match[2]) !== amount)) return null;
  return amount;
}

function viDestructiveCompoundSemantics(): DuelViDestructiveCompoundSemantics {
  return {
    kind: "compound-vi-self",
    sourceScope: "source-unit-on-board",
    ganking: { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" },
    activation: {
      event: "activate",
      sourceScope: "source-unit-on-board",
      costs: [{ kind: "recycle-from-trash", amount: 1, selector: "one-card", zone: "controller-trash", payer: "ability-controller" }],
      effects: [{ kind: "add-might", amount: 1, recipient: "ability-source-unit", duration: "this-turn" }],
    },
  };
}

function deflectSemantics(): DuelDeflectSemantics {
  return {
    kind: "deflect",
    sourceScope: "source-unit-on-board",
    event: "opponent-choice",
    modifier: {
      kind: "additional-opponent-power-cost",
      amount: 1,
      powerDomain: "wildcard",
      payer: "opponent",
      timing: "additional-play-cost",
      per: "each-choice-of-source",
      optional: false,
      automaticPayment: false,
      choice: { source: "spell-or-ability", target: "source-unit-on-board" },
    },
  };
}

function equipSemantics(description: Extract<ReturnType<typeof describeDuelEquipV1>, { status: "known" }>): DuelEquipActivatedAbilitySemantics | null {
  const cost = description.semantics.cost;
  if (cost.nonResourceLiteral !== null) return null;
  if (description.semantics.costAlterations.length !== 0) return null;
  if (description.semantics.attachTarget !== "unknown" || description.semantics.timing !== "unknown") return null;
  return {
    kind: "equip-activated-ability",
    event: "activate",
    sourceScope: "source-gear-on-board",
    abilityClass: "activated-ability",
    cost: {
      kind: "base-cost",
      literal: cost.literal,
      energy: cost.energy,
      power: cost.power,
      nonResourceLiteral: null,
    },
    costAlternatives: [],
    costAlterations: [],
    target: {
      kind: "unit",
      controller: "source-controller",
      scope: "controlled-unit",
      selection: "target",
    },
    attach: { kind: "attach-source-gear", destination: "target-unit", resolution: "deferred-attachment" },
    timing: "main-open-outside-showdown",
    runtime: {
      status: "pending",
      required: ["canonical-source-controller", "equip-activation-executor"],
    },
  };
}

function beginningDrawSemantics(card: DuelSourcePrintingCard, source: DuelAbilitySource): DuelBeginningDrawSemantics | null {
  const description = describeDuelBeginningDrawV1(card, {
    dataVersion: source.dataVersion,
    sourceCatalogDigest: source.sourceCatalogDigest,
  });
  if (description.status !== "known") return null;
  return {
    kind: "beginning-phase-conditional-draw",
    trigger: {
      event: "beginning-phase",
      phase: "begin",
      step: "beginning-step",
      scope: "controller-beginning-phase",
      timing: "start",
      enqueue: "unconditional-pending-item",
    },
    effect: {
      kind: "draw-cards",
      amount: 1,
      recipient: "ability-controller",
      condition: {
        kind: "hand-size-at-most",
        maximum: 1,
        scope: "ability-controller-hand",
        clauseRole: "effect",
        evaluatedAt: "resolution",
        readsPublicInformationOnly: true,
      },
    },
    controller: { kind: "ability-controller", source: "canonical-source-controller", status: "pending" },
    runtime: {
      status: "pending",
      required: ["canonical-source-controller", "beginning-phase-trigger-executor", "draw-burnout-continuation"],
    },
  };
}

const recruitToken = (): DuelRecruitTokenSpec => ({
  kind: "unit-token",
  cardType: "Unit",
  domains: [],
  domainless: true,
  tags: ["Recruit"],
  energy: null,
  power: null,
  might: 1,
  physicalPrintingCardId: null,
});

const playRecruit = (destination: "base" | "executor-defined"): DuelPlayRecruitTokenEffect => ({
  kind: "play-recruit-token",
  token: recruitToken(),
  controller: "effect-controller",
  owner: "effect-controller",
  destination,
  resolution: "deferred-token-play",
});

/** A rules-bound reference, never a card id or a registry enrollment API. */
export function createDuelGoldIntrinsicAbilityReference(): DuelGoldIntrinsicAbilityReference {
  return freezeDeep({
    kind: DUEL_GOLD_INTRINSIC_REFERENCE_KIND,
    schemaVersion: DUEL_GOLD_INTRINSIC_SCHEMA_VERSION,
    ruleset: DUEL_OFFICIAL_RULESET,
    intrinsicId: DUEL_GOLD_INTRINSIC_ID,
  });
}

/** CR 187.5: permission + both costs + Add [A], with no paid Energy or Energy gain. */
export function getDuelGoldIntrinsicTokenAbilitySpec(): DuelGoldIntrinsicTokenAbilitySpec {
  return freezeDeep({
    kind: DUEL_GOLD_INTRINSIC_ABILITY_KIND,
    schemaVersion: DUEL_GOLD_INTRINSIC_SCHEMA_VERSION,
    ruleset: DUEL_OFFICIAL_RULESET,
    intrinsicId: DUEL_GOLD_INTRINSIC_ID,
    sourceRule: "CR-v1.4:187.5",
    token: "Gold gear token",
    event: "activate",
    permission: "reaction",
    sourceScope: "source-gold-gear-token",
    costs: [{ kind: "kill-source" }, { kind: "exhaust-source" }],
    effects: [{
      kind: "add-universal-power",
      amount: 1,
      recipient: "ability-controller",
      destination: "rune-pool",
      expiration: "rune-pool-reset",
    }],
  });
}

const goldGearToken = (): DuelGoldGearTokenSpec => ({
  kind: "gear-token",
  tokenName: "Gold",
  cardType: "Gear",
  domains: [],
  domainless: true,
  energy: null,
  power: null,
  might: null,
  physicalPrintingCardId: null,
  defaultEntryReady: true,
  intrinsicAbility: createDuelGoldIntrinsicAbilityReference(),
});

const playExhaustedGold = (): DuelPlayGoldGearTokenEffect => ({
  kind: "play-gold-gear-token",
  token: goldGearToken(),
  controller: "effect-controller",
  owner: "effect-controller",
  destination: "effect-controller-base",
  entryExhausted: true,
  resolution: "deferred-token-play",
});

function createSemantics(
  source: DuelAbilitySource,
  card: DuelSourcePrintingCard,
  enablePureAssault = false,
  enablePureAccelerate = false,
  enableFuryOptionalRoster = false,
  enablePointDamage = false,
  enablePureShield = false,
  enableEquip = false,
  enableBeginningDraw = false,
): DuelProgramSemantics | null {
  const text = normalizeAbilityText(card.ability);
  // A known Rune ID with altered source metadata must not fall through to an
  // unrelated printed-card template, even if its forged text matches one.
  if (BASIC_RUNE_PRINTINGS.has(card.id)) {
    return isVerifiedBasicRune(source, card) ? basicRuneSemantics(card.domains[0]) : null;
  }

  if (enableEquip && card.cardType === "Gear" && EQUIP_SOURCE_FINGERPRINTS.has(card.id) &&
      isExactSourceFingerprint(source, card, EQUIP_SOURCE_FINGERPRINTS)) {
    const equip = describeDuelEquipV1(card, {
      dataVersion: source.dataVersion,
      catalogDigest: source.sourceCatalogDigest,
    });
    if (equip.status === "known") return equipSemantics(equip);
  }

  if (enableBeginningDraw && card.cardType === "Legend" && BEGINNING_DRAW_SOURCE_FINGERPRINTS.has(card.id) &&
      isExactSourceFingerprint(source, card, BEGINNING_DRAW_SOURCE_FINGERPRINTS)) {
    return beginningDrawSemantics(card, source);
  }

  if (card.cardType === "Unit") {
    if (enableFuryOptionalRoster && exactWholeRosterPrinting(card)) {
      const text = normalizeAbilityText(card.ability);
      if (card.id === "ogn-036-298" || card.id === "ven-167-166") {
        return viDestructiveCompoundSemantics();
      }
      if (text === "[Deflect]" || text === PURE_DEFLECT_REMINDER_TEXT) {
        return deflectSemantics();
      }
    }
    if (enablePureAccelerate) {
      const accelerate = describeDuelOptionalPlayCostV1(card);
      if (accelerate.status === "known") return accelerate.semantics;
    }
    if (enablePureAssault) {
      const assault = describeDuelAssaultV1(card);
      if (assault.status === "known") {
        return {
          kind: "passive",
          event: "attacker",
          sourceScope: "source-unit-on-board",
          modifier: { kind: "self-assault", amount: assault.semantics.amount },
        };
      }
    }
    if (enablePureShield && source.dataVersion === DUEL_SHIELD_CATALOG_DATA_VERSION &&
        source.sourceCatalogDigest === DUEL_SHIELD_CATALOG_DIGEST && exactShieldPrinting(card)) {
      const shield = describeDuelShieldV1(card);
      if (shield.status === "known") {
        return {
          kind: "passive",
          event: "defender",
          sourceScope: "source-unit-on-board",
          modifier: { kind: "self-shield", amount: shield.semantics.amount },
        };
      }
    }
    if (text === ENTER_READY_TEXT) {
      return {
        kind: "static",
        abilities: [{ kind: "enter-ready", subject: "self", scope: "unit-enter", mode: "replacement" }],
      };
    }
    if (text === GANKING_REMINDER_TEXT) {
      return {
        kind: "static",
        abilities: [{ kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" }],
      };
    }
    if (text === `${GANKING_REMINDER_TEXT}\n${ENTER_READY_TEXT}`) {
      return {
        kind: "static",
        abilities: [
          { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" },
          { kind: "enter-ready", subject: "self", scope: "unit-enter", mode: "replacement" },
        ],
      };
    }
    if (text === "") {
      if (card.energy !== null && card.energy >= 0) {
        return {
          kind: "no-ability",
          playability: { kind: "printed-unit", fromHand: true, energyCost: card.energy, tokenOnly: false },
        };
      }
      if (
        card.energy === null &&
        card.power === null &&
        card.might === 1 &&
        arraysEqual(card.domains, ["Colorless"]) &&
        card.tags.includes("Recruit") &&
        card.tags.includes("Token")
      ) {
        return {
          kind: "no-ability",
          playability: { kind: "recruit-token", fromHand: false, energyCost: null, tokenOnly: true },
        };
      }
      return null;
    }
  }

  // Exact *whole* official template; the full printing tuple is checked at bind.
  // Do not include "When you conquer" or any reminder/extra clause in this branch.
  if (card.cardType === "Unit" && text === "When I conquer, play a Gold gear token exhausted.") {
    return {
      kind: "trigger",
      event: "conquer",
      sourceScope: "conquering-source-unit",
      eventPredicate: {
        kind: "source-unit-present-at-conquered-battlefield",
        participant: "ability-source-unit",
        battlefield: "conquered-battlefield",
        pointOutcome: "including-negated-or-replaced",
      },
      condition: null,
      optional: false,
      costs: [],
      effects: [playExhaustedGold()],
    };
  }

  if (
    card.cardType === "Legend" &&
    text === "When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit."
  ) {
    return {
      kind: "trigger",
      event: "conquer",
      sourceScope: "ability-source",
      condition: { kind: "assigned-excess-damage-at-least", amount: 3 },
      optional: true,
      costs: [{ kind: "exhaust-source" }],
      effects: [
        {
          kind: "ready-unit",
          target: { kind: "unit", controller: "any", scope: "legal-unit" },
        },
      ],
    };
  }

  if (
    card.cardType === "Battlefield" &&
    text === "When you hold here, play a 1 :rb_might: Recruit unit token in your base."
  ) {
    return {
      kind: "trigger",
      event: "hold",
      sourceScope: "battlefield-controller",
      condition: null,
      optional: false,
      costs: [],
      effects: [playRecruit("base")],
    };
  }

  if (card.cardType === "Battlefield" && text === "You may hide an additional card here.") {
    return {
      kind: "passive",
      event: "hide",
      sourceScope: "source-battlefield",
      modifier: {
        kind: "additional-hide-permission",
        amount: 1,
        optional: true,
        scope: "source-battlefield",
      },
    };
  }

  if (card.cardType === "Battlefield" && text === "When you hold here, draw 1.") {
    return {
      kind: "trigger", event: "hold", sourceScope: "battlefield-controller",
      condition: null, optional: false, costs: [],
      effects: [{ kind: "draw-cards", amount: 1, recipient: "effect-controller" }],
    };
  }

  if (card.cardType === "Spell" && text === "Draw 4.") {
    return { kind: "spell-resolution",
      effects: [{ kind: "draw-cards", amount: 4, recipient: "effect-controller" }] };
  }

  if (card.cardType === "Spell" && text === DUEL_PREMONITION_REACTION_TEXT) {
    return { kind: "spell-resolution", permission: "reaction",
      effects: [{ kind: "draw-cards", amount: 3, recipient: "effect-controller" }] };
  }

  if (card.cardType === "Spell") {
    if (enablePointDamage && source.dataVersion === POINT_DAMAGE_CATALOG_VERSION &&
        source.sourceCatalogDigest === POINT_DAMAGE_CATALOG_DIGEST && exactPointDamagePrinting(card)) {
      const point = describeDuelPointDamageV1(card);
      if (point.status === "known") {
        return { kind: "point-damage-spell-resolution", effects: [{
          kind: "point-damage", amount: point.semantics.amount, target: point.semantics.target,
        }] };
      }
    }
    if (text === "Kill a unit.") return { kind: "spell-resolution",
      effects: [{ kind: "kill-unit", controller: "any", selection: "target" }] };
    if (text === "Kill all units.") return { kind: "spell-resolution",
      effects: [{ kind: "kill-units", controller: "any", selection: "all" }] };
    if (text === "Each player kills one of their units.") return { kind: "spell-resolution",
      effects: [{ kind: "each-player-kills-unit", selection: "each-player-choice" }] };
    if (text === "Deal 6 to each of up to two units.") return { kind: "spell-resolution",
      effects: [{ kind: "deal-damage", amount: 6, distribution: "each",
        targets: { kind: "unit", controller: "any", minSelections: 0, maxSelections: 2 } }] };
  }

  if (card.cardType === "Unit") {
    const triggered = (event: DuelUnitEventTriggerSemantics["event"],
      sourceScope: DuelUnitEventTriggerSemantics["sourceScope"],
      effect: DuelUnitEventTriggerSemantics["effects"][0]): DuelUnitEventTriggerSemantics =>
      ({ kind: "trigger", event, sourceScope,
        eventPredicate: event === "unit-enter"
          ? { kind: "source-play-completed", source: "ability-source", countered: false }
          : { kind: "controller-play-completed", actor: "source-controller-at-event",
              cardType: event === "play-gear" ? "Gear" : "any",
              turn: event === "play-gear" ? "any" : "opponent", countered: false },
        condition: null, optional: false, costs: [], effects: [effect] });
    if (text === "When you play me, draw 1.") return triggered("unit-enter", "played-source-unit",
      { kind: "draw-cards", amount: 1, recipient: "effect-controller" });
    if (text === "When you play me, kill an enemy unit.") return triggered("unit-enter", "played-source-unit",
      { kind: "kill-unit", controller: "enemy", selection: "target" });
    if (text === "When you play a gear, ready me.") return triggered("play-gear", "controller-plays-gear",
      { kind: "ready-source" });
    if (text === "When you play a card on an opponent's turn, play a 1 :rb_might: Recruit unit token in your base.") {
      return triggered("card-play-on-opponent-turn", "controller-plays-card-on-opponent-turn", playRecruit("base"));
    }
    if (text === "Your token units have +1 :rb_might:.") return {
      kind: "continuous", sourceScope: "source-unit-on-board",
      modifier: { kind: "token-unit-might", amount: 1, controller: "ability-controller", scope: "board" },
    };
  }

  if (card.cardType === "Legend" && text === ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.") {
    return {
      kind: "activated",
      event: "activate",
      sourceScope: "ability-source",
      costs: [
        { kind: "energy", amount: 1, payer: "ability-controller" },
        { kind: "exhaust-source" },
      ],
      effects: [playRecruit("executor-defined")],
    };
  }

  return null;
}

function cloneSemantics(semantics: DuelProgramSemantics): DuelProgramSemantics {
  return JSON.parse(JSON.stringify(semantics)) as DuelProgramSemantics;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function cloneProgram(program: DuelOfficialProgram): DuelOfficialProgram {
  return freezeDeep({
    kind: program.kind,
    schemaVersion: program.schemaVersion,
    ruleset: program.ruleset,
    programId: program.programId,
    cardId: program.cardId,
    source: {
      ...program.source,
      domains: [...program.source.domains],
      tags: [...program.source.tags],
    },
    semantics: cloneSemantics(program.semantics),
  });
}

function createProgram(source: DuelAbilitySource, card: DuelSourcePrintingCard, semantics: DuelProgramSemantics): DuelOfficialProgram {
  const program: DuelOfficialProgram = {
    kind: DUEL_OFFICIAL_IR_KIND,
    schemaVersion: DUEL_OFFICIAL_IR_SCHEMA_VERSION,
    ruleset: DUEL_OFFICIAL_RULESET,
    programId: makeDuelOfficialProgramId(card.id),
    cardId: card.id,
    source: sourceFingerprint(source, card),
    semantics,
  };
  return cloneProgram(program);
}

function findTrustedCard(source: DuelAbilitySource, cardId: string): DuelSourcePrintingCard | undefined {
  let found: DuelSourcePrintingCard | undefined;
  let count = 0;
  for (const candidate of source.cards) {
    if (candidate.id === cardId) {
      found = candidate;
      count += 1;
    }
  }
  if (count > 1) throw new TypeError(`Duel official program: duplicate printing id \"${cardId}\".`);
  return found;
}

function makeBinding(
  source: DuelAbilitySource,
  card: DuelSourcePrintingCard,
  semantics: DuelProgramSemantics | null,
  enableEquip = false,
): DuelOfficialProgramBinding {
  if (semantics === null) {
    let unresolvedReason: DuelUnresolvedReason =
      card.cardType === "Unit" && normalizeAbilityText(card.ability) === ""
        ? "empty-unit-is-not-a-verified-playability-template"
        : "unsupported-whole-ability";
    if (enableEquip && card.cardType === "Gear" && EQUIP_SOURCE_FINGERPRINTS.has(card.id) &&
        isExactSourceFingerprint(source, card, EQUIP_SOURCE_FINGERPRINTS)) {
      const description = describeDuelEquipV1(card, {
        dataVersion: source.dataVersion,
        catalogDigest: source.sourceCatalogDigest,
      });
      if (description.status === "known") {
        unresolvedReason = description.semantics.cost.nonResourceLiteral !== null
          ? "equip-non-resource-cost"
          : description.semantics.costAlterations.length > 0
            ? "equip-cost-alteration"
            : "equip-timing-or-target-alteration";
      }
    }
    return freezeDeep({
      status: "unknown",
      cardId: card.id,
      sourceDataVersion: source.dataVersion,
      sourceCatalogDigest: source.sourceCatalogDigest,
      normalizedAbilityText: normalizeAbilityText(card.ability),
      program: null,
      unresolvedReason,
    });
  }
  return freezeDeep({
    status: "resolved",
    cardId: card.id,
    sourceDataVersion: source.dataVersion,
    sourceCatalogDigest: source.sourceCatalogDigest,
    normalizedAbilityText: normalizeAbilityText(card.ability),
    program: createProgram(source, card, semantics),
  });
}

/**
 * Bind one card through the unique trusted source tuple. Unsupported text is
 * returned as `unknown`; a forged id/type/text/stats/metadata tuple throws.
 */
export function bindDuelOfficialProgram(
  source: DuelAbilitySource,
  card: DuelSourcePrintingCard,
): DuelOfficialProgramBinding {
  source = snapshotData(source, "source") as DuelAbilitySource;
  card = snapshotData(card, "card") as DuelSourcePrintingCard;
  assertSourceEnvelope(source);
  assertSourceCard(card, "card");
  const trusted = findTrustedCard(source, card.id);
  if (trusted === undefined) {
    throw new TypeError(`Duel official program: card \"${card.id}\" is not present in the trusted source.`);
  }
  assertCandidateMatchesSource(source, card, trusted);
  return makeBinding(source, trusted, createSemantics(source, trusted, false));
}

/** Short alias used by Duel provider code. */
export const bindDuelProgram = bindDuelOfficialProgram;

export function bindDuelOfficialProgramByCardId(
  source: DuelAbilitySource,
  cardId: string,
): DuelOfficialProgramBinding | undefined {
  source = snapshotData(source, "source") as DuelAbilitySource;
  assertSourceEnvelope(source);
  if (typeof cardId !== "string" || cardId.length === 0) return undefined;
  const trusted = findTrustedCard(source, cardId);
  return trusted === undefined ? undefined : makeBinding(source, trusted, createSemantics(source, trusted, false));
}

function cloneBinding(binding: DuelOfficialProgramBinding): DuelOfficialProgramBinding {
  return freezeDeep({
    status: binding.status,
    cardId: binding.cardId,
    sourceDataVersion: binding.sourceDataVersion,
    sourceCatalogDigest: binding.sourceCatalogDigest,
    normalizedAbilityText: binding.normalizedAbilityText,
    program: binding.program === null ? null : cloneProgram(binding.program),
    ...(binding.unresolvedReason === undefined ? {} : { unresolvedReason: binding.unresolvedReason }),
  });
}

function bindingForReference(
  registry: DuelOfficialProgramRegistry,
  reference: DuelOfficialProgramReference,
): DuelOfficialProgramBinding {
  assertDuelOfficialProgramReference(reference);
  const binding = registry.get(reference.cardId);
  if (binding === undefined || binding.status !== "resolved" || binding.program === null) {
    throw new TypeError(`Duel official program: reference card \"${reference.cardId}\" is unresolved.`);
  }
  if (
    binding.program.programId !== reference.programId ||
    binding.sourceDataVersion !== reference.dataVersion ||
    binding.sourceCatalogDigest !== reference.sourceCatalogDigest
  ) {
    throw new TypeError("Duel official program: reference metadata or programId does not match the registry.");
  }
  return binding;
}

/**
 * Create an immutable facade containing every source printing. Unknown
 * printings remain visible as `status: \"unknown\"`; they are not silently
 * treated as no-effect. There is intentionally no registerProgram method.
 */
export function createDuelOfficialProgramRegistry(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, false, false);
}

/** Explicitly opt in to the complete, pure whole-ability Assault templates. */
export function createDuelAssaultOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, false);
}

/** Explicitly opt in to the complete, pure Unit Accelerate templates. */
export function createDuelAccelerateOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, false, true);
}

/** Explicitly opt in to both reviewed pure Unit template families. */
export function createDuelExtendedUnitOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, true);
}

/**
 * Explicit opt-in for the reviewed Fury/Order roster whole-ability additions.
 * It includes the Extended71 surface, the two exact Vi, Destructive printings,
 * and the four exact pure Deflect printings.  The default and older named
 * factories intentionally leave these cards unresolved.
 */
export function createDuelFuryOptionalRosterOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, true, true);
}

/**
 * Explicit opt-in for the four source-verified point-damage Spell printings.
 * The older factories and their serialized references remain byte-for-byte
 * unchanged; this factory is the only registry that resolves these cards.
 */
export function createDuelPointDamageOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, true, true, true);
}

/**
 * Explicit opt-in for the two exact pure whole-ability Shield printings.
 * This composes the reviewed 81-program surface and adds only the two Shield
 * programs; all older factories and their serialized references stay unchanged.
 */
export function createDuelShieldOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, true, true, true, true);
}

/** Descriptive alias for callers that name the source family explicitly. */
export const createDuelPureShieldOfficialProgramRegistryV1 = createDuelShieldOfficialProgramRegistryV1;

/** Explicit opt-in for the 24 source-closed pure resource-only Equip abilities. */
export function createDuelEquipOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, true, true, true, true, true, false);
}

/** Explicit opt-in for the three Loose Cannon Beginning-Phase source programs. */
export function createDuelBeginningPhaseOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, true, true, true, true, false, true);
}

/** Explicit opt-in for both the Equip and beginning-draw source families. */
export function createDuelEquipBeginningOfficialProgramRegistryV1(source: DuelAbilitySource): DuelOfficialProgramRegistry {
  return createRegistry(source, true, true, true, true, true, true, true);
}

export const createDuelEquipAndBeginningOfficialProgramRegistryV1 = createDuelEquipBeginningOfficialProgramRegistryV1;
export const createDuelEquipBeginningSourceOfficialProgramRegistryV1 = createDuelEquipBeginningOfficialProgramRegistryV1;

function createRegistry(
  source: DuelAbilitySource,
  enablePureAssault: boolean,
  enablePureAccelerate: boolean,
  enableFuryOptionalRoster = false,
  enablePointDamage = false,
  enablePureShield = false,
  enableEquip = false,
  enableBeginningDraw = false,
): DuelOfficialProgramRegistry {
  source = snapshotData(source, "source") as DuelAbilitySource;
  assertSourceEnvelope(source);
  const bindings = new Map<string, DuelOfficialProgramBinding>();
  for (const card of source.cards) {
    bindings.set(card.id, makeBinding(source, card, createSemantics(source, card, enablePureAssault, enablePureAccelerate, enableFuryOptionalRoster, enablePointDamage, enablePureShield, enableEquip, enableBeginningDraw), enableEquip));
  }
  const order = [...bindings.keys()];
  const facade: DuelOfficialProgramRegistry = {
    get size() {
      return bindings.size;
    },
    get knownProgramCount() {
      let count = 0;
      for (const binding of bindings.values()) if (binding.status === "resolved") count += 1;
      return count;
    },
    has(cardId: string): boolean {
      return bindings.has(cardId);
    },
    cardIds(): readonly string[] {
      return [...order];
    },
    get(cardId: string): DuelOfficialProgramResolution | undefined {
      const binding = bindings.get(cardId);
      return binding === undefined ? undefined : cloneBinding(binding);
    },
    getProgram(cardId: string): DuelOfficialProgram | undefined {
      const binding = bindings.get(cardId);
      return binding?.program === null || binding?.program === undefined
        ? undefined
        : cloneProgram(binding.program);
    },
    reference(cardId: string): DuelOfficialProgramReference | undefined {
      const binding = bindings.get(cardId);
      if (binding?.status !== "resolved" || binding.program === null) return undefined;
      return createDuelProgramReference(binding.program);
    },
    resolve(reference: DuelOfficialProgramReference): DuelOfficialProgramResolution {
      return cloneBinding(bindingForReference(facade, reference));
    },
    eventScope(cardId: string, event: string): DuelEventScopeResult {
      const binding = bindings.get(cardId);
      return queryDuelEventScope(binding, event);
    },
    phaseEventScope(cardId: string, event: string): DuelPhaseEventScopeResult {
      const binding = bindings.get(cardId);
      return queryDuelPhaseEventScope(binding, event);
    },
    sourceProgramPhaseScope(
      cardId: string,
      eventOrContext: string | DuelSourceProgramPhaseScopeContext,
      reference?: DuelOfficialProgramReference,
    ): DuelSourceProgramPhaseScopeResult {
      return queryDuelSourceProgramPhaseScope(facade, cardId, eventOrContext, reference);
    },
  };
  SOURCE_PROGRAM_REGISTRIES.set(facade, bindings);
  return Object.freeze(facade);
}

export const createDuelProgramRegistry = createDuelOfficialProgramRegistry;

function knownEvent(event: string): event is DuelEventName {
  return (DUEL_EVENT_NAMES as readonly string[]).includes(event);
}

function knownPhaseEvent(event: string): event is DuelPhaseEventName {
  // Do not derive authority from an exported list. A new Core boundary needs a
  // reviewed explicit branch here AND in sourceProgramEffects before it can
  // receive a local negative answer.
  switch (event) {
    case "awaken": case "begin": case "hold": case "channel":
    case "draw": case "main": case "ending": case "expiration":
    case "fepr": case "required-cleanup": case "lethal-kill": case "burnout":
      return true;
    default:
      return false;
  }
}

function phaseUnknown(
  event: string,
  reason: DuelPhaseEventScopeReason,
  requiredContracts: readonly DuelPhaseScopeRequirement[] = [],
): DuelPhaseEventScopeResult {
  return {
    status: "unknown",
    scope: "unknown",
    event,
    programId: null,
    reference: null,
    handlers: [],
    modifiers: [],
    eventSupported: false,
    replacementsCovered: false,
    staticCovered: false,
    continuousCovered: false,
    triggersCovered: false,
    reason,
    ...(requiredContracts.length === 0 ? {} : { requiredContracts }),
    sourceCardId: null,
    sourceDataVersion: null,
    sourceCatalogDigest: null,
  };
}

function programFromScopeInput(
  input: DuelOfficialProgram | DuelOfficialProgramBinding | DuelOfficialProgramResolution | undefined,
): DuelOfficialProgram | null {
  if (input === undefined) return null;
  if ("status" in input) return input.status === "resolved" ? input.program : null;
  assertDuelOfficialProgram(input);
  return input;
}

/**
 * Derive event scope from the complete bound program. A known event with no
 * effect is `known-no-handler`; a partial/unknown program or unknown event is
 * `unknown`, never a guessed no-op.
 */
export function queryDuelEventScope(
  input: DuelOfficialProgram | DuelOfficialProgramBinding | DuelOfficialProgramResolution | undefined,
  event: string,
): DuelEventScopeResult {
  if (!knownEvent(event)) {
    return { status: "unknown", event, programId: null, handlers: [], modifiers: [], reason: "unknown-event" };
  }
  const program = programFromScopeInput(input);
  if (program === null) {
    return { status: "unknown", event, programId: null, handlers: [], modifiers: [], reason: "unresolved-program" };
  }

  const handlers: string[] = [];
  const modifiers: string[] = [];
  const semantics = program.semantics;
  if (semantics.kind === "static") {
    if (semantics.abilities.some((ability) => ability.scope === event)) {
      for (const ability of semantics.abilities) {
        if (ability.scope === event) handlers.push(`static.${ability.kind}`);
      }
    }
  } else if (semantics.kind === "basic-rune") {
    for (const ability of semantics.abilities) {
      if (ability.event === event) handlers.push(`basic-rune.${ability.kind}`);
    }
  } else if (semantics.kind === "trigger" || semantics.kind === "activated") {
    if (semantics.event === event) handlers.push(`${semantics.kind}.${semantics.event}`);
  } else if (semantics.kind === "passive" &&
      ((semantics.event === "hide" && event === "hide") ||
        (semantics.event === "attacker" && event === "attack") ||
        (semantics.event === "defender" && event === "defend"))) {
    modifiers.push(semantics.event === "hide"
      ? "passive.additional-hide-permission"
      : semantics.event === "attacker" ? "passive.self-assault" : "passive.self-shield");
  } else if (semantics.kind === "spell-resolution" && event === "spell-resolution") {
    handlers.push(`spell-resolution.${semantics.effects[0].kind}`);
  } else if (semantics.kind === "point-damage-spell-resolution" && event === "spell-resolution") {
    handlers.push("spell-resolution.point-damage");
  } else if (semantics.kind === "accelerate" && event === "unit-enter") {
    // Applicability only: the descriptor remains optional and the paid
    // replacement is conditional on the card-play choice and successful cost.
    handlers.push("optional.accelerate.unit-entry");
  } else if (semantics.kind === "continuous") {
    modifiers.push("continuous.token-unit-might");
  } else if (semantics.kind === "compound-vi-self") {
    if (event === "standard-move") modifiers.push("static.ganking");
    if (event === "activate") handlers.push("compound-vi-self.activate");
  } else if (semantics.kind === "deflect") {
    // `play` is the closest reviewed event boundary: Deflect contributes a
    // mandatory additional cost while an opponent finalizes a Spell/Ability
    // that chooses this source. The IR still carries the exact per-choice
    // rule; no payment or target choice is executed here.
    if (event === "play") modifiers.push("passive.deflect.additional-opponent-power-cost");
  } else if (semantics.kind === "equip-activated-ability") {
    if (event === "activate") handlers.push("activated.equip");
  } else if (semantics.kind === "beginning-phase-conditional-draw") {
    if (event === "begin") handlers.push("trigger.beginning-phase");
  }

  return {
    status: handlers.length > 0 || modifiers.length > 0 ? "handlers-or-modifiers" : "known-no-handler",
    event,
    programId: program.programId,
    handlers,
    modifiers,
  };
}

/**
 * Phase-boundary scope is intentionally stricter than the legacy event query.
 * The supported subset is explicit: the current whole-program compiler has
 * exhaustive scope coverage for Awaken, Beginning, and Hold. Core's other
 * boundaries require event subjects, continuous-effect state, or cleanup
 * journal/trigger evidence that this printing IR does not contain, so they
 * remain unknown even when the phase enum itself is recognized.
 */
const DUEL_SUPPORTED_PHASE_EVENTS: readonly DuelPhaseEventName[] = ["awaken", "begin", "hold"];

function phaseScopeForSemantics(
  semantics: DuelProgramSemantics,
  event: DuelPhaseEventName,
): { readonly handlers: readonly string[]; readonly modifiers: readonly string[] } | null {
  // Keep this switch exhaustive. A future semantic kind must not silently fall
  // through to a negative proof merely because it has no current event field.
  switch (semantics.kind) {
    case "static":
      return { handlers: [], modifiers: [] };
    case "no-ability":
      return { handlers: [], modifiers: [] };
    case "trigger":
      return event === "hold" && semantics.event === "hold"
        ? { handlers: ["trigger.hold"], modifiers: [] }
        : event === "begin"
          ? { handlers: [], modifiers: [] }
          : { handlers: [], modifiers: [] };
    case "beginning-phase-conditional-draw":
      return event === "begin"
        ? { handlers: ["trigger.beginning-phase"], modifiers: [] }
        : { handlers: [], modifiers: [] };
    case "activated":
      return { handlers: [], modifiers: [] };
    case "passive":
      // Hide and Attacker are runtime subevents, not direct phase-boundary
      // effects. Their source-local subevent proof is emitted below.
      return { handlers: [], modifiers: [] };
    case "basic-rune":
      return { handlers: [], modifiers: [] };
    case "spell-resolution":
      return { handlers: [], modifiers: [] };
    case "point-damage-spell-resolution":
      return { handlers: [], modifiers: [] };
    case "accelerate":
      return { handlers: [], modifiers: [] };
    case "continuous":
      return { handlers: [], modifiers: ["continuous.token-unit-might"] };
    case "compound-vi-self":
    case "deflect":
      // Neither a voluntary move/activation nor an opponent's target choice
      // fires merely because Awaken, Beginning, or Hold begins.
      return { handlers: [], modifiers: [] };
    case "equip-activated-ability":
      return { handlers: [], modifiers: [] };
    default:
      return null;
  }
}

/**
 * Query a source-bound program at a Core phase boundary.
 *
 * A result is `known-no-handler` only when the input is a complete resolved
 * program and the event belongs to the explicitly covered subset. Recognizing
 * a Core enum member alone never proves absence. The optional reference lets a
 * protected provider bind the proof to an exact source tuple; mismatches are
 * rejected rather than downgraded to a guessed no-op.
 */
export function queryDuelPhaseEventScope(
  input: DuelOfficialProgram | DuelOfficialProgramBinding | DuelOfficialProgramResolution | undefined,
  event: string,
  reference?: DuelOfficialProgramReference,
): DuelPhaseEventScopeResult {
  if (!knownPhaseEvent(event)) return phaseUnknown(event, "unknown-event");
  if (!DUEL_SUPPORTED_PHASE_EVENTS.includes(event)) {
    return phaseUnknown(event, "unsupported-phase-event", phaseRequirementsFor(event));
  }

  const program = programFromScopeInput(input);
  if (program === null) return phaseUnknown(event, "unresolved-program");
  if (reference !== undefined) {
    assertDuelOfficialProgramReference(reference);
    if (
      reference.cardId !== program.cardId ||
      reference.programId !== program.programId ||
      reference.dataVersion !== program.source.dataVersion ||
      reference.sourceCatalogDigest !== program.source.sourceCatalogDigest
    ) {
      throw new TypeError("Duel official program: phase scope reference does not match the complete program.");
    }
  }

  const scope = phaseScopeForSemantics(program.semantics, event);
  if (scope === null) return phaseUnknown(event, "unsupported-phase-event");
  const status: DuelEventScopeStatus = scope.handlers.length > 0 || scope.modifiers.length > 0
    ? "handlers-or-modifiers"
    : "known-no-handler";
  const resolvedReference = createDuelProgramReference(program);
  return {
    status,
    scope: status,
    event,
    programId: program.programId,
    reference: resolvedReference,
    handlers: [...scope.handlers],
    modifiers: [...scope.modifiers],
    eventSupported: true,
    replacementsCovered: true,
    staticCovered: true,
    continuousCovered: true,
    triggersCovered: true,
    sourceCardId: program.source.cardId,
    sourceDataVersion: program.source.dataVersion,
    sourceCatalogDigest: program.source.sourceCatalogDigest,
  };
}

/**
 * The source-scope query resolves only from the private registry index. Bare
 * programs, bindings, self-recompiled fingerprints and client references are
 * never authority for a negative proof. Registry construction still assumes an
 * independently authenticated upstream catalog (not a client-provided digest).
 */
function registrySourceProgram(
  registry: DuelOfficialProgramRegistry | DuelOfficialProgram | DuelOfficialProgramBinding | undefined,
  cardId: string,
): DuelOfficialProgram | null {
  if (registry === null || typeof registry !== "object") return null;
  const bindings = SOURCE_PROGRAM_REGISTRIES.get(registry as DuelOfficialProgramRegistry);
  if (bindings === undefined) return null;
  const binding = bindings.get(cardId);
  return binding?.status === "resolved" ? binding.program : null;
}

function sourceProgramContext(
  eventOrContext: string | DuelSourceProgramPhaseScopeContext,
): { readonly event: string; readonly mode: DuelSourceProgramPhaseScopeMode; readonly reason?: "invalid-context" | "unknown-event" } {
  if (typeof eventOrContext === "string") {
    return knownPhaseEvent(eventOrContext)
      ? { event: eventOrContext, mode: "atomic-boundary" }
      : { event: eventOrContext, mode: "atomic-boundary", reason: "unknown-event" };
  }
  const event = isPlainObject(eventOrContext) && typeof eventOrContext.phase === "string"
    ? eventOrContext.phase : "";
  const mode = isPlainObject(eventOrContext) && eventOrContext.mode === "runtime-subevents"
    ? "runtime-subevents" : "atomic-boundary";
  if (!isPlainObject(eventOrContext) || Object.keys(eventOrContext).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(eventOrContext, "phase") ||
    !Object.prototype.hasOwnProperty.call(eventOrContext, "mode") ||
    typeof eventOrContext.phase !== "string" ||
    (eventOrContext.mode !== "atomic-boundary" && eventOrContext.mode !== "runtime-subevents")) {
    return { event, mode, reason: "invalid-context" };
  }
  return knownPhaseEvent(event)
    ? { event, mode }
    : { event, mode, reason: "unknown-event" };
}

function sourceProgramRuntimeClosure(
  event: DuelPhaseEventName | null,
): readonly DuelSourceProgramGlobalRuntimeClosureRequirement[] {
  // Core can generate Conquer (including chained Conquer) independent of this
  // printing's semantics. The fixed-point event journal is a global obligation
  // on every query, including no-ability, unknown and Rune printings.
  const required: DuelSourceProgramGlobalRuntimeClosureRequirement[] = [
    "all-source-candidate-closure",
    "hidden-zone-event-subjects",
    "continuous-effect-registry",
    "cleanup-queue-and-replacements",
    "runtime-subevent-journal",
    "recursive-conquer-event-journal",
  ];
  if (event === "draw") required.push("draw-subject-journal");
  if (event === "lethal-kill") required.push("pre-exit-event-journal", "kill-trigger-effect-cases");
  return required;
}

function sourceProgramEffects(
  semantics: DuelProgramSemantics,
  event: DuelPhaseEventName,
): {
  readonly handlers: readonly string[];
  readonly modifiers: readonly string[];
  readonly runtimeSubevents: readonly DuelSourceProgramPhaseRuntimeSubevent[];
} | null {
  // Review each new Core boundary explicitly, before any semantic kind can
  // answer it. An expanded enum/list must never fall through to absence.
  switch (event) {
    case "awaken": case "begin": case "hold": case "channel":
    case "draw": case "main": case "ending": case "expiration":
    case "fepr": case "required-cleanup": case "lethal-kill": case "burnout":
      break;
    default:
      return null;
  }
  // Every currently compiled whole-program kind is explicit. A new kind must
  // add a branch before this API can issue any source-level negative answer.
  switch (semantics.kind) {
    case "static":
      return {
        handlers: [], modifiers: [],
        runtimeSubevents: semantics.abilities.map((ability) => ({
          event: ability.scope,
          handlers: [`static.${ability.kind}`],
          modifiers: [],
        })),
      };
    case "no-ability":
      // This excludes printed abilities, not generic Unit play/entry/Core rules.
      return { handlers: [], modifiers: [], runtimeSubevents: [] };
    case "trigger":
      if (semantics.event === "hold") {
        return {
          handlers: event === "hold" ? ["trigger.hold"] : [],
          modifiers: [], runtimeSubevents: [],
        };
      }
      if (semantics.event === "conquer") {
        // A conquer during this phase is a separate recursively journaled event,
        // never a handler that fires merely because the phase began.
        return {
          handlers: [], modifiers: [],
          runtimeSubevents: [{ event: "conquer", handlers: ["trigger.conquer"], modifiers: [] }],
        };
      }
      if (semantics.event === "unit-enter" || semantics.event === "play-gear" ||
          semantics.event === "card-play-on-opponent-turn") {
        return { handlers: [], modifiers: [], runtimeSubevents: [
          { event: semantics.event, handlers: [`trigger.${semantics.event}`], modifiers: [] },
        ] };
      }
      return null;
    case "beginning-phase-conditional-draw":
      return {
        handlers: event === "begin" ? ["trigger.beginning-phase"] : [],
        modifiers: [],
        runtimeSubevents: [{ event: "begin", handlers: ["trigger.beginning-phase"], modifiers: [] }],
      };
    case "equip-activated-ability":
      return {
        handlers: [], modifiers: [],
        runtimeSubevents: [{ event: "activate", handlers: ["activated.equip"], modifiers: ["activated.equip.base-cost", "activated.equip.target"] }],
      };
    case "activated":
      // A voluntary activation (including Viktor's costs) is not an automatic
      // phase subevent; it needs a separate activation/executor contract.
      return { handlers: [], modifiers: [], runtimeSubevents: [] };
    case "passive":
      if (semantics.event === "attacker") {
        return {
          handlers: [], modifiers: [],
          runtimeSubevents: [{ event: "attack", handlers: [], modifiers: ["passive.self-assault"] }],
        };
      }
      if (semantics.event === "defender") {
        return {
          handlers: [], modifiers: [],
          runtimeSubevents: [{ event: "defend", handlers: [], modifiers: ["passive.self-shield"] }],
        };
      }
      return {
        handlers: [], modifiers: [],
        runtimeSubevents: [{ event: "hide", handlers: [], modifiers: ["passive.additional-hide-permission"] }],
      };
    case "basic-rune":
      // Both abilities are Reaction activations, not phase-boundary triggers.
      return { handlers: [], modifiers: [], runtimeSubevents: [] };
    case "spell-resolution":
      return { handlers: [], modifiers: [], runtimeSubevents: [
        { event: "spell-resolution", handlers: [`spell-resolution.${semantics.effects[0].kind}`], modifiers: [] },
      ] };
    case "point-damage-spell-resolution":
      return { handlers: [], modifiers: [], runtimeSubevents: [
        { event: "spell-resolution", handlers: ["spell-resolution.point-damage"], modifiers: [] },
      ] };
    case "accelerate":
      // This identifies a possible Unit-entry replacement. It does not choose,
      // pay, ready, or claim that the optional branch was taken.
      return { handlers: [], modifiers: [], runtimeSubevents: [
        { event: "unit-enter", handlers: ["optional.accelerate.unit-entry"], modifiers: [] },
      ] };
    case "continuous":
      return { handlers: [], modifiers: ["continuous.token-unit-might"], runtimeSubevents: [] };
    case "compound-vi-self":
      // These are possible independent actions, not phase-entry effects.
      // The descriptor identifies applicability; the full IR holds Vi's
      // recycle cost and self Might effect for a future executor.
      return { handlers: [], modifiers: [], runtimeSubevents: [
        { event: "standard-move", handlers: [], modifiers: ["static.ganking"] },
        { event: "activate", handlers: ["compound-vi-self.activate"], modifiers: [] },
      ] };
    case "deflect":
      // CR 349/356/809.1.c/d: a spell or ability's choice of this Unit
      // adds mandatory wildcard Power per choice to its play cost. `play`
      // marks possible applicability only; the IR carries the exact
      // per-choice rule, and Core must supply subjects and payment.
      return { handlers: [], modifiers: [], runtimeSubevents: [
        { event: "play", handlers: [], modifiers: ["passive.deflect.additional-opponent-power-cost"] },
      ] };
    default:
      return null;
  }
}

function sourceProgramUnknown(
  event: string,
  mode: DuelSourceProgramPhaseScopeMode,
  reason: DuelSourceProgramPhaseScopeReason,
  phase: DuelPhaseEventName | null,
): DuelSourceProgramPhaseScopeResult {
  return freezeDeep({
    scope: "unknown", directBoundaryStatus: "unknown", sourceApplicabilityStatus: "unknown",
    globalClosureStatus: "unverified", event, mode,
    programId: null, reference: null,
    handlers: [], modifiers: [], runtimeSubevents: [],
    eventRecognized: phase !== null, sourceProgramComplete: false,
    requiredGlobalRuntimeClosure: sourceProgramRuntimeClosure(phase),
    reason, sourceCardId: null, sourceDataVersion: null, sourceCatalogDigest: null,
  });
}

/**
 * Query an independently indexed printing in an opaque registry. A bare program,
 * binding, matching digest or reference can never authorize a local absence;
 * only the facade created from the upstream-verified catalog holds the private
 * index. This is still NOT Core whole-phase evidence: UID, zone, epoch, runtime
 * subjects, nested events, and global fixed-point closure remain unverified.
 */
export function queryDuelSourceProgramPhaseScope(
  registry: DuelOfficialProgramRegistry | DuelOfficialProgram | DuelOfficialProgramBinding | undefined,
  cardId: string,
  eventOrContext: string | DuelSourceProgramPhaseScopeContext,
  reference?: DuelOfficialProgramReference,
): DuelSourceProgramPhaseScopeResult {
  // An old bare-program call has only two/three arguments. It must not treat
  // its phase or reference as a card id/context, even if the program self-checks.
  const context = sourceProgramContext(eventOrContext);
  const phase = knownPhaseEvent(context.event) ? context.event : null;
  if (context.reason !== undefined) {
    return sourceProgramUnknown(context.event, context.mode, context.reason, phase);
  }
  if (phase === null) return sourceProgramUnknown(context.event, context.mode, "unknown-event", null);
  const program = registrySourceProgram(registry, cardId);
  if (program === null) return sourceProgramUnknown(context.event, context.mode, "unresolved-program", phase);
  if (reference !== undefined) {
    assertDuelOfficialProgramReference(reference);
    if (
      reference.cardId !== program.cardId ||
      reference.programId !== program.programId ||
      reference.dataVersion !== program.source.dataVersion ||
      reference.sourceCatalogDigest !== program.source.sourceCatalogDigest
    ) {
      throw new TypeError("Duel official program: source-program phase reference does not match the registry printing.");
    }
  }
  const effects = sourceProgramEffects(program.semantics, phase);
  if (effects === null) {
    const reason = program.semantics.kind === "compound-vi-self" || program.semantics.kind === "deflect"
      ? "unsupported-runtime-scope" : "unresolved-program";
    return sourceProgramUnknown(context.event, context.mode, reason, phase);
  }
  const directBoundaryStatus: DuelEventScopeStatus = effects.handlers.length > 0 || effects.modifiers.length > 0
    ? "handlers-or-modifiers" : "known-no-handler";
  const sourceApplicabilityStatus: DuelEventScopeStatus = directBoundaryStatus === "handlers-or-modifiers" ||
    (context.mode === "runtime-subevents" && effects.runtimeSubevents.length > 0)
      ? "handlers-or-modifiers" : "known-no-handler";
  const requiredClosure = [...sourceProgramRuntimeClosure(phase)];
  const mayDraw = (("effects" in program.semantics &&
    program.semantics.effects.some(effect => effect.kind === "draw-cards")) ||
    (program.semantics.kind === "beginning-phase-conditional-draw" && phase === "begin")) &&
    (effects.handlers.length > 0 || context.mode === "runtime-subevents" && effects.runtimeSubevents.length > 0);
  if (mayDraw && !requiredClosure.includes("draw-subject-journal")) requiredClosure.push("draw-subject-journal");
  return freezeDeep({
    scope: "source-program", directBoundaryStatus, sourceApplicabilityStatus,
    globalClosureStatus: "unverified", event: phase, mode: context.mode,
    programId: program.programId, reference: createDuelProgramReference(program),
    handlers: [...effects.handlers], modifiers: [...effects.modifiers],
    runtimeSubevents: effects.runtimeSubevents.map((subevent) => ({
      event: subevent.event, handlers: [...subevent.handlers], modifiers: [...subevent.modifiers],
    })),
    eventRecognized: true,
    sourceProgramComplete: program.semantics.kind !== "beginning-phase-conditional-draw",
    requiredGlobalRuntimeClosure: requiredClosure,
    sourceCardId: program.source.cardId,
    sourceDataVersion: program.source.dataVersion,
    sourceCatalogDigest: program.source.sourceCatalogDigest,
  });
}

function phaseRequirementsFor(event: DuelPhaseEventName): readonly DuelPhaseScopeRequirement[] {
  switch (event) {
    case "channel":
    case "draw":
    case "main":
    case "burnout":
      return ["hidden-zone-event-subjects", "continuous-effect-registry"];
    case "ending":
    case "expiration":
    case "fepr":
    case "required-cleanup":
      return ["continuous-effect-registry", "cleanup-queue-and-replacements"];
    case "lethal-kill":
      return ["pre-exit-event-journal", "kill-trigger-effect-cases"];
    case "awaken":
    case "begin":
    case "hold":
      return [];
    default:
      return ["continuous-effect-registry"];
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  assertObject(value, "canonical JSON value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function assertDuelGoldIntrinsicAbilityReference(value: unknown): asserts value is DuelGoldIntrinsicAbilityReference {
  assertObject(value, "Gold intrinsic reference");
  assertExactKeys(value, ["kind", "schemaVersion", "ruleset", "intrinsicId"], "Gold intrinsic reference");
  if (
    value.kind !== DUEL_GOLD_INTRINSIC_REFERENCE_KIND ||
    value.schemaVersion !== DUEL_GOLD_INTRINSIC_SCHEMA_VERSION ||
    value.ruleset !== DUEL_OFFICIAL_RULESET ||
    value.intrinsicId !== DUEL_GOLD_INTRINSIC_ID
  ) {
    throw new TypeError("Duel official program: unknown Gold intrinsic token ability reference.");
  }
}

/** Reference resolves the CR rule spec, not an instance/UID or permission to create a token. */
export function resolveDuelGoldIntrinsicAbilityReference(reference: DuelGoldIntrinsicAbilityReference): DuelGoldIntrinsicTokenAbilitySpec {
  assertDuelGoldIntrinsicAbilityReference(reference);
  return getDuelGoldIntrinsicTokenAbilitySpec();
}

export function encodeDuelGoldIntrinsicAbilityReferenceRaw(reference: DuelGoldIntrinsicAbilityReference): string {
  assertDuelGoldIntrinsicAbilityReference(reference);
  return canonicalJson(reference);
}

export function decodeDuelGoldIntrinsicAbilityReferenceRaw(raw: string): DuelGoldIntrinsicAbilityReference {
  if (typeof raw !== "string") throw new TypeError("Gold intrinsic reference raw codec: raw must be a string.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("Gold intrinsic reference raw codec: raw value is not JSON.");
  }
  assertDuelGoldIntrinsicAbilityReference(parsed);
  if (canonicalJson(parsed) !== raw) throw new TypeError("Gold intrinsic reference raw codec: raw JSON is not canonical.");
  return createDuelGoldIntrinsicAbilityReference();
}

function assertGoldTokenSpec(value: unknown, label: string): asserts value is DuelGoldGearTokenSpec {
  assertObject(value, label);
  assertExactKeys(value, [
    "kind", "tokenName", "cardType", "domains", "domainless", "energy", "power", "might",
    "physicalPrintingCardId", "defaultEntryReady", "intrinsicAbility",
  ], label);
  if (value.kind !== "gear-token" || value.tokenName !== "Gold" || value.cardType !== "Gear") {
    throw new TypeError(`Duel official program: ${label} must be a Gold Gear token, not a physical card or Unit.`);
  }
  if (!Array.isArray(value.domains)) throw new TypeError(`Duel official program: ${label}.domains must be an array.`);
  assertExactDenseArray(value.domains, `${label}.domains`);
  if (value.domains.length !== 0 || value.domainless !== true) {
    throw new TypeError(`Duel official program: ${label} must be domainless.`);
  }
  if (
    value.energy !== null || value.power !== null || value.might !== null ||
    value.physicalPrintingCardId !== null || value.defaultEntryReady !== true
  ) {
    throw new TypeError(`Duel official program: ${label} has invalid Gold token properties.`);
  }
  assertDuelGoldIntrinsicAbilityReference(value.intrinsicAbility);
}

function assertTokenSpec(value: unknown, label: string): asserts value is DuelRecruitTokenSpec {
  assertObject(value, label);
  assertExactKeys(value, [
    "kind",
    "cardType",
    "domains",
    "domainless",
    "tags",
    "energy",
    "power",
    "might",
    "physicalPrintingCardId",
  ], label);
  if (value.kind !== "unit-token" || value.cardType !== "Unit") throw new TypeError(`Duel official program: ${label} is not a Unit token.`);
  if (!Array.isArray(value.domains)) throw new TypeError(`Duel official program: ${label}.domains must be an array.`);
  assertExactDenseArray(value.domains, `${label}.domains`);
  assertStringArray(value.tags, `${label}.tags`);
  if (value.domains.length !== 0) throw new TypeError(`Duel official program: ${label}.domains must be empty.`);
  if (
    value.domainless !== true ||
    value.tags.length !== 1 ||
    value.tags[0] !== "Recruit"
  ) {
    throw new TypeError(`Duel official program: ${label} must be a domainless Recruit token.`);
  }
  if (value.energy !== null || value.power !== null || value.might !== 1 || value.physicalPrintingCardId !== null) {
    throw new TypeError(`Duel official program: ${label} has invalid Recruit token stats.`);
  }
}

function assertCost(value: unknown, label: string): asserts value is DuelCost {
  assertObject(value, label);
  if (value.kind === "exhaust-source") {
    assertExactKeys(value, ["kind"], label);
    return;
  }
  if (value.kind === "energy") {
    assertExactKeys(value, ["kind", "amount", "payer"], label);
    if (value.amount !== 1 || value.payer !== "ability-controller") {
      throw new TypeError(`Duel official program: ${label} has an unsupported energy cost.`);
    }
    return;
  }
  throw new TypeError(`Duel official program: unknown cost in ${label}.`);
}

function assertEffect(value: unknown, label: string): asserts value is DuelEffect {
  assertObject(value, label);
  if (value.kind === "ready-source") {
    assertExactKeys(value, ["kind"], label);
    return;
  }
  if (value.kind === "kill-unit" || value.kind === "kill-units") {
    assertExactKeys(value, ["kind", "controller", "selection"], label);
    if (value.kind === "kill-unit"
      ? value.selection !== "target" || (value.controller !== "any" && value.controller !== "enemy")
      : value.selection !== "all" || value.controller !== "any") {
      throw new TypeError(`Duel official program: ${label} has invalid Kill selection.`);
    }
    return;
  }
  if (value.kind === "each-player-kills-unit") {
    assertExactKeys(value, ["kind", "selection"], label);
    if (value.selection !== "each-player-choice") throw new TypeError(`Duel official program: ${label} has invalid player choice.`);
    return;
  }
  if (value.kind === "deal-damage") {
    assertExactKeys(value, ["kind", "amount", "distribution", "targets"], label);
    assertObject(value.targets, `${label}.targets`);
    assertExactKeys(value.targets, ["kind", "controller", "minSelections", "maxSelections"], `${label}.targets`);
    if (value.amount !== 6 || value.distribution !== "each" || value.targets.kind !== "unit" ||
        value.targets.controller !== "any" || value.targets.minSelections !== 0 || value.targets.maxSelections !== 2) {
      throw new TypeError(`Duel official program: ${label} has invalid Damage instructions.`);
    }
    return;
  }
  if (value.kind === "point-damage") {
    assertExactKeys(value, ["kind", "amount", "target"], label);
    assertObject(value.target, `${label}.target`);
    assertExactKeys(value.target, ["kind", "controller", "location", "minSelections", "maxSelections"], `${label}.target`);
    if (![2, 3, 6, 8].includes(value.amount as number) || value.target.kind !== "unit" ||
        value.target.controller !== "any" ||
        (value.target.location !== "battlefield" && value.target.location !== "any") ||
        value.target.minSelections !== 1 || value.target.maxSelections !== 1) {
      throw new TypeError(`Duel official program: ${label} has invalid point-damage instructions.`);
    }
    return;
  }
  if (value.kind === "draw-cards") {
    assertExactKeys(value, ["kind", "amount", "recipient"], label);
    if (!Number.isSafeInteger(value.amount) || (value.amount as number) < 1 ||
        value.recipient !== "effect-controller") {
      throw new TypeError(`Duel official program: ${label} has invalid Draw semantics.`);
    }
    return;
  }
  if (value.kind === "ready-unit") {
    assertExactKeys(value, ["kind", "target"], label);
    assertObject(value.target, `${label}.target`);
    assertExactKeys(value.target, ["kind", "controller", "scope"], `${label}.target`);
    if (value.target.kind !== "unit" || value.target.controller !== "any" || value.target.scope !== "legal-unit") {
      throw new TypeError(`Duel official program: ${label}.target is not the unrestricted legal Unit target.`);
    }
    return;
  }
  if (value.kind === "play-recruit-token") {
    assertExactKeys(value, ["kind", "token", "controller", "owner", "destination", "resolution"], label);
    assertTokenSpec(value.token, `${label}.token`);
    if (
      value.controller !== "effect-controller" ||
      value.owner !== "effect-controller" ||
      (value.destination !== "base" && value.destination !== "executor-defined") ||
      value.resolution !== "deferred-token-play"
    ) {
      throw new TypeError(`Duel official program: ${label} has invalid controller, destination or resolution.`);
    }
    return;
  }
  if (value.kind === "play-gold-gear-token") {
    assertExactKeys(value, ["kind", "token", "controller", "owner", "destination", "entryExhausted", "resolution"], label);
    assertGoldTokenSpec(value.token, `${label}.token`);
    if (
      value.controller !== "effect-controller" ||
      value.owner !== "effect-controller" ||
      value.destination !== "effect-controller-base" ||
      value.entryExhausted !== true ||
      value.resolution !== "deferred-token-play"
    ) {
      throw new TypeError(`Duel official program: ${label} has invalid Gold creation semantics.`);
    }
    return;
  }
  throw new TypeError(`Duel official program: unknown effect in ${label}.`);
}

function assertBasicRuneSemantics(value: Record<string, unknown>, label: string): void {
  assertExactKeys(value, ["kind", "sourceRule", "domain", "abilities"], label);
  if (value.sourceRule !== "CR-v1.4:164.2" || !BASIC_RUNE_IDENTITIES.some((row) => row.domain === value.domain)) {
    throw new TypeError(`Duel official program: ${label} has invalid Basic Rune rule/domain.`);
  }
  if (!Array.isArray(value.abilities)) throw new TypeError(`Duel official program: ${label}.abilities must be an array.`);
  assertExactDenseArray(value.abilities, `${label}.abilities`);
  if (value.abilities.length !== 2) {
    throw new TypeError(`Duel official program: ${label} requires both Basic Rune abilities.`);
  }
  const [energy, power] = value.abilities;
  assertObject(energy, `${label}.abilities[0]`);
  assertObject(power, `${label}.abilities[1]`);
  for (const [index, ability, kind, sourceRule] of [
    [0, energy, "basic-rune-energy", "CR-v1.4:164.2.a"],
    [1, power, "basic-rune-power", "CR-v1.4:164.2.b/164.2.b.1"],
  ] as const) {
    const at = `${label}.abilities[${index}]`;
    assertExactKeys(ability, ["kind", "sourceRule", "event", "sourceScope", "permission", "costs", "effects"], at);
    if (ability.kind !== kind || ability.sourceRule !== sourceRule || ability.event !== "activate" ||
        ability.sourceScope !== "source-basic-rune" || ability.permission !== "reaction" ||
        !Array.isArray(ability.costs) || ability.costs.length !== 1 ||
        !Array.isArray(ability.effects) || ability.effects.length !== 1) {
      throw new TypeError(`Duel official program: ${at} has invalid ability permission, rule or arity.`);
    }
    assertExactDenseArray(ability.costs, `${at}.costs`);
    assertExactDenseArray(ability.effects, `${at}.effects`);
  }
  const energyCosts = energy.costs as unknown[];
  const energyEffects = energy.effects as unknown[];
  const powerCosts = power.costs as unknown[];
  const powerEffects = power.effects as unknown[];
  assertObject(energyCosts[0], `${label}.abilities[0].costs[0]`);
  assertExactKeys(energyCosts[0], ["kind"], `${label}.abilities[0].costs[0]`);
  if (energyCosts[0].kind !== "exhaust-source") throw new TypeError("Duel official program: Basic Rune Energy must exhaust its source.");
  assertObject(energyEffects[0], `${label}.abilities[0].effects[0]`);
  assertExactKeys(energyEffects[0], ["kind", "amount", "recipient", "destination", "expiration"], `${label}.abilities[0].effects[0]`);
  if (energyEffects[0].kind !== "add-energy" || energyEffects[0].amount !== 1) {
    throw new TypeError("Duel official program: Basic Rune Energy must add one Energy.");
  }
  assertObject(powerCosts[0], `${label}.abilities[1].costs[0]`);
  assertExactKeys(powerCosts[0], ["kind", "destination", "readiness"], `${label}.abilities[1].costs[0]`);
  if (powerCosts[0].kind !== "recycle-source" || powerCosts[0].destination !== "source-owner-rune-deck" ||
      powerCosts[0].readiness !== "ready-or-exhausted") {
    throw new TypeError("Duel official program: Basic Rune Power must recycle its source to the Rune Deck regardless of readiness.");
  }
  assertObject(powerEffects[0], `${label}.abilities[1].effects[0]`);
  assertExactKeys(powerEffects[0], ["kind", "amount", "domain", "domainSource", "recipient", "destination", "expiration"], `${label}.abilities[1].effects[0]`);
  if (powerEffects[0].kind !== "add-domain-power" || powerEffects[0].amount !== 1 ||
      powerEffects[0].domain !== value.domain || powerEffects[0].domainSource !== "source-rune-domain") {
    throw new TypeError("Duel official program: Basic Rune Power must add one Power of its source Rune domain.");
  }
  for (const [effect, at] of [[energyEffects[0], "Energy"], [powerEffects[0], "Power"]] as const) {
    if (effect.recipient !== "ability-controller" || effect.destination !== "rune-pool" || effect.expiration !== "rune-pool-reset") {
      throw new TypeError(`Duel official program: Basic Rune ${at} must go to the controller Rune Pool until reset.`);
    }
  }
}

function assertSemantics(value: unknown, label: string): asserts value is DuelProgramSemantics {
  assertObject(value, label);
  if (value.kind === "accelerate") {
    assertExactKeys(value, ["kind", "choiceTiming", "optional", "additionalCost", "paidEffect"], label);
    if (value.choiceTiming !== "card-play-choices" || value.optional !== true) {
      throw new TypeError(`Duel official program: ${label} must preserve the explicit optional card-play choice.`);
    }
    assertObject(value.additionalCost, `${label}.additionalCost`);
    const additionalCost = value.additionalCost;
    assertExactKeys(additionalCost, ["energy", "power"], `${label}.additionalCost`);
    if (additionalCost.energy !== 1) {
      throw new TypeError(`Duel official program: ${label}.additionalCost.energy must be exactly 1.`);
    }
    assertExactDenseArray(additionalCost.power, `${label}.additionalCost.power`);
    const powerDescriptors = additionalCost.power as unknown[];
    if (powerDescriptors.length !== 1) {
      throw new TypeError(`Duel official program: ${label}.additionalCost.power must contain exactly one descriptor.`);
    }
    const power = powerDescriptors[0];
    assertObject(power, `${label}.additionalCost.power[0]`);
    assertExactKeys(power, ["allowedDomains", "amount"], `${label}.additionalCost.power[0]`);
    if (power.amount !== 1) {
      throw new TypeError(`Duel official program: ${label}.additionalCost.power amount must be exactly 1.`);
    }
    assertStringArray(power.allowedDomains, `${label}.additionalCost.power[0].allowedDomains`);
    const allowed = new Set(power.allowedDomains);
    if (allowed.size !== power.allowedDomains.length ||
        power.allowedDomains.some((domain) => !(DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS as readonly string[]).includes(domain))) {
      throw new TypeError(`Duel official program: ${label}.additionalCost.power domains are unsupported or duplicated.`);
    }
    assertObject(value.paidEffect, `${label}.paidEffect`);
    assertExactKeys(value.paidEffect, ["kind", "timing"], `${label}.paidEffect`);
    if (value.paidEffect.kind !== "enter-ready-replacement" || value.paidEffect.timing !== "unit-entry") {
      throw new TypeError(`Duel official program: ${label} must keep the paid Unit-entry replacement.`);
    }
    return;
  }
  if (value.kind === "spell-resolution") {
    assertExactKeys(value, Object.hasOwn(value, "permission") ? ["kind", "effects", "permission"] : ["kind", "effects"], label);
    if (!Array.isArray(value.effects) || value.effects.length !== 1) {
      throw new TypeError(`Duel official program: ${label} requires one instruction.`);
    }
    assertExactDenseArray(value.effects, `${label}.effects`);
    assertEffect(value.effects[0], `${label}.effects[0]`);
    const effect = value.effects[0];
    if (Object.hasOwn(value, "permission")) {
      if (value.permission !== "reaction" || effect.kind !== "draw-cards" || effect.amount !== 3) {
        throw new TypeError(`Duel official program: ${label} has unsupported timing permission.`);
      }
      return;
    }
    if (!((effect.kind === "draw-cards" && effect.amount === 4) ||
        (effect.kind === "kill-unit" && effect.controller === "any") ||
        effect.kind === "kill-units" || effect.kind === "each-player-kills-unit" || effect.kind === "deal-damage")) {
      throw new TypeError(`Duel official program: ${label} has unsupported Spell instructions.`);
    }
    return;
  }
  if (value.kind === "point-damage-spell-resolution") {
    assertExactKeys(value, ["kind", "effects"], label);
    if (!Array.isArray(value.effects) || value.effects.length !== 1) {
      throw new TypeError(`Duel official program: ${label} requires one point-damage instruction.`);
    }
    assertExactDenseArray(value.effects, `${label}.effects`);
    assertEffect(value.effects[0], `${label}.effects[0]`);
    if (value.effects[0]?.kind !== "point-damage") {
      throw new TypeError(`Duel official program: ${label} requires a point-damage effect.`);
    }
    return;
  }
  if (value.kind === "continuous") {
    assertExactKeys(value, ["kind", "sourceScope", "modifier"], label);
    assertObject(value.modifier, `${label}.modifier`);
    assertExactKeys(value.modifier, ["kind", "amount", "controller", "scope"], `${label}.modifier`);
    if (value.sourceScope !== "source-unit-on-board" || value.modifier.kind !== "token-unit-might" ||
        value.modifier.amount !== 1 || value.modifier.controller !== "ability-controller" || value.modifier.scope !== "board") {
      throw new TypeError(`Duel official program: ${label} has invalid token Might modifier.`);
    }
    return;
  }
  if (value.kind === "basic-rune") {
    assertBasicRuneSemantics(value, label);
    return;
  }
  if (value.kind === "static") {
    assertExactKeys(value, ["kind", "abilities"], label);
    if (!Array.isArray(value.abilities)) throw new TypeError(`Duel official program: ${label}.abilities must be an array.`);
    assertExactDenseArray(value.abilities, `${label}.abilities`);
    if (value.abilities.length === 0 || value.abilities.length > 2) {
      throw new TypeError(`Duel official program: ${label}.abilities must be a nonempty array of at most two.`);
    }
    for (const [index, ability] of value.abilities.entries()) {
      assertObject(ability, `${label}.abilities[${index}]`);
      assertExactKeys(ability, ["kind", "subject", "scope", "mode"], `${label}.abilities[${index}]`);
      if (
        (ability.kind !== "ganking" && ability.kind !== "enter-ready") ||
        ability.subject !== "self" ||
        (ability.kind === "ganking" && (ability.scope !== "standard-move" || ability.mode !== "permission")) ||
        (ability.kind === "enter-ready" && (ability.scope !== "unit-enter" || ability.mode !== "replacement"))
      ) {
        throw new TypeError(`Duel official program: invalid static ability in ${label}.`);
      }
    }
    return;
  }
  if (value.kind === "no-ability") {
    assertExactKeys(value, ["kind", "playability"], label);
    assertObject(value.playability, `${label}.playability`);
    assertExactKeys(value.playability, ["kind", "fromHand", "energyCost", "tokenOnly"], `${label}.playability`);
    if (value.playability.kind === "printed-unit") {
      if (value.playability.fromHand !== true || value.playability.tokenOnly !== false) throw new TypeError(`Duel official program: invalid printed Unit playability.`);
      assertSafeIntegerOrNull(value.playability.energyCost, `${label}.playability.energyCost`);
      if (value.playability.energyCost === null) throw new TypeError(`Duel official program: printed Unit needs an Energy cost.`);
    } else if (value.playability.kind === "recruit-token") {
      if (value.playability.fromHand !== false || value.playability.tokenOnly !== true || value.playability.energyCost !== null) {
        throw new TypeError(`Duel official program: invalid Recruit token playability.`);
      }
    } else {
      throw new TypeError(`Duel official program: unknown no-ability playability.`);
    }
    return;
  }
  if (value.kind === "trigger") {
    assertExactKeys(value, value.sourceScope === "conquering-source-unit" ||
      value.event === "unit-enter" || value.event === "play-gear" || value.event === "card-play-on-opponent-turn"
      ? ["kind", "event", "sourceScope", "eventPredicate", "condition", "optional", "costs", "effects"]
      : ["kind", "event", "sourceScope", "condition", "optional", "costs", "effects"], label);
    if (value.event === "conquer") {
      if (value.sourceScope === "conquering-source-unit") {
        assertObject(value.eventPredicate, `${label}.eventPredicate`);
        assertExactKeys(value.eventPredicate, ["kind", "participant", "battlefield", "pointOutcome"], `${label}.eventPredicate`);
        if (
          value.eventPredicate.kind !== "source-unit-present-at-conquered-battlefield" ||
          value.eventPredicate.participant !== "ability-source-unit" ||
          value.eventPredicate.battlefield !== "conquered-battlefield" ||
          value.eventPredicate.pointOutcome !== "including-negated-or-replaced" ||
          value.condition !== null || value.optional !== false
        ) {
          throw new TypeError(`Duel official program: invalid source Unit conquer trigger in ${label}.`);
        }
      } else if (
        value.sourceScope !== "ability-source" ||
        value.optional !== true ||
        !isPlainObject(value.condition) ||
        Object.keys(value.condition).length !== 2 ||
        value.condition.kind !== "assigned-excess-damage-at-least" ||
        value.condition.amount !== 3
      ) throw new TypeError(`Duel official program: invalid conquer trigger in ${label}.`);
    } else if (value.event === "hold") {
      if (value.sourceScope !== "battlefield-controller" || value.condition !== null || value.optional !== false) {
        throw new TypeError(`Duel official program: invalid hold trigger in ${label}.`);
      }
    } else if (value.event === "unit-enter" || value.event === "play-gear" || value.event === "card-play-on-opponent-turn") {
      const scope = value.event === "unit-enter" ? "played-source-unit" :
        value.event === "play-gear" ? "controller-plays-gear" : "controller-plays-card-on-opponent-turn";
      if (value.sourceScope !== scope || value.condition !== null || value.optional !== false) {
        throw new TypeError(`Duel official program: invalid Unit event predicate in ${label}.`);
      }
      assertObject(value.eventPredicate, `${label}.eventPredicate`);
      const predicate = value.eventPredicate;
      if (value.event === "unit-enter") {
        assertExactKeys(predicate, ["kind", "source", "countered"], `${label}.eventPredicate`);
        if (predicate.kind !== "source-play-completed" || predicate.source !== "ability-source" || predicate.countered !== false) {
          throw new TypeError(`Duel official program: ${label} requires the source's completed play.`);
        }
      } else {
        assertExactKeys(predicate, ["kind", "actor", "cardType", "turn", "countered"], `${label}.eventPredicate`);
        if (predicate.kind !== "controller-play-completed" || predicate.actor !== "source-controller-at-event" ||
            predicate.countered !== false || predicate.cardType !== (value.event === "play-gear" ? "Gear" : "any") ||
            predicate.turn !== (value.event === "play-gear" ? "any" : "opponent")) {
          throw new TypeError(`Duel official program: ${label} requires the controller's completed play predicate.`);
        }
      }
    } else {
      throw new TypeError(`Duel official program: unknown trigger event in ${label}.`);
    }
    if (!Array.isArray(value.costs) || !Array.isArray(value.effects)) throw new TypeError(`Duel official program: trigger arrays are required.`);
    assertExactDenseArray(value.costs, `${label}.costs`);
    assertExactDenseArray(value.effects, `${label}.effects`);
    for (const [index, cost] of value.costs.entries()) assertCost(cost, `${label}.costs[${index}]`);
    for (const [index, effect] of value.effects.entries()) assertEffect(effect, `${label}.effects[${index}]`);
    if (value.event === "unit-enter" || value.event === "play-gear" || value.event === "card-play-on-opponent-turn") {
      const effect = value.effects[0];
      const supported = value.event === "unit-enter"
        ? (effect?.kind === "draw-cards" && effect.amount === 1) ||
          (effect?.kind === "kill-unit" && effect.controller === "enemy")
        : value.event === "play-gear" ? effect?.kind === "ready-source"
          : effect?.kind === "play-recruit-token" && effect.destination === "base";
      if (value.costs.length !== 0 || value.effects.length !== 1 || !supported) {
        throw new TypeError(`Duel official program: unsupported Unit event instruction in ${label}.`);
      }
    }
    if (value.event === "conquer" && value.sourceScope === "conquering-source-unit") {
      if (value.costs.length !== 0 || value.effects.length !== 1 || value.effects[0]?.kind !== "play-gold-gear-token") {
        throw new TypeError(`Duel official program: source Unit conquer must play one exhausted Gold without a cost.`);
      }
    } else if (value.event === "conquer" && (value.costs.length !== 1 || value.costs[0]?.kind !== "exhaust-source" || value.effects.length !== 1 || value.effects[0]?.kind !== "ready-unit")) {
      throw new TypeError(`Duel official program: conquer trigger must preserve its exhaust cost and ready target.`);
    }
    if (value.event === "hold" && (value.costs.length !== 0 || value.effects.length !== 1 ||
        (value.effects[0]?.kind !== "play-recruit-token" &&
          !(value.effects[0]?.kind === "draw-cards" && value.effects[0].amount === 1)))) {
      throw new TypeError(`Duel official program: hold trigger must preserve its verified instruction.`);
    }
    return;
  }
  if (value.kind === "activated") {
    assertExactKeys(value, ["kind", "event", "sourceScope", "costs", "effects"], label);
    if (value.event !== "activate" || value.sourceScope !== "ability-source") {
      throw new TypeError(`Duel official program: invalid activated ability in ${label}.`);
    }
    if (!Array.isArray(value.costs) || !Array.isArray(value.effects)) throw new TypeError(`Duel official program: activated arrays are required.`);
    assertExactDenseArray(value.costs, `${label}.costs`);
    assertExactDenseArray(value.effects, `${label}.effects`);
    if (value.costs.length !== 2 || value.costs[0]?.kind !== "energy" || value.costs[1]?.kind !== "exhaust-source" || value.effects.length !== 1 || value.effects[0]?.kind !== "play-recruit-token") {
      throw new TypeError(`Duel official program: Viktor activation must preserve both costs and Recruit play.`);
    }
    for (const [index, cost] of value.costs.entries()) assertCost(cost, `${label}.costs[${index}]`);
    for (const [index, effect] of value.effects.entries()) assertEffect(effect, `${label}.effects[${index}]`);
    return;
  }
  if (value.kind === "compound-vi-self") {
    assertExactKeys(value, ["kind", "sourceScope", "ganking", "activation"], label);
    if (value.sourceScope !== "source-unit-on-board") {
      throw new TypeError(`Duel official program: invalid Vi compound source scope in ${label}.`);
    }
    assertObject(value.ganking, `${label}.ganking`);
    assertExactKeys(value.ganking, ["kind", "subject", "scope", "mode"], `${label}.ganking`);
    if (value.ganking.kind !== "ganking" || value.ganking.subject !== "self" ||
        value.ganking.scope !== "standard-move" || value.ganking.mode !== "permission") {
      throw new TypeError(`Duel official program: Vi compound must preserve Ganking's standard-move permission.`);
    }
    assertObject(value.activation, `${label}.activation`);
    assertExactKeys(value.activation, ["event", "sourceScope", "costs", "effects"], `${label}.activation`);
    if (value.activation.event !== "activate" || value.activation.sourceScope !== "source-unit-on-board" ||
        !Array.isArray(value.activation.costs) || !Array.isArray(value.activation.effects)) {
      throw new TypeError(`Duel official program: Vi compound activation shape is invalid.`);
    }
    assertExactDenseArray(value.activation.costs, `${label}.activation.costs`);
    assertExactDenseArray(value.activation.effects, `${label}.activation.effects`);
    if (value.activation.costs.length !== 1 || value.activation.effects.length !== 1) {
      throw new TypeError(`Duel official program: Vi compound requires one Recycle cost and one Might effect.`);
    }
    const cost = value.activation.costs[0];
    assertObject(cost, `${label}.activation.costs[0]`);
    assertExactKeys(cost, ["kind", "amount", "selector", "zone", "payer"], `${label}.activation.costs[0]`);
    if (cost.kind !== "recycle-from-trash" || cost.amount !== 1 || cost.selector !== "one-card" ||
        cost.zone !== "controller-trash" || cost.payer !== "ability-controller") {
      throw new TypeError(`Duel official program: Vi compound must select one card from the controller's trash as a cost.`);
    }
    const effect = value.activation.effects[0];
    assertObject(effect, `${label}.activation.effects[0]`);
    assertExactKeys(effect, ["kind", "amount", "recipient", "duration"], `${label}.activation.effects[0]`);
    if (effect.kind !== "add-might" || effect.amount !== 1 || effect.recipient !== "ability-source-unit" ||
        effect.duration !== "this-turn") {
      throw new TypeError(`Duel official program: Vi compound must grant the source Unit +1 Might this turn.`);
    }
    return;
  }
  if (value.kind === "deflect") {
    assertExactKeys(value, ["kind", "sourceScope", "event", "modifier"], label);
    if (value.sourceScope !== "source-unit-on-board" || value.event !== "opponent-choice") {
      throw new TypeError(`Duel official program: Deflect must apply to an opponent's choice of the source Unit.`);
    }
    assertObject(value.modifier, `${label}.modifier`);
    assertExactKeys(value.modifier, ["kind", "amount", "powerDomain", "payer", "timing", "per", "optional", "automaticPayment", "choice"], `${label}.modifier`);
    if (value.modifier.kind !== "additional-opponent-power-cost" || value.modifier.amount !== 1 ||
        value.modifier.powerDomain !== "wildcard" || value.modifier.payer !== "opponent" ||
        value.modifier.timing !== "additional-play-cost" || value.modifier.per !== "each-choice-of-source" ||
        value.modifier.optional !== false ||
        value.modifier.automaticPayment !== false) {
      throw new TypeError(`Duel official program: Deflect must add one opponent wildcard Power to the play cost for each choice.`);
    }
    assertObject(value.modifier.choice, `${label}.modifier.choice`);
    assertExactKeys(value.modifier.choice, ["source", "target"], `${label}.modifier.choice`);
    if (value.modifier.choice.source !== "spell-or-ability" || value.modifier.choice.target !== "source-unit-on-board") {
      throw new TypeError(`Duel official program: Deflect choice scope must be a Spell or Ability choosing the source Unit.`);
    }
    return;
  }
  if (value.kind === "equip-activated-ability") {
    assertExactKeys(value, ["kind", "event", "sourceScope", "abilityClass", "cost", "costAlternatives", "costAlterations", "target", "attach", "timing", "runtime"], label);
    if (value.event !== "activate" || value.sourceScope !== "source-gear-on-board" || value.abilityClass !== "activated-ability" ||
        !Array.isArray(value.costAlternatives) || value.costAlternatives.length !== 0 ||
        !Array.isArray(value.costAlterations) || value.costAlterations.length !== 0 || value.timing !== "main-open-outside-showdown") {
      throw new TypeError(`Duel official program: ${label} has invalid Equip activation scope.`);
    }
    assertExactDenseArray(value.costAlternatives, `${label}.costAlternatives`);
    assertExactDenseArray(value.costAlterations, `${label}.costAlterations`);
    assertObject(value.cost, `${label}.cost`);
    assertExactKeys(value.cost, ["kind", "literal", "energy", "power", "nonResourceLiteral"], `${label}.cost`);
    const equipEnergy = value.cost.energy;
    if (value.cost.kind !== "base-cost" || typeof value.cost.literal !== "string" || value.cost.literal.length === 0 ||
        typeof equipEnergy !== "number" || !Number.isSafeInteger(equipEnergy) || equipEnergy < 0 || value.cost.nonResourceLiteral !== null) {
      throw new TypeError(`Duel official program: ${label} must preserve its complete resource-only Equip base cost.`);
    }
    if (value.cost.power !== null) {
      assertObject(value.cost.power, `${label}.cost.power`);
      if (value.cost.power.kind !== "specific-domain" && value.cost.power.kind !== "any-domain") {
        throw new TypeError(`Duel official program: ${label} has invalid Equip Power cost.`);
      }
      if (value.cost.power.kind === "specific-domain" &&
          !(DUEL_EQUIP_RUNE_DOMAINS as readonly string[]).includes(String(value.cost.power.domain))) {
        throw new TypeError(`Duel official program: ${label} has an invalid Equip Rune domain.`);
      }
      assertExactKeys(value.cost.power, value.cost.power.kind === "specific-domain" ? ["kind", "domain"] : ["kind"], `${label}.cost.power`);
    }
    assertObject(value.target, `${label}.target`);
    assertExactKeys(value.target, ["kind", "controller", "scope", "selection"], `${label}.target`);
    if (value.target.kind !== "unit" || value.target.controller !== "source-controller" ||
        value.target.scope !== "controlled-unit" || value.target.selection !== "target") {
      throw new TypeError(`Duel official program: ${label} must preserve Equip's source-controller target.`);
    }
    assertObject(value.attach, `${label}.attach`);
    assertExactKeys(value.attach, ["kind", "destination", "resolution"], `${label}.attach`);
    if (value.attach.kind !== "attach-source-gear" || value.attach.destination !== "target-unit" || value.attach.resolution !== "deferred-attachment") {
      throw new TypeError(`Duel official program: ${label} has invalid deferred attachment semantics.`);
    }
    assertObject(value.runtime, `${label}.runtime`);
    assertExactKeys(value.runtime, ["status", "required"], `${label}.runtime`);
    if (value.runtime.status !== "pending" || !Array.isArray(value.runtime.required) ||
        value.runtime.required.length !== 2 || value.runtime.required[0] !== "canonical-source-controller" ||
        value.runtime.required[1] !== "equip-activation-executor") {
      throw new TypeError(`Duel official program: ${label} must remain pending until Core Equip services exist.`);
    }
    assertExactDenseArray(value.runtime.required, `${label}.runtime.required`);
    return;
  }
  if (value.kind === "beginning-phase-conditional-draw") {
    assertExactKeys(value, ["kind", "trigger", "effect", "controller", "runtime"], label);
    assertObject(value.trigger, `${label}.trigger`);
    assertExactKeys(value.trigger, ["event", "phase", "step", "scope", "timing", "enqueue"], `${label}.trigger`);
    if (value.trigger.event !== "beginning-phase" || value.trigger.phase !== "begin" || value.trigger.step !== "beginning-step" ||
        value.trigger.scope !== "controller-beginning-phase" || value.trigger.timing !== "start" || value.trigger.enqueue !== "unconditional-pending-item") {
      throw new TypeError(`Duel official program: ${label} has invalid Beginning trigger semantics.`);
    }
    assertObject(value.effect, `${label}.effect`);
    assertExactKeys(value.effect, ["kind", "amount", "recipient", "condition"], `${label}.effect`);
    if (value.effect.kind !== "draw-cards" || value.effect.amount !== 1 || value.effect.recipient !== "ability-controller") {
      throw new TypeError(`Duel official program: ${label} must preserve the conditional draw instruction.`);
    }
    assertObject(value.effect.condition, `${label}.effect.condition`);
    assertExactKeys(value.effect.condition, ["kind", "maximum", "scope", "clauseRole", "evaluatedAt", "readsPublicInformationOnly"], `${label}.effect.condition`);
    if (value.effect.condition.kind !== "hand-size-at-most" || value.effect.condition.maximum !== 1 ||
        value.effect.condition.scope !== "ability-controller-hand" || value.effect.condition.clauseRole !== "effect" ||
        value.effect.condition.evaluatedAt !== "resolution" || value.effect.condition.readsPublicInformationOnly !== true) {
      throw new TypeError(`Duel official program: ${label} must evaluate the hand condition at resolution.`);
    }
    assertObject(value.controller, `${label}.controller`);
    assertExactKeys(value.controller, ["kind", "source", "status"], `${label}.controller`);
    if (value.controller.kind !== "ability-controller" || value.controller.source !== "canonical-source-controller" || value.controller.status !== "pending") {
      throw new TypeError(`Duel official program: ${label} must require the canonical source controller.`);
    }
    assertObject(value.runtime, `${label}.runtime`);
    assertExactKeys(value.runtime, ["status", "required"], `${label}.runtime`);
    if (value.runtime.status !== "pending" || !Array.isArray(value.runtime.required) || value.runtime.required.length !== 3 ||
        value.runtime.required[0] !== "canonical-source-controller" || value.runtime.required[1] !== "beginning-phase-trigger-executor" ||
        value.runtime.required[2] !== "draw-burnout-continuation") {
      throw new TypeError(`Duel official program: ${label} must preserve pending Beginning runtime dependencies.`);
    }
    assertExactDenseArray(value.runtime.required, `${label}.runtime.required`);
    return;
  }
  if (value.kind === "passive") {
    assertExactKeys(value, ["kind", "event", "sourceScope", "modifier"], label);
    assertObject(value.modifier, `${label}.modifier`);
    if (value.event === "hide") {
      assertExactKeys(value.modifier, ["kind", "amount", "optional", "scope"], `${label}.modifier`);
      if (value.sourceScope !== "source-battlefield" || value.modifier.kind !== "additional-hide-permission" || value.modifier.amount !== 1 || value.modifier.optional !== true || value.modifier.scope !== "source-battlefield") {
        throw new TypeError(`Duel official program: invalid Bandle Tree passive in ${label}.`);
      }
      return;
    }
    if (value.event === "attacker") {
      assertExactKeys(value.modifier, ["kind", "amount"], `${label}.modifier`);
      if (value.sourceScope !== "source-unit-on-board" || value.modifier.kind !== "self-assault" ||
          typeof value.modifier.amount !== "number" || !Number.isSafeInteger(value.modifier.amount) || value.modifier.amount < 0) {
        throw new TypeError(`Duel official program: invalid Assault passive in ${label}.`);
      }
      return;
    }
    if (value.event === "defender") {
      assertExactKeys(value.modifier, ["kind", "amount"], `${label}.modifier`);
      if (value.sourceScope !== "source-unit-on-board" || value.modifier.kind !== "self-shield" ||
          typeof value.modifier.amount !== "number" || !Number.isSafeInteger(value.modifier.amount) || value.modifier.amount < 0) {
        throw new TypeError(`Duel official program: invalid Shield passive in ${label}.`);
      }
      return;
    }
    throw new TypeError(`Duel official program: unknown passive event in ${label}.`);
  }
  throw new TypeError(`Duel official program: unknown semantics kind in ${label}.`);
}

function assertAccelerateProgramSource(
  source: DuelProgramSourceFingerprint,
  semantics: DuelOptionalPlayCostV1Semantics,
): void {
  // Re-run the reviewed whole-tuple recogniser against the detached source
  // fingerprint. This keeps the official program's semantics source-bound even
  // when a caller supplies an otherwise syntactically valid forged program.
  const description = describeDuelOptionalPlayCostV1({
    id: source.cardId,
    cardType: source.cardType,
    ability: source.normalizedAbilityText,
    energy: source.energy,
    power: source.power,
    might: source.might,
    domains: source.domains,
    tags: source.tags,
    canonicalCardId: source.canonicalCardId,
    name: source.name,
    fullName: source.fullName,
    localizedName: source.localizedName,
    setCode: source.setCode,
    cardNumber: source.cardNumber,
    variant: source.variant,
  });
  if (description.status !== "known" || canonicalJson(description.semantics) !== canonicalJson(semantics)) {
    throw new TypeError("Duel official program: Accelerate semantics require the complete pure source tuple.");
  }
}

export function assertDuelOfficialProgram(value: unknown): asserts value is DuelOfficialProgram {
  assertObject(value, "program");
  assertExactKeys(value, PROGRAM_FIELDS, "program");
  if (value.kind !== DUEL_OFFICIAL_IR_KIND || value.schemaVersion !== DUEL_OFFICIAL_IR_SCHEMA_VERSION || value.ruleset !== DUEL_OFFICIAL_RULESET) {
    throw new TypeError("Duel official program: kind, schemaVersion or ruleset is unsupported.");
  }
  assertNonEmptyString(value.programId, "program.programId");
  assertNonEmptyString(value.cardId, "program.cardId");
  if (value.programId !== makeDuelOfficialProgramId(value.cardId)) throw new TypeError("Duel official program: programId does not match cardId.");
  assertObject(value.source, "program.source");
  assertExactKeys(value.source, SOURCE_FIELDS, "program.source");
  assertNonEmptyString(value.source.cardId, "program.source.cardId");
  if (value.source.cardId !== value.cardId) throw new TypeError("Duel official program: source.cardId does not match cardId.");
  assertNonEmptyString(value.source.cardType, "program.source.cardType");
  if (typeof value.source.normalizedAbilityText !== "string") throw new TypeError("Duel official program: source.normalizedAbilityText must be a string.");
  assertSafeIntegerOrNull(value.source.energy, "program.source.energy");
  assertSafeIntegerOrNull(value.source.power, "program.source.power");
  assertSafeIntegerOrNull(value.source.might, "program.source.might");
  assertStringArray(value.source.domains, "program.source.domains");
  assertStringArray(value.source.tags, "program.source.tags");
  for (const key of ["canonicalCardId", "name", "fullName", "localizedName", "setCode", "cardNumber", "variant", "dataVersion", "sourceCatalogDigest"] as const) {
    assertNonEmptyString(value.source[key], `program.source.${key}`);
  }
  assertSemantics(value.semantics, "program.semantics");
  if (value.semantics.kind === "compound-vi-self" || value.semantics.kind === "deflect") {
    if (value.source.cardType !== "Unit" || !exactWholeRosterSourceFingerprint(value.source as unknown as DuelProgramSourceFingerprint)) {
      throw new TypeError(`Duel official program: ${value.semantics.kind} requires an exact reviewed whole-roster Unit source tuple.`);
    }
    const expectedKind = value.cardId === "ogn-036-298" || value.cardId === "ven-167-166"
      ? "compound-vi-self" : "deflect";
    if (value.semantics.kind !== expectedKind) {
      throw new TypeError("Duel official program: whole-roster semantics kind does not match the exact printing source.");
    }
  }
  if (value.semantics.kind === "accelerate") {
    assertAccelerateProgramSource(value.source as unknown as DuelProgramSourceFingerprint, value.semantics);
  }
  if (value.semantics.kind === "spell-resolution") {
    const texts: Readonly<Record<string, string>> = {
      "draw-cards": "Draw 4.", "kill-unit": "Kill a unit.", "kill-units": "Kill all units.",
      "each-player-kills-unit": "Each player kills one of their units.",
      "deal-damage": "Deal 6 to each of up to two units.",
    };
    if (value.source.cardType !== "Spell" ||
        value.source.normalizedAbilityText !== (value.semantics.permission === "reaction"
          ? DUEL_PREMONITION_REACTION_TEXT : texts[value.semantics.effects[0].kind])) {
      throw new TypeError("Duel official program: Spell requires its complete source instruction.");
    }
  }
  if (value.semantics.kind === "point-damage-spell-resolution") {
    const pointSource = value.source as unknown as DuelProgramSourceFingerprint;
    if (pointSource.cardType !== "Spell" || pointSource.dataVersion !== POINT_DAMAGE_CATALOG_VERSION ||
        pointSource.sourceCatalogDigest !== POINT_DAMAGE_CATALOG_DIGEST ||
        !exactPointDamageSource(pointSource)) {
      throw new TypeError("Duel official program: point damage requires an exact reviewed Spell source tuple.");
    }
    const description = describeDuelPointDamageV1({
      id: pointSource.cardId, cardType: pointSource.cardType, ability: pointSource.normalizedAbilityText,
      energy: pointSource.energy, power: pointSource.power, might: pointSource.might,
      domains: pointSource.domains, tags: pointSource.tags, canonicalCardId: pointSource.canonicalCardId,
      name: pointSource.name, fullName: pointSource.fullName, localizedName: pointSource.localizedName,
      setCode: pointSource.setCode, cardNumber: pointSource.cardNumber, variant: pointSource.variant,
    });
    if (description.status !== "known" || description.semantics.amount !== value.semantics.effects[0].amount ||
        description.semantics.target.location !== value.semantics.effects[0].target.location) {
      throw new TypeError("Duel official program: point damage semantics do not match the complete source text.");
    }
  }
  if (value.semantics.kind === "continuous" && (value.source.cardType !== "Unit" ||
      value.source.normalizedAbilityText !== "Your token units have +1 :rb_might:.")) {
    throw new TypeError("Duel official program: token Might modifier requires its complete Unit source text.");
  }
  if (value.semantics.kind === "passive" && value.semantics.event === "attacker") {
    const amount = pureAssaultAmountFromText(value.source.normalizedAbilityText);
    if (value.source.cardType !== "Unit" || amount === null ||
        value.semantics.sourceScope !== "source-unit-on-board" ||
        value.semantics.modifier.kind !== "self-assault" ||
        value.semantics.modifier.amount !== amount) {
      throw new TypeError("Duel official program: Assault passive requires its complete pure Assault Unit source text.");
    }
  }
  if (value.semantics.kind === "passive" && value.semantics.event === "defender") {
    const shieldSource = value.source as unknown as DuelProgramSourceFingerprint;
    if (shieldSource.cardType !== "Unit" || shieldSource.dataVersion !== DUEL_SHIELD_CATALOG_DATA_VERSION ||
        shieldSource.sourceCatalogDigest !== DUEL_SHIELD_CATALOG_DIGEST || !exactShieldSourceFingerprint(shieldSource) ||
        value.semantics.sourceScope !== "source-unit-on-board" ||
        value.semantics.modifier.kind !== "self-shield" ||
        value.semantics.modifier.amount !== 1) {
      throw new TypeError("Duel official program: Shield passive requires one of the exact reviewed pure Shield Unit source tuples.");
    }
  }
  if (value.semantics.kind === "trigger" && (value.semantics.event === "unit-enter" ||
      value.semantics.event === "play-gear" || value.semantics.event === "card-play-on-opponent-turn")) {
    const expected = value.semantics.event === "unit-enter"
      ? value.semantics.effects[0].kind === "draw-cards" ? "When you play me, draw 1."
        : "When you play me, kill an enemy unit."
      : value.semantics.event === "play-gear" ? "When you play a gear, ready me."
        : "When you play a card on an opponent's turn, play a 1 :rb_might: Recruit unit token in your base.";
    if (value.source.cardType !== "Unit" || value.source.normalizedAbilityText !== expected) {
      throw new TypeError("Duel official program: Unit trigger requires its complete source predicate and instruction.");
    }
  }
  if (value.semantics.kind === "trigger" && value.semantics.event === "hold") {
    const effect = value.semantics.effects[0];
    if (value.source.cardType !== "Battlefield" ||
        (effect.kind === "draw-cards" && value.source.normalizedAbilityText !== "When you hold here, draw 1.") ||
        (effect.kind === "play-recruit-token" && (effect.destination !== "base" || value.source.normalizedAbilityText !==
          "When you hold here, play a 1 :rb_might: Recruit unit token in your base."))) {
      throw new TypeError("Duel official program: Hold requires its complete Battlefield source instruction.");
    }
  }
  if (value.semantics.kind === "basic-rune") {
    assertBasicRuneProgramSource(value.source);
    if (value.semantics.domain !== value.source.domains[0]) {
      throw new TypeError("Duel official program: Basic Rune semantics domain must match its source Rune.");
    }
  } else if (BASIC_RUNE_PRINTINGS.has(value.cardId)) {
    // A known Rune printing cannot masquerade as a no-ability or unrelated program.
    assertBasicRuneProgramSource(value.source);
    throw new TypeError("Duel official program: Basic Rune requires both CR 164.2 abilities.");
  }
  if (value.semantics.kind === "trigger" && value.semantics.sourceScope === "conquering-source-unit") {
    if (value.source.cardType !== "Unit" || value.source.normalizedAbilityText !== "When I conquer, play a Gold gear token exhausted.") {
      throw new TypeError("Duel official program: Gold conquer requires the complete Unit source ability text.");
    }
  }
  if (value.semantics.kind === "equip-activated-ability") {
    const equipSource = value.source as unknown as DuelProgramSourceFingerprint;
    if (equipSource.cardType !== "Gear" || !EQUIP_SOURCE_FINGERPRINTS.has(value.cardId) ||
        !isExactSourceFingerprint({ dataVersion: equipSource.dataVersion, sourceCatalogDigest: equipSource.sourceCatalogDigest, cards: [] }, {
          id: equipSource.cardId, cardType: equipSource.cardType, ability: equipSource.normalizedAbilityText,
          energy: equipSource.energy, power: equipSource.power, might: equipSource.might, domains: equipSource.domains,
          tags: equipSource.tags, canonicalCardId: equipSource.canonicalCardId, name: equipSource.name,
          fullName: equipSource.fullName, localizedName: equipSource.localizedName, setCode: equipSource.setCode,
          cardNumber: equipSource.cardNumber, variant: equipSource.variant,
        }, EQUIP_SOURCE_FINGERPRINTS)) {
      throw new TypeError("Duel official program: Equip requires an exact reviewed Gear source tuple.");
    }
    const description = describeDuelEquipV1({
      id: equipSource.cardId, cardType: equipSource.cardType, ability: equipSource.normalizedAbilityText,
      energy: equipSource.energy, power: equipSource.power, might: equipSource.might, domains: equipSource.domains,
      tags: equipSource.tags, canonicalCardId: equipSource.canonicalCardId, name: equipSource.name,
      fullName: equipSource.fullName, localizedName: equipSource.localizedName, setCode: equipSource.setCode,
      cardNumber: equipSource.cardNumber, variant: equipSource.variant,
    }, { dataVersion: equipSource.dataVersion, catalogDigest: equipSource.sourceCatalogDigest });
    if (description.status !== "known" || description.semantics.cost.nonResourceLiteral !== null ||
        description.semantics.costAlterations.length !== 0 || description.semantics.attachTarget !== "unknown" ||
        description.semantics.timing !== "unknown" || value.semantics.cost.literal !== description.semantics.cost.literal ||
        value.semantics.cost.energy !== description.semantics.cost.energy ||
        canonicalJson(value.semantics.cost.power) !== canonicalJson(description.semantics.cost.power)) {
      throw new TypeError("Duel official program: Equip semantics do not match the complete pure resource source text.");
    }
  }
  if (value.semantics.kind === "beginning-phase-conditional-draw") {
    const beginningSource = value.source as unknown as DuelProgramSourceFingerprint;
    if (beginningSource.cardType !== "Legend" || !BEGINNING_DRAW_SOURCE_FINGERPRINTS.has(value.cardId) ||
        !isExactSourceFingerprint({ dataVersion: beginningSource.dataVersion, sourceCatalogDigest: beginningSource.sourceCatalogDigest, cards: [] }, {
          id: beginningSource.cardId, cardType: beginningSource.cardType, ability: beginningSource.normalizedAbilityText,
          energy: beginningSource.energy, power: beginningSource.power, might: beginningSource.might, domains: beginningSource.domains,
          tags: beginningSource.tags, canonicalCardId: beginningSource.canonicalCardId, name: beginningSource.name,
          fullName: beginningSource.fullName, localizedName: beginningSource.localizedName, setCode: beginningSource.setCode,
          cardNumber: beginningSource.cardNumber, variant: beginningSource.variant,
        }, BEGINNING_DRAW_SOURCE_FINGERPRINTS)) {
      throw new TypeError("Duel official program: Beginning draw requires an exact reviewed Legend source tuple.");
    }
    const description = describeDuelBeginningDrawV1({
      id: beginningSource.cardId, cardType: beginningSource.cardType, ability: beginningSource.normalizedAbilityText,
      energy: beginningSource.energy, power: beginningSource.power, might: beginningSource.might, domains: beginningSource.domains,
      tags: beginningSource.tags, canonicalCardId: beginningSource.canonicalCardId, name: beginningSource.name,
      fullName: beginningSource.fullName, localizedName: beginningSource.localizedName, setCode: beginningSource.setCode,
      cardNumber: beginningSource.cardNumber, variant: beginningSource.variant,
    }, { dataVersion: beginningSource.dataVersion, sourceCatalogDigest: beginningSource.sourceCatalogDigest });
    if (description.status !== "known" || value.semantics.effect.condition.evaluatedAt !== "resolution") {
      throw new TypeError("Duel official program: Beginning draw semantics do not match the complete source text.");
    }
  }
}

export function validateDuelOfficialProgram(input: unknown): DuelValidationResult {
  try {
    const snapshot = snapshotData(input, "program");
    assertDuelOfficialProgram(snapshot);
    return { ok: true, value: cloneProgram(snapshot), issues: [] };
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: "$", code: "invalid-duel-official-program", message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

export function parseDuelOfficialProgram(input: unknown): DuelOfficialProgram {
  const result = validateDuelOfficialProgram(input);
  if (!result.ok) throw new DuelOfficialProgramValidationError(result.issues);
  return result.value;
}

/** Canonical exact raw codec. Unknown fields and noncanonical raw JSON are rejected on decode. */
export function encodeDuelOfficialProgramRaw(input: unknown): string {
  return canonicalJson(parseDuelOfficialProgram(input));
}

export function decodeDuelOfficialProgramRaw(raw: string): DuelOfficialProgram {
  if (typeof raw !== "string") throw new TypeError("Duel official program raw codec: raw value must be a string.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("Duel official program raw codec: raw value is not JSON.");
  }
  const canonical = encodeDuelOfficialProgramRaw(parsed);
  if (canonical !== raw) throw new TypeError("Duel official program raw codec: raw JSON is not canonical.");
  return parseDuelOfficialProgram(parsed);
}

export const serializeDuelOfficialProgram = encodeDuelOfficialProgramRaw;
export const deserializeDuelOfficialProgram = decodeDuelOfficialProgramRaw;

function assertDuelOfficialProgramReference(value: unknown): asserts value is DuelOfficialProgramReference {
  assertObject(value, "program reference");
  assertExactKeys(value, REFERENCE_FIELDS, "program reference");
  if (value.kind !== DUEL_OFFICIAL_REFERENCE_KIND || value.schemaVersion !== DUEL_OFFICIAL_REFERENCE_SCHEMA_VERSION) {
    throw new TypeError("Duel official program: unsupported reference kind or schemaVersion.");
  }
  for (const key of ["programId", "cardId", "dataVersion", "sourceCatalogDigest"] as const) {
    assertNonEmptyString(value[key], `program reference.${key}`);
  }
  if (value.programId !== makeDuelOfficialProgramId(value.cardId as string)) {
    throw new TypeError("Duel official program: reference programId does not match cardId.");
  }
}

export function createDuelProgramReference(program: DuelOfficialProgram): DuelOfficialProgramReference {
  assertDuelOfficialProgram(program);
  return freezeDeep({
    kind: DUEL_OFFICIAL_REFERENCE_KIND,
    schemaVersion: DUEL_OFFICIAL_REFERENCE_SCHEMA_VERSION,
    programId: program.programId,
    cardId: program.cardId,
    dataVersion: program.source.dataVersion,
    sourceCatalogDigest: program.source.sourceCatalogDigest,
  });
}

export function resolveDuelProgramReference(
  registry: DuelOfficialProgramRegistry,
  reference: DuelOfficialProgramReference,
): DuelOfficialProgram {
  const binding = bindingForReference(registry, reference);
  if (binding.program === null) throw new TypeError("Duel official program: reference resolved without a program.");
  return cloneProgram(binding.program);
}

export function encodeDuelProgramReferenceRaw(reference: DuelOfficialProgramReference): string {
  assertDuelOfficialProgramReference(reference);
  return canonicalJson(reference);
}

export function decodeDuelProgramReferenceRaw(raw: string): DuelOfficialProgramReference {
  if (typeof raw !== "string") throw new TypeError("Duel program reference raw codec: raw value must be a string.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("Duel program reference raw codec: raw value is not JSON.");
  }
  assertDuelOfficialProgramReference(parsed);
  if (canonicalJson(parsed) !== raw) throw new TypeError("Duel program reference raw codec: raw JSON is not canonical.");
  return createDuelProgramReferenceFromUnknown(parsed);
}

function createDuelProgramReferenceFromUnknown(value: unknown): DuelOfficialProgramReference {
  assertDuelOfficialProgramReference(value);
  return freezeDeep({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    programId: value.programId,
    cardId: value.cardId,
    dataVersion: value.dataVersion,
    sourceCatalogDigest: value.sourceCatalogDigest,
  });
}

export const serializeDuelProgramReference = encodeDuelProgramReferenceRaw;
export const deserializeDuelProgramReference = decodeDuelProgramReferenceRaw;

/** A convenience binding for callers that already have a trusted source card id. */
export function resolveDuelOfficialProgram(
  registry: DuelOfficialProgramRegistry,
  reference: DuelOfficialProgramReference,
): DuelOfficialProgram {
  return resolveDuelProgramReference(registry, reference);
}
