/**
 * Server owned composition for the narrow whole-pure Accelerate Unit slice.
 * The descriptor is DATA only; this module binds it to the actual loaded
 * catalog, physical match source and an explicit choice receipt before it can
 * produce a Core cost authority.
 */
import { createHash } from "node:crypto";
import {
  createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2,
  fingerprintDuelCostModifierV2, type DuelCostResolverAuthorityV2,
  type DuelCostVerifiedSourcesV2,
  type DuelCostModifierV2,
  type DuelOptionalUnitCostRequestV2, type DuelOptionalUnitPlayServicesV2,
  type DuelOptionalUnitProgramBindingV2, type DuelOptionalUnitProgramRequestV2,
  type DuelUnitCostBindingV2,
  type DuelUnitEntryFactsV2, type DuelUnitEntryRequestV2,
  type DuelUnitEntryServiceV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
} from "@riftbound/engine-core/duel";
import type { DuelSourcePrintingCard } from "@riftbound/card-dsl/duel";
import { describeDuelOptionalPlayCostV1 } from "@riftbound/card-dsl/duel";
import type { DuelOptionalPlayReceiptDataV1, DuelOptionalPlayReceiptV1,
  DuelOptionalPlaySourceV1 } from "@riftbound/engine-core/duel";
import { bindDuelPrintedCost } from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import { getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import type { DuelNativeOperationJournalV2 } from "./operation-journal-v2.js";

type ResolvedDuelProgram = ReturnType<ReturnType<typeof getCardProgramRegistryForRuntime>["getProgram"]>;

export interface P4OptionalUnitServicesOptions {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  readonly getOperationHead: () => import("@riftbound/engine-core/duel").DuelCanonicalPlayingStateV2;
  /** Complete trusted entry census. Omitting this keeps optional play blocked. */
  readonly entry?: DuelUnitEntryServiceV2;
  /** Same owner journal used by the authoritative command head. */
  readonly currentJournal: () => DuelNativeOperationJournalV2;
  readonly inspectChoice: (receipt: DuelOptionalPlayReceiptV1) => DuelOptionalPlayReceiptDataV1;
}

export interface OptionalUnitCostSourceV1 {
  readonly sourceUid: string;
  readonly sourceEpoch: number;
  readonly choice: "mandatory" | "chosen-optional" | "declined-optional" | "not-applicable";
  readonly modifierIds: readonly string[];
}

export interface P4OptionalUnitServices {
  readonly readSource: (match: import("@riftbound/engine-core/duel").DuelCanonicalPlayingStateV2,
    actor: string, uid: string) => DuelOptionalPlaySourceV1;
  readonly inspectChoice: (receipt: DuelOptionalPlayReceiptV1) => DuelOptionalPlayReceiptDataV1;
  readonly program: (request: Readonly<DuelOptionalUnitProgramRequestV2>) => DuelOptionalUnitProgramBindingV2;
  readonly cost: (request: Readonly<DuelOptionalUnitCostRequestV2>) => DuelCostResolverAuthorityV2;
  readonly costBinding: (request: Readonly<DuelUnitCostBindingV2>) =>
    DuelUnitCostBindingV2 & { readonly status: "complete" | "unknown" };
  readonly entry: DuelUnitEntryServiceV2;
  readonly unitServices: DuelOptionalUnitPlayServicesV2;
}

function fail(message: string): never { throw new TypeError(`P4 optional Unit services: ${message}`); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function safe(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function canonical(value: unknown): string { return JSON.stringify(value); }

/**
 * Audit one complete official IR for this request's CardPlay-COST boundary.
 * This is deliberately separate from `sourceProgramPhaseScope("main")`: a
 * source may have an entry replacement, trigger, passive, or runtime subevent
 * while still having no modifier for the plain Unit card-play cost. Every
 * current semantic kind is reviewed by its complete shape and concrete opcode;
 * a future kind or field therefore remains blocked instead of inheriting a
 * permissive kind-only default.
 */
function hasNoCardPlayCostApplicability(program: ResolvedDuelProgram): boolean {
  if (!program) return false;
  const semantics = program.semantics;
  switch (semantics.kind) {
    case "static": {
      const abilities = semantics.abilities.map(ability => {
        if (ability.kind === "ganking") {
          return { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" };
        }
        if (ability.kind === "enter-ready") {
          return { kind: "enter-ready", subject: "self", scope: "unit-enter", mode: "replacement" };
        }
        return null;
      });
      return abilities.every(Boolean) && canonical(semantics) === canonical({ kind: "static", abilities });
    }
    case "basic-rune": {
      const domain = semantics.domain;
      const expected = {
        kind: "basic-rune", sourceRule: "CR-v1.4:164.2", domain,
        abilities: [
          { kind: "basic-rune-energy", sourceRule: "CR-v1.4:164.2.a", event: "activate",
            sourceScope: "source-basic-rune", permission: "reaction", costs: [{ kind: "exhaust-source" }],
            effects: [{ kind: "add-energy", amount: 1, recipient: "ability-controller",
              destination: "rune-pool", expiration: "rune-pool-reset" }] },
          { kind: "basic-rune-power", sourceRule: "CR-v1.4:164.2.b/164.2.b.1", event: "activate",
            sourceScope: "source-basic-rune", permission: "reaction", costs: [{ kind: "recycle-source",
              destination: "source-owner-rune-deck", readiness: "ready-or-exhausted" }],
            effects: [{ kind: "add-domain-power", amount: 1, domain, domainSource: "source-rune-domain",
              recipient: "ability-controller", destination: "rune-pool", expiration: "rune-pool-reset" }] },
        ],
      };
      return canonical(semantics) === canonical(expected);
    }
    case "no-ability": {
      const playability = semantics.playability;
      const expected = playability.kind === "printed-unit"
        ? { kind: "no-ability", playability: { kind: "printed-unit", fromHand: true,
            energyCost: playability.energyCost, tokenOnly: false } }
        : playability.kind === "recruit-token"
          ? { kind: "no-ability", playability: { kind: "recruit-token", fromHand: false,
              energyCost: null, tokenOnly: true } }
          : null;
      return expected !== null && canonical(semantics) === canonical(expected);
    }
    case "passive": {
      const expected = semantics.event === "attacker"
        ? { kind: "passive", event: "attacker", sourceScope: "source-unit-on-board",
            modifier: { kind: "self-assault", amount: semantics.modifier.kind === "self-assault"
              ? semantics.modifier.amount : -1 } }
        : semantics.event === "hide"
          ? { kind: "passive", event: "hide", sourceScope: "source-battlefield",
              modifier: { kind: "additional-hide-permission", amount: 1, optional: true,
                scope: "source-battlefield" } }
          : null;
      return expected !== null && canonical(semantics) === canonical(expected);
    }
    case "continuous":
      return canonical(semantics) === canonical({ kind: "continuous", sourceScope: "source-unit-on-board",
        modifier: { kind: "token-unit-might", amount: 1, controller: "ability-controller", scope: "board" } });
    case "activated":
      return canonical(semantics) === canonical({ kind: "activated", event: "activate", sourceScope: "ability-source",
        costs: [{ kind: "energy", amount: 1, payer: "ability-controller" }, { kind: "exhaust-source" }],
        effects: [{ kind: "play-recruit-token", token: { kind: "unit-token", cardType: "Unit", domains: [],
          domainless: true, tags: ["Recruit"], energy: null, power: null, might: 1,
          physicalPrintingCardId: null }, controller: "effect-controller", owner: "effect-controller",
          destination: "executor-defined", resolution: "deferred-token-play" }] });
    case "compound-vi-self":
      // The complete Vi IR has only a standard-move permission and an explicit
      // source-unit activation. Neither instruction applies to a plain Unit
      // card play from Hand, and both fields are checked exactly.
      return canonical(semantics) === canonical({
        kind: "compound-vi-self", sourceScope: "source-unit-on-board",
        ganking: { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" },
        activation: { event: "activate", sourceScope: "source-unit-on-board",
          costs: [{ kind: "recycle-from-trash", amount: 1, selector: "one-card",
            zone: "controller-trash", payer: "ability-controller" }],
          effects: [{ kind: "add-might", amount: 1, recipient: "ability-source-unit",
            duration: "this-turn" }] },
      });
    case "deflect":
      // CR 809.1.c/d applies only when a Spell or Ability chooses this source
      // Unit. A UnitCardPlay does not make that choice and therefore has no
      // Deflect cost contribution. Keep the entire IR shape exact.
      return canonical(semantics) === canonical({
        kind: "deflect", sourceScope: "source-unit-on-board", event: "opponent-choice",
        modifier: { kind: "additional-opponent-power-cost", amount: 1,
          powerDomain: "wildcard", payer: "opponent", timing: "additional-play-cost",
          per: "each-choice-of-source", optional: false, automaticPayment: false,
          choice: { source: "spell-or-ability", target: "source-unit-on-board" } },
      });
    case "trigger": {
      // The complete trigger object is checked against each reviewed opcode. No
      // trigger has a CardPlay-COST modifier, but unsupported effects remain blocked.
      if (semantics.event === "unit-enter") {
        const effect = semantics.effects[0];
        if (effect.kind !== "draw-cards" && !(effect.kind === "kill-unit" && effect.controller === "enemy")) return false;
        return canonical(semantics) === canonical({ kind: "trigger", event: "unit-enter",
          sourceScope: "played-source-unit",
          eventPredicate: { kind: "source-play-completed", source: "ability-source", countered: false },
          condition: null, optional: false, costs: [], effects: [effect.kind === "draw-cards"
            ? { kind: "draw-cards", amount: 1, recipient: "effect-controller" }
            : { kind: "kill-unit", controller: "enemy", selection: "target" }] });
      }
      if (semantics.event === "play-gear") {
        return canonical(semantics) === canonical({ kind: "trigger", event: "play-gear",
          sourceScope: "controller-plays-gear",
          eventPredicate: { kind: "controller-play-completed", actor: "source-controller-at-event",
            cardType: "Gear", turn: "any", countered: false }, condition: null, optional: false,
          costs: [], effects: [{ kind: "ready-source" }] });
      }
      if (semantics.event === "card-play-on-opponent-turn") {
        return canonical(semantics) === canonical({ kind: "trigger", event: "card-play-on-opponent-turn",
          sourceScope: "controller-plays-card-on-opponent-turn",
          eventPredicate: { kind: "controller-play-completed", actor: "source-controller-at-event",
            cardType: "any", turn: "opponent", countered: false }, condition: null, optional: false,
          costs: [], effects: [{ kind: "play-recruit-token", token: { kind: "unit-token", cardType: "Unit",
            domains: [], domainless: true, tags: ["Recruit"], energy: null, power: null, might: 1,
            physicalPrintingCardId: null }, controller: "effect-controller", owner: "effect-controller",
            destination: "base", resolution: "deferred-token-play" }] });
      }
      if (semantics.event === "hold") {
        const effect = semantics.effects[0];
        const expectedEffect = effect.kind === "draw-cards"
          ? { kind: "draw-cards", amount: 1, recipient: "effect-controller" }
          : effect.kind === "play-recruit-token"
            ? { kind: "play-recruit-token", token: { kind: "unit-token", cardType: "Unit", domains: [],
                domainless: true, tags: ["Recruit"], energy: null, power: null, might: 1,
                physicalPrintingCardId: null }, controller: "effect-controller", owner: "effect-controller",
                destination: "base", resolution: "deferred-token-play" }
            : null;
        return expectedEffect !== null && canonical(semantics) === canonical({ kind: "trigger", event: "hold",
          sourceScope: "battlefield-controller", condition: null, optional: false, costs: [], effects: [expectedEffect] });
      }
      if (semantics.event === "conquer") {
        const sourceUnit = semantics.sourceScope === "conquering-source-unit";
        const expectedEffect = sourceUnit
          ? { kind: "play-gold-gear-token", token: { kind: "gear-token", tokenName: "Gold", cardType: "Gear",
              domains: [], domainless: true, tags: [], energy: null, power: null, might: null,
              physicalPrintingCardId: null, defaultEntryReady: true,
              intrinsicAbility: { kind: "duel-intrinsic-token-ability-reference", schemaVersion: 1,
                ruleset: "riftbound-duel-official-v1", intrinsicId: "riftbound-duel-official-v1:intrinsic-token:gold-gear" } },
            controller: "effect-controller", owner: "effect-controller", destination: "effect-controller-base",
            entryExhausted: true, resolution: "deferred-token-play" }
          : { kind: "ready-unit", target: { kind: "unit", controller: "any", scope: "legal-unit" } };
        const expected = sourceUnit
          ? { kind: "trigger", event: "conquer", sourceScope: "conquering-source-unit",
              eventPredicate: { kind: "source-unit-present-at-conquered-battlefield",
              participant: "ability-source-unit", battlefield: "conquered-battlefield",
              pointOutcome: "including-negated-or-replaced" }, condition: null, optional: false, costs: [], effects: [expectedEffect] }
          : { kind: "trigger", event: "conquer", sourceScope: "ability-source",
              condition: { kind: "assigned-excess-damage-at-least", amount: 3 },
              optional: true, costs: [{ kind: "exhaust-source" }], effects: [expectedEffect] };
        return canonical(semantics) === canonical(expected);
      }
      return false;
    }
    case "spell-resolution": {
      const effect = semantics.effects[0];
      const supported = effect.kind === "draw-cards" && effect.recipient === "effect-controller" &&
          ((effect.amount === 4 && semantics.permission === undefined) ||
            (effect.amount === 3 && semantics.permission === "reaction"))
        || effect.kind === "kill-unit" && effect.controller === "any" && effect.selection === "target"
        || effect.kind === "kill-units" && effect.controller === "any" && effect.selection === "all"
        || effect.kind === "each-player-kills-unit" && effect.selection === "each-player-choice"
        || effect.kind === "deal-damage" && effect.amount === 6 && effect.distribution === "each" &&
          effect.targets.kind === "unit" && effect.targets.controller === "any" &&
          effect.targets.minSelections === 0 && effect.targets.maxSelections === 2;
      if (!supported || (semantics.permission !== undefined && semantics.permission !== "reaction")) return false;
      return canonical(semantics) === canonical({ kind: "spell-resolution",
        ...(semantics.permission === undefined ? {} : { permission: "reaction" }), effects: [effect] });
    }
    case "accelerate": {
      const domain = semantics.additionalCost.power[0]?.allowedDomains[0];
      if (semantics.choiceTiming !== "card-play-choices" || semantics.optional !== true ||
          semantics.additionalCost.energy !== 1 || semantics.additionalCost.power.length !== 1 ||
          semantics.additionalCost.power[0]?.amount !== 1 || typeof domain !== "string" ||
          semantics.paidEffect.kind !== "enter-ready-replacement" || semantics.paidEffect.timing !== "unit-entry") return false;
      return canonical(semantics) === canonical({ kind: "accelerate", choiceTiming: "card-play-choices", optional: true,
        additionalCost: { energy: 1, power: [{ allowedDomains: [domain], amount: 1 }] },
        paidEffect: { kind: "enter-ready-replacement", timing: "unit-entry" } });
    }
    default:
      return false;
  }
}
function parseTransaction(raw: string, head: import("@riftbound/engine-core/duel").DuelCanonicalPlayingStateV2) {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail("invalid optional Unit transaction"); }
  // V3 keeps the original decision command while Rune funding advances the
  // canonical head. Cost resolution still happens once, at the issue head.
  if (Array.isArray(value) && value[0] === "optional-unit-v3") {
    if (value.length !== 8 || value[1] !== head.matchId || value[2] !== head.stateVersion ||
        !text(value[3]) || !text(value[4]) || !text(value[5]) || !safe(value[6]) ||
        (value[7] !== "pay" && value[7] !== "decline")) fail("stale optional Unit V3 transaction");
    return { actor: value[3], commandId: value[4], uid: value[5], epoch: value[6],
      choiceCommandId: value[4], choice: value[7] as "pay" | "decline" };
  }
  if (!Array.isArray(value) || value.length !== 8 || value[0] !== head.matchId ||
      value[1] !== head.stateVersion || !text(value[2]) || !text(value[3]) ||
      !text(value[4]) || !safe(value[5]) || !text(value[6]) ||
      (value[7] !== "pay" && value[7] !== "decline")) fail("stale optional Unit transaction");
  return { actor: value[2], commandId: value[3], uid: value[4], epoch: value[5],
    choiceCommandId: value[6], choice: value[7] as "pay" | "decline" };
}
function sourceCard(catalog: CardCatalogRuntime, id: string): DuelSourcePrintingCard {
  const card = catalog.publicCatalog.cards.find(item => item.id === id);
  if (!card) fail("unknown catalog printing");
  if (!text(card.localizedName)) fail("catalog printing lacks complete source tuple");
  return { id: card.id, cardType: card.cardType, ability: card.ability, energy: card.energy,
    power: card.power, might: card.might, domains: [...card.domains], tags: [...card.tags],
    canonicalCardId: card.canonicalCardId, name: card.name, fullName: card.fullName,
    localizedName: card.localizedName, setCode: card.setCode,
    cardNumber: card.cardNumber, variant: card.variant };
}

function baseFacts(request: DuelUnitEntryRequestV2, programId: string): DuelUnitEntryFactsV2 {
  return Object.freeze({ matchId: request.matchId, stateVersion: request.stateVersion,
    eventSeq: request.eventSeq, actor: request.actor, uid: request.uid, cardId: request.cardId,
    sourceEpoch: request.sourceEpoch, baseLocationId: request.baseLocationId, programId,
    sourceCensus: "unknown" as const,
    sources: [], scopes: { play: "unknown", replacement: "unknown", static: "unknown",
      trigger: "unknown", pendingTasks: "unknown", chain: "unknown" } as const });
}

export function createDuelOptionalUnitProgramReader(options: Pick<P4OptionalUnitServicesOptions, "catalog" | "programs">) {
  const registry = getCardProgramRegistryForRuntime(options.programs);
  const cards = new Map(options.catalog.publicCatalog.cards.map(card => [card.id, card]));
  const stamp = options.catalog.publicCatalog;
  if (options.programs.catalogStamp.dataVersion !== stamp.dataVersion ||
      options.programs.catalogStamp.digest !== stamp.digest)
    fail("program authority and catalog stamp differ");
  const readSource = (match: import("@riftbound/engine-core/duel").DuelCanonicalPlayingStateV2,
      actor: string, uid: string): DuelOptionalPlaySourceV1 => {
      if (match.dataVersion !== stamp.dataVersion || match.catalogDigest !== stamp.digest)
        fail("catalog stamp differs from match");
      const physical = match.physicalCardsByUID[uid];
      const player = match.players.find(item => item.playerId === actor);
      const card = player?.hand.find(item => item.uid === uid);
      if (!physical || !card || physical.ownerPlayerId !== actor || physical.cardId !== card.cardId ||
          physical.zoneEpoch < 0) fail("optional Unit source is not current actor Hand");
      const printing = cards.has(card.cardId) ? sourceCard(options.catalog, card.cardId) : undefined;
      if (!printing) fail("optional Unit printing absent from catalog");
      const description = describeDuelOptionalPlayCostV1(printing);
      if (description.status !== "known") fail("printing is not whole-pure Accelerate");
      const reference = options.programs.resolvedProgramReference(card.cardId);
      const fingerprint = digest({ dataVersion: stamp.dataVersion, digest: stamp.digest,
        cardId: card.cardId, description, programReference: reference?.encodedReference ?? null });
      return { matchId: match.matchId, actor, uid, cardId: card.cardId,
        sourceEpoch: physical.zoneEpoch, sourceProgramFingerprint: fingerprint };
    };
  const describe = (request: Readonly<DuelOptionalUnitProgramRequestV2>): DuelOptionalUnitProgramBindingV2 => {
      const source = readSource(request.match, request.actor, request.uid);
      if (source.matchId !== request.matchId || source.cardId !== request.cardId ||
          source.sourceEpoch !== request.sourceEpoch) fail("optional Unit source binding differs");
      const card = sourceCard(options.catalog, request.cardId);
      const description = describeDuelOptionalPlayCostV1(card);
      if (description.status !== "known") fail("optional Unit descriptor is unknown");
      if (request.dataVersion !== stamp.dataVersion || request.catalogDigest !== stamp.digest)
        fail("optional Unit descriptor stamp differs");
      return Object.freeze({ matchId: request.matchId, dataVersion: request.dataVersion,
        catalogDigest: request.catalogDigest, actor: request.actor, uid: request.uid,
        cardId: request.cardId, sourceEpoch: request.sourceEpoch,
        programFingerprint: source.sourceProgramFingerprint, description });
    };
  return Object.freeze({ readSource, describe, registry });
}

export function createP4OptionalUnitServices(options: P4OptionalUnitServicesOptions): P4OptionalUnitServices {
  const reader = createDuelOptionalUnitProgramReader(options);
  const entry = options.entry ?? ((request: DuelUnitEntryRequestV2) => baseFacts(request, request.programId));
  const readSource = reader.readSource;
  const program = reader.describe;
  const inspectChoice = options.inspectChoice;
  if (typeof inspectChoice !== "function") fail("choice receipt authority is required");
  const snapshotFor = (request: Readonly<DuelOptionalUnitCostRequestV2>) => {
    const head = options.getOperationHead();
    const tx = parseTransaction(request.transactionId, head);
    if (tx.actor !== request.actor || tx.uid !== request.uid || tx.epoch !== request.sourceEpoch ||
        tx.choice !== request.choice || request.receipt.commandId !== tx.choiceCommandId)
      fail("optional Unit choice transaction mismatch");
    const card = sourceCard(options.catalog, request.cardId);
    const description = describeDuelOptionalPlayCostV1(card);
    if (description.status !== "known" || digest(description) !== digest(request.description) ||
        request.receipt.matchId !== head.matchId || request.receipt.actor !== tx.actor ||
        request.receipt.uid !== tx.uid || request.receipt.cardId !== request.cardId ||
        request.receipt.sourceEpoch !== tx.epoch || request.receipt.stateVersion !== head.stateVersion ||
        request.receipt.decision !== tx.choice) fail("optional Unit receipt/source mismatch");
    const printed = bindDuelPrintedCost(card);
    if (printed.kind !== "numeric") fail("optional Unit has no numeric printed base cost");
    const census = options.currentJournal().readCostCensus();
    if (!census || census.matchId !== head.matchId || census.stateVersion !== head.stateVersion ||
        census.eventSeq !== head.eventSeq || census.unresolvedNativeHistory || census.phaseClosed !== false ||
        census.sources.length === 0) fail("complete native cost census unavailable");
    const physical = head.physicalCardsByUID[tx.uid];
    const subject = census.sources.find(source => source.carrier === "object" && source.uid === tx.uid &&
      source.sourceEpoch === tx.epoch && source.cardId === request.cardId &&
      source.ownerPlayerId === tx.actor && source.zone.kind === "hand" &&
      source.zone.zonePlayerId === tx.actor);
    if (!subject || !physical || physical.cardId !== request.cardId ||
        physical.ownerPlayerId !== tx.actor || physical.zoneEpoch !== tx.epoch)
      fail("optional Unit is not the current Hand source");
    const sourceUid = request.uid;
    const modifierId = `accelerate:${request.uid}`;
    const seen = new Set<string>();
    const candidates: OptionalUnitCostSourceV1[] = [];
    const actual = enumerateDuelPhaseSourceClosureCandidatesV2(head);
    const actualByUID = new Map(actual.map(source => [source.uid, source]));
    const censusObjects = census.sources.filter(source => source.carrier === "object");
    if (actualByUID.size !== actual.length || censusObjects.length !== actual.length ||
        actual.some(source => !censusObjects.some(bound => bound.uid === source.uid &&
          bound.sourceEpoch === source.zoneEpoch && bound.cardId === source.cardId &&
          bound.ownerPlayerId === source.ownerPlayerId &&
          bound.controllerPlayerId === source.controllerPlayerId &&
          JSON.stringify(bound.zone) === JSON.stringify(source.zone))))
      fail("native cost census differs from actual Core candidates");
    for (const source of census.sources) {
      if (!text(source.uid) || !safe(source.sourceEpoch) || !safe(source.bindingRevision))
        fail("unbound native cost source");
      const key = JSON.stringify([source.carrier, source.uid, source.sourceEpoch,
        source.ledger ?? null, source.effectId ?? null]);
      if (seen.has(key)) fail("duplicate native cost source");
      seen.add(key);
      if (source === subject) {
        const subjectReference = options.programs.resolvedProgramReference(request.cardId);
        // The archived default-65 authority intentionally has no Accelerate
        // references. Its already-reviewed descriptor path may still bind the
        // requested subject when Core/P6 supplies a null reference; an opt-in
        // factory67 subject must carry its exact encoded reference.
        if (subjectReference
          ? source.programReference !== subjectReference.encodedReference
          : source.programReference !== null)
          fail("unknown source program in complete cost census");
        candidates.push({ sourceUid, sourceEpoch: tx.epoch,
          choice: request.choice === "pay" ? "chosen-optional" : "declined-optional",
          modifierIds: request.choice === "pay" ? [modifierId] : [] });
        continue;
      }
      if (source.carrier === "object") {
        const live = actualByUID.get(source.uid);
        if (!live || live.zoneEpoch !== source.sourceEpoch || live.cardId !== source.cardId ||
            live.ownerPlayerId !== source.ownerPlayerId ||
            live.controllerPlayerId !== source.controllerPlayerId ||
            JSON.stringify(live.zone) !== JSON.stringify(source.zone))
          fail("unbound native cost object source");
      }
      if (source.carrier === "runtime-effect" && source.status !== "resolved" ||
          source.carrier === "source-work" && source.status !== "resolved")
        fail("unresolved native cost work");
      if (source.cardId !== null) {
        const reference = options.programs.resolvedProgramReference(source.cardId);
        const program = reader.registry.getProgram(source.cardId);
        if (!reference || !program) {
          const other = describeDuelOptionalPlayCostV1(sourceCard(options.catalog, source.cardId));
          if (other.status !== "known" || source.cardId !== request.cardId ||
              source.programReference !== null ||
              source.carrier !== "object" && source.carrier !== "pre-exit")
            fail("unknown source program in complete cost census");
        } else if (reference.encodedReference !== source.programReference ||
            program.source.dataVersion !== head.dataVersion ||
            program.source.sourceCatalogDigest !== head.catalogDigest)
          fail("unknown source program in complete cost census");
        else {
          if (!hasNoCardPlayCostApplicability(program))
            fail("active or unresolved source program in complete cost census");
        }
      } else {
        let token: unknown;
        try { token = JSON.parse(source.programReference!); } catch { fail("unknown token source"); }
        if (!token || typeof token !== "object" || !("kind" in token) ||
            token.kind !== "duel-intrinsic-token-ability-reference" &&
              token.kind !== "recruit-birth-reference") fail("unknown token source");
      }
      if (source.carrier === "runtime-effect" && (!text(source.sourceUID) || !text(source.effectId) ||
          !census.sources.some(bound => bound.uid === source.sourceUID &&
            bound.sourceEpoch === source.sourceEpoch && bound.cardId === source.cardId &&
            bound.programReference === source.programReference &&
            (bound.carrier === "object" || bound.carrier === "pre-exit"))))
        fail("unbound runtime cost source");
      if (source.carrier !== "source-work") candidates.push({ sourceUid: source.uid,
        sourceEpoch: source.sourceEpoch!, choice: "not-applicable", modifierIds: [] });
    }
    const own = candidates.find(candidate => candidate.sourceUid === sourceUid);
    if (!own) fail("optional Unit cost census is incomplete");
    const expectedChoice = request.choice === "pay" ? "chosen-optional" : "declined-optional";
    if (own.choice !== expectedChoice || (request.choice === "pay" && own.modifierIds.length !== 1) ||
        (request.choice === "decline" && own.modifierIds.length !== 0)) fail("optional Unit census choice mismatch");
    const modifier: DuelCostModifierV2 | undefined = request.choice === "pay" ? {
      id: modifierId, sourceProofId: `proof:${modifierId}`, stage: "additional",
      target: { kind: "new-component" }, operation: "add", choice: "chosen-optional",
      cost: { energy: 1, power: [{ allowedDomains: [...request.description.semantics.additionalCost.power[0]!.allowedDomains], amount: 1 }] },
    } : undefined;
    if (options.getOperationHead() !== head ||
        options.currentJournal().readCostCensus()?.journalRevision !== census.journalRevision)
      fail("native cost census changed during read");
    const verified: DuelCostVerifiedSourcesV2 = { registryRevision: `${head.catalogDigest}:${census.journalRevision}:${census.candidateSetRevision}`,
      catalogRevision: `${head.dataVersion}:${head.catalogDigest}`, nonResourceCosts: "none",
      base: { cost: printed.cost, sourceUid: request.uid, sourceEpoch: request.sourceEpoch },
      candidates: candidates.map(candidate => ({ sourceUid: candidate.sourceUid,
        sourceEpoch: candidate.sourceEpoch, choice: candidate.choice, modifierIds: candidate.modifierIds })),
      orderedModifiers: modifier ? [modifier] : [] };
    const coverage = fingerprintDuelCostCoverageV2(verified);
    return { head, tx, census, verified, coverage, modifier, printed, sourceUid };
  };
  const cost = (request: Readonly<DuelOptionalUnitCostRequestV2>): DuelCostResolverAuthorityV2 => {
    const { verified, coverage, modifier, printed, sourceUid, tx, census, head } = snapshotFor(request);
    const service = () => {
      if (options.getOperationHead() !== head ||
          options.currentJournal().readCostCensus()?.journalRevision !== census.journalRevision)
        fail("native cost census changed before decision");
      const baseProofId = `optional-base:${request.transactionId}:${census.journalRevision}`;
      const coverageProofId = `optional-coverage:${request.transactionId}:${census.journalRevision}`;
      const proofs = modifier ? [{ proofId: modifier.sourceProofId, modifierId: modifier.id,
        request: { transactionId: request.transactionId, subjectId: request.cardId, kind: "card-play" as const },
        target: modifier.target, status: "complete" as const, applicability: "applies" as const,
        sourceUid, sourceEpoch: request.sourceEpoch, registryRevision: verified.registryRevision,
        catalogRevision: verified.catalogRevision,
        modifierFingerprint: fingerprintDuelCostModifierV2({ transactionId: request.transactionId,
          subjectId: request.cardId, kind: "card-play" }, modifier),
        candidateSourcesFingerprint: coverage.candidateSourcesFingerprint,
        resolvedChoicesFingerprint: coverage.resolvedChoicesFingerprint }] : [];
      return { request: { transactionId: request.transactionId, subjectId: request.cardId, kind: "card-play" as const },
        base: { cost: printed.cost, proofId: baseProofId, status: "complete" as const,
          request: { transactionId: request.transactionId, subjectId: request.cardId, kind: "card-play" as const },
          sourceUid: request.uid, sourceEpoch: request.sourceEpoch,
          registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision },
        coverage: { proofId: coverageProofId, status: "complete" as const,
          request: { transactionId: request.transactionId, subjectId: request.cardId, kind: "card-play" as const },
          allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: "none" as const,
          registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision, ...coverage },
        proofs, modifiers: modifier ? [modifier] : [] };
    };
    return createDuelCostResolverAuthorityV2(service, () => snapshotFor(request).verified);
  };
  const costBinding = (request: Readonly<DuelUnitCostBindingV2>) => {
    try {
      const head = options.getOperationHead();
      const tx = parseTransaction(request.transactionId, head);
      const census = options.currentJournal().readCostCensus();
      const complete = census && census.matchId === head.matchId && census.stateVersion === head.stateVersion &&
        census.eventSeq === head.eventSeq && !census.unresolvedNativeHistory &&
        request.matchId === head.matchId && request.stateVersion === head.stateVersion &&
        request.actor === tx.actor && request.uid === tx.uid && request.sourceEpoch === tx.epoch &&
        request.cardId === head.physicalCardsByUID[tx.uid]?.cardId &&
        head.players.find(player => player.playerId === tx.actor)?.hand.some(card =>
          card.uid === tx.uid && card.cardId === request.cardId) === true &&
        head.board.bases.some(base => base.ownerPlayerId === tx.actor &&
          base.locationId === request.baseLocationId) &&
        request.baseProofId === `optional-base:${request.transactionId}:${census.journalRevision}` &&
        request.coverageProofId === `optional-coverage:${request.transactionId}:${census.journalRevision}`;
      return { ...request, status: complete ? "complete" as const : "unknown" as const };
    } catch { return { ...request, status: "unknown" as const }; }
  };
  return Object.freeze({ readSource, inspectChoice, program, cost, costBinding, entry,
    unitServices: Object.freeze({ program, inspectChoice, cost, costBinding, entry }) });
}
