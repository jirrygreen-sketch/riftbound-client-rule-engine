/**
 * Production composition for the opt-in physical printed Unit Chain V4 path.
 *
 * This adapter is deliberately server-only.  It reads the loaded catalog and
 * the identity guarded program authority, then binds every callback to the
 * current canonical head and native operation journal.  Missing or stale
 * evidence is returned as an unknown entry/cost result; no callback invents a
 * receipt, source census, journal or Core session.
 */
import { createHash } from "node:crypto";
import {
  bindDuelPrintedCost,
  assertAdmittedDuelMatchV2,
  inspectDuelNativeCommitPathV2,
  inspectDuelNativeCommandSessionPathV2,
  resolveDuelTotalCostV2,
  createDuelCostResolverAuthorityV2,
  fingerprintDuelCostCoverageV2,
  fingerprintDuelCostModifierV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  createDuelPhaseSourceClosureJournalV2,
  inspectDuelPhaseSourceClosureV2,
  type DuelCanonicalPlayingStateV2,
  type DuelCostResolverAuthorityV2,
  type DuelCostVerifiedSourcesV2,
  type DuelCostModifierV2,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureJournalV2,
  type DuelPhaseSourceClosureRegistryV2,
  type DuelPrintedUnitChainCostFactoryRequestV4,
  type DuelPrintedUnitCostBindingV4,
  type DuelPrintedUnitEntryFactsV4,
  type DuelPrintedUnitEntryRequestV4,
  type DuelPrintedUnitPlayServicesV4,
  type DuelOptionalPlayReceiptDataV2,
  type DuelOptionalPlayReceiptV2,
  type DuelSourceAttestationRequestV2,
  type DuelSourceAttestorV2,
  type DuelPrintedUnitAttemptCapabilityV4,
  type DuelPrintedUnitSourceAttestationRequestV4,
  inspectDuelPrintedUnitAttemptCapabilityV4,
  inspectDuelPrintedUnitChoiceProofV4,
  type DuelCommandSessionV2,
  type DuelRuneCost,
  type DuelDomain,
} from "@riftbound/engine-core/duel";
import type { DuelOfficialProgram, DuelOfficialProgramRegistry } from "@riftbound/card-dsl/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import {
  getCardProgramRegistryForRuntime,
  type CardProgramAuthority,
} from "./card-program-authority.js";
import {
  inspectDuelNativeOperationJournalBindingV2,
  type DuelNativeCostCensusV2,
  type DuelNativeJournalCommitV2,
  type DuelNativeOperationJournalV2,
} from "./operation-journal-v2.js";
import { createDuelPhaseSourceServerBridgeV2 } from "./phase-source-bridge-v2.js";

export interface DuelPrintedUnitChainServicesP8Options {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  /** Exact canonical head owned by the authoritative room/runtime. */
  readonly currentHead: () => DuelCanonicalPlayingStateV2 | null;
  /** Exact native operation journal that observed `currentHead`. */
  readonly currentJournal: () => DuelNativeOperationJournalV2;
  /** Exact canonical command session owned by the authoritative runtime. */
  readonly currentSession: () => DuelCommandSessionV2;
  /** Parent supplied, replay-stable opaque ID source. */
  readonly nextOpaqueId: () => string;
  /** Explicit opt-in for fully witnessed, resolved native pre-exit cost history. */
  readonly allowResolvedPreExitCostHistory?: boolean;
}

export interface DuelPrintedUnitChainServicesP8 extends DuelPrintedUnitPlayServicesV4 {
  readonly inspectClosure: (request: Readonly<DuelPrintedUnitEntryRequestV4>,
    context: Readonly<DuelPhaseSourceClosureContextV2>) => {
      readonly status: "ready" | "pending";
      readonly registry?: DuelPhaseSourceClosureRegistryV2;
      readonly journal?: DuelPhaseSourceClosureJournalV2;
      readonly reason?: string;
    };
}

type Candidate = DuelPhaseSourceClosureCandidateV2;
type CommandSessionLike = DuelCommandSessionV2;

function fail(message: string): never {
  throw new TypeError(`Printed Unit Chain P8: ${message}`);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function epoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function commandSession(value: unknown): CommandSessionLike | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { commandSession?: unknown };
  const session = candidate.commandSession && typeof candidate.commandSession === "object"
    ? candidate.commandSession : value;
  return session as CommandSessionLike;
}
function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === "string" && keys.includes(key)) &&
    keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor && "value" in descriptor;
    });
}
function sourceCard(catalog: CardCatalogRuntime, cardId: string) {
  const card = catalog.publicCatalog.cards.find(item => item.id === cardId);
  if (!card || !text(card.localizedName)) return null;
  return card;
}
function zoneKey(candidate: Candidate): string {
  const zone = candidate.zone;
  return JSON.stringify([zone.kind, "locationId" in zone ? zone.locationId : zone.zonePlayerId]);
}
function candidateKey(candidate: Candidate): string {
  const zone = candidate.zone;
  return JSON.stringify([candidate.carrier, candidate.uid, candidate.zoneEpoch, zone.kind,
    "locationId" in zone ? zone.locationId : zone.zonePlayerId]);
}
function currentCandidates(match: DuelCanonicalPlayingStateV2): readonly Candidate[] {
  const candidates = enumerateDuelPhaseSourceClosureCandidatesV2(match);
  if (candidates.length === 0 || new Set(candidates.map(candidate => candidate.uid)).size !== candidates.length)
    fail("duplicate or empty physical source census");
  return candidates;
}
function resolvedPreExitCostHistory(commits: readonly DuelNativeJournalCommitV2[],
  census: DuelNativeCostCensusV2, programs: CardProgramAuthority,
  registry: DuelOfficialProgramRegistry): boolean {
  const historical = census.sources.filter(source => source.carrier !== "object");
  const witnessed = commits.flatMap((commit, index) => commit.preExitSources.map(item => ({ commit, index, item })));
  if (historical.length !== witnessed.length) return false;
  return historical.every((source, index) => {
    const { commit, index: commitIndex, item } = witnessed[index]!;
    const transition = commit.transitions.find(step => step.proofId === item.proofId);
    const before = commit.before.stage === "playing"
      ? enumerateDuelPhaseSourceClosureCandidatesV2(commit.before).find(candidate => candidate.uid === item.source.uid)
      : undefined;
    const cardId = item.source.cardId;
    const reference = cardId && programs.resolvedProgramReference(cardId);
    const program = cardId && registry.getProgram(cardId);
    return !commit.unresolved && commit.after.stage === "playing" &&
      (commit.label.event === "pre-exit" || commit.label.phase === "lethal-kill") &&
      item.eventId === commit.label.eventId && !!transition && transition.uid === item.source.uid &&
      transition.eventId === item.eventId && transition.to.kind === "trash" &&
      same(item.transition, { eventId: transition.eventId, uid: transition.uid,
        from: transition.from, to: transition.to, fromZoneEpoch: transition.fromZoneEpoch,
        toZoneEpoch: transition.toZoneEpoch, proofId: transition.proofId }) &&
      !!before && before.cardId === cardId && before.zoneEpoch === item.source.zoneEpoch &&
      before.ownerPlayerId === item.source.ownerPlayerId &&
      before.controllerPlayerId === item.source.controllerPlayerId && same(before.zone, item.source.zone) &&
      transition.fromZoneEpoch === item.source.zoneEpoch && same(transition.from, item.source.zone) &&
      !!reference && !!program && program.programId === reference.programId &&
      program.source.dataVersion === commit.before.dataVersion &&
      program.source.sourceCatalogDigest === commit.before.catalogDigest &&
      noCardPlayCostEffect(program) && source.carrier === "pre-exit" && source.status === "resolved" &&
      source.bindingRevision === commitIndex + 1 && source.uid === item.source.uid &&
      source.sourceEpoch === item.source.zoneEpoch && source.cardId === cardId &&
      source.ownerPlayerId === item.source.ownerPlayerId &&
      source.controllerPlayerId === item.source.controllerPlayerId &&
      source.programReference === reference.encodedReference && same(source.zone, item.source.zone) &&
      source.ledger === undefined && source.effectId === undefined && source.sourceUID === undefined;
  });
}
function originalUnit(match: DuelCanonicalPlayingStateV2, actor: string, uid: string, cardId: string): boolean {
  const original = match.provenance.originalPhysicalCards.find(item => item.uid === uid);
  return !!original && original.cardType === "Unit" && original.cardId === cardId &&
    original.ownerPlayerId === actor;
}
function physicalSource(match: DuelCanonicalPlayingStateV2, actor: string, uid: string,
  cardId?: string, location?: "hand" | "chain") {
  const physical = match.physicalCardsByUID[uid];
  if (!physical || physical.ownerPlayerId !== actor || (cardId !== undefined && physical.cardId !== cardId)) return null;
  const cards = location === "chain"
    ? (match.chainCards ?? []).filter(card => card.uid === uid)
    : match.players.find(player => player.playerId === actor)?.hand.filter(card => card.uid === uid) ?? [];
  if (cards.length !== 1 || cards[0]!.cardId !== physical.cardId) return null;
  if (location === "chain" && cards[0]!.uid !== uid) return null;
  return { cardId: physical.cardId, sourceEpoch: physical.zoneEpoch };
}
function isAccelerate(program: DuelOfficialProgram): boolean {
  const semantics = program.semantics as unknown as Record<string, unknown>;
  if (!exactObject(semantics, ["kind", "choiceTiming", "optional", "additionalCost", "paidEffect"]) ||
      semantics.kind !== "accelerate" || semantics.choiceTiming !== "card-play-choices" || semantics.optional !== true ||
      !exactObject(semantics.additionalCost, ["energy", "power"]) || semantics.additionalCost.energy !== 1 ||
      !Array.isArray(semantics.additionalCost.power) || semantics.additionalCost.power.length !== 1 ||
      !exactObject(semantics.additionalCost.power[0], ["allowedDomains", "amount"]) ||
      semantics.additionalCost.power[0].amount !== 1 ||
      !Array.isArray(semantics.additionalCost.power[0].allowedDomains) ||
      semantics.additionalCost.power[0].allowedDomains.length !== 1 ||
      typeof semantics.additionalCost.power[0].allowedDomains[0] !== "string" ||
      !same(semantics.paidEffect, { kind: "enter-ready-replacement", timing: "unit-entry" })) return false;
  return true;
}

/**
 * Exact source-local cost audit. The complete IR is compared, so a future
 * opcode cannot inherit a no-effect exception from its `kind` string.
 */
function noCardPlayCostEffect(program: DuelOfficialProgram): boolean {
  const s = program.semantics as unknown as Record<string, unknown>;
  if (s.kind === "no-ability") {
    const p = s.playability as Record<string, unknown>;
    return exactObject(s, ["kind", "playability"]) && exactObject(p, ["kind", "fromHand", "energyCost", "tokenOnly"]) &&
      (p.kind === "printed-unit" || p.kind === "recruit-token") && typeof p.fromHand === "boolean" &&
      (p.energyCost === null || (typeof p.energyCost === "number" && Number.isSafeInteger(p.energyCost))) &&
      typeof p.tokenOnly === "boolean";
  }
  if (s.kind === "static") {
    const abilities = s.abilities;
    if (!Array.isArray(abilities)) return false;
    return abilities.every(item => {
      if (!item || typeof item !== "object") return false;
      const a = item as Record<string, unknown>;
      if (a.kind === "ganking") return same(a, { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" });
      if (a.kind === "enter-ready") return same(a, { kind: "enter-ready", subject: "self", scope: "unit-enter", mode: "replacement" });
      return false;
    }) && same(s, { kind: "static", abilities });
  }
  if (s.kind === "basic-rune") {
    const d = s.domain;
    return same(s, { kind: "basic-rune", sourceRule: "CR-v1.4:164.2", domain: d,
      abilities: [{ kind: "basic-rune-energy", sourceRule: "CR-v1.4:164.2.a", event: "activate",
        sourceScope: "source-basic-rune", permission: "reaction", costs: [{ kind: "exhaust-source" }],
        effects: [{ kind: "add-energy", amount: 1, recipient: "ability-controller", destination: "rune-pool", expiration: "rune-pool-reset" }] },
        { kind: "basic-rune-power", sourceRule: "CR-v1.4:164.2.b/164.2.b.1", event: "activate",
          sourceScope: "source-basic-rune", permission: "reaction", costs: [{ kind: "recycle-source", destination: "source-owner-rune-deck", readiness: "ready-or-exhausted" }],
          effects: [{ kind: "add-domain-power", amount: 1, domain: d, domainSource: "source-rune-domain", recipient: "ability-controller", destination: "rune-pool", expiration: "rune-pool-reset" }] }] });
  }
  if (s.kind === "passive") {
    const expected = s.event === "attacker"
      ? { kind: "passive", event: "attacker", sourceScope: "source-unit-on-board", modifier: { kind: "self-assault", amount: (s.modifier as Record<string, unknown>)?.kind === "self-assault" ? (s.modifier as Record<string, unknown>).amount : -1 } }
      : s.event === "hide" ? { kind: "passive", event: "hide", sourceScope: "source-battlefield", modifier: { kind: "additional-hide-permission", amount: 1, optional: true, scope: "source-battlefield" } } : null;
    return expected !== null && same(s, expected);
  }
  if (s.kind === "continuous") return same(s, { kind: "continuous", sourceScope: "source-unit-on-board", modifier: { kind: "token-unit-might", amount: 1, controller: "ability-controller", scope: "board" } });
  if (s.kind === "activated") return same(s, { kind: "activated", event: "activate", sourceScope: "ability-source", costs: [{ kind: "energy", amount: 1, payer: "ability-controller" }, { kind: "exhaust-source" }], effects: [{ kind: "play-recruit-token", token: { kind: "unit-token", cardType: "Unit", domains: [], domainless: true, tags: ["Recruit"], energy: null, power: null, might: 1, physicalPrintingCardId: null }, controller: "effect-controller", owner: "effect-controller", destination: "executor-defined", resolution: "deferred-token-play" }] });
  if (s.kind === "compound-vi-self") return same(s, { kind: "compound-vi-self", sourceScope: "source-unit-on-board", ganking: { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" }, activation: { event: "activate", sourceScope: "source-unit-on-board", costs: [{ kind: "recycle-from-trash", amount: 1, selector: "one-card", zone: "controller-trash", payer: "ability-controller" }], effects: [{ kind: "add-might", amount: 1, recipient: "ability-source-unit", duration: "this-turn" }] } });
  if (s.kind === "deflect") return same(s, { kind: "deflect", sourceScope: "source-unit-on-board", event: "opponent-choice", modifier: { kind: "additional-opponent-power-cost", amount: 1, powerDomain: "wildcard", payer: "opponent", timing: "additional-play-cost", per: "each-choice-of-source", optional: false, automaticPayment: false, choice: { source: "spell-or-ability", target: "source-unit-on-board" } } });
  if (s.kind === "accelerate") return isAccelerate(program);
  if (s.kind === "trigger") {
    const effect = Array.isArray(s.effects) ? s.effects[0] as Record<string, unknown> : undefined;
    if (s.event === "unit-enter" && effect) {
      const expectedEffect = effect.kind === "draw-cards"
        ? { kind: "draw-cards", amount: 1, recipient: "effect-controller" }
        : effect.kind === "kill-unit" && effect.controller === "enemy"
          ? { kind: "kill-unit", controller: "enemy", selection: "target" } : null;
      return expectedEffect !== null && same(s, { kind: "trigger", event: "unit-enter", sourceScope: "played-source-unit",
        eventPredicate: { kind: "source-play-completed", source: "ability-source", countered: false }, condition: null, optional: false, costs: [], effects: [expectedEffect] });
    }
    if (s.event === "play-gear") return same(s, { kind: "trigger", event: "play-gear", sourceScope: "controller-plays-gear",
      eventPredicate: { kind: "controller-play-completed", actor: "source-controller-at-event", cardType: "Gear", turn: "any", countered: false }, condition: null, optional: false, costs: [], effects: [{ kind: "ready-source" }] });
    if (s.event === "card-play-on-opponent-turn") return same(s, { kind: "trigger", event: "card-play-on-opponent-turn", sourceScope: "controller-plays-card-on-opponent-turn",
      eventPredicate: { kind: "controller-play-completed", actor: "source-controller-at-event", cardType: "any", turn: "opponent", countered: false }, condition: null, optional: false, costs: [], effects: [{ kind: "play-recruit-token", token: { kind: "unit-token", cardType: "Unit", domains: [], domainless: true, tags: ["Recruit"], energy: null, power: null, might: 1, physicalPrintingCardId: null }, controller: "effect-controller", owner: "effect-controller", destination: "base", resolution: "deferred-token-play" }] });
    if (s.event === "hold" && effect) {
      const expectedEffect = effect.kind === "draw-cards"
        ? { kind: "draw-cards", amount: 1, recipient: "effect-controller" }
        : effect.kind === "play-recruit-token" ? { kind: "play-recruit-token", token: { kind: "unit-token", cardType: "Unit", domains: [], domainless: true, tags: ["Recruit"], energy: null, power: null, might: 1, physicalPrintingCardId: null }, controller: "effect-controller", owner: "effect-controller", destination: "base", resolution: "deferred-token-play" } : null;
      return expectedEffect !== null && same(s, { kind: "trigger", event: "hold", sourceScope: "battlefield-controller", condition: null, optional: false, costs: [], effects: [expectedEffect] });
    }
    if (s.event === "conquer") {
      const sourceUnit = s.sourceScope === "conquering-source-unit";
      const effectValue = sourceUnit
        ? { kind: "play-gold-gear-token", token: { kind: "gear-token", tokenName: "Gold", cardType: "Gear", domains: [], domainless: true, tags: [], energy: null, power: null, might: null, physicalPrintingCardId: null, defaultEntryReady: true, intrinsicAbility: { kind: "duel-intrinsic-token-ability-reference", schemaVersion: 1, ruleset: "riftbound-duel-official-v1", intrinsicId: "riftbound-duel-official-v1:intrinsic-token:gold-gear" } }, controller: "effect-controller", owner: "effect-controller", destination: "effect-controller-base", entryExhausted: true, resolution: "deferred-token-play" }
        : { kind: "ready-unit", target: { kind: "unit", controller: "any", scope: "legal-unit" } };
      const expected = sourceUnit
        ? { kind: "trigger", event: "conquer", sourceScope: "conquering-source-unit", eventPredicate: { kind: "source-unit-present-at-conquered-battlefield", participant: "ability-source-unit", battlefield: "conquered-battlefield", pointOutcome: "including-negated-or-replaced" }, condition: null, optional: false, costs: [], effects: [effectValue] }
        : { kind: "trigger", event: "conquer", sourceScope: "ability-source", condition: { kind: "assigned-excess-damage-at-least", amount: 3 }, optional: true, costs: [{ kind: "exhaust-source" }], effects: [effectValue] };
      return same(s, expected);
    }
    return false;
  }
  if (s.kind === "spell-resolution") {
    const effect = Array.isArray(s.effects) ? s.effects[0] as Record<string, unknown> : undefined;
    const supported = !!effect && ((effect.kind === "draw-cards" && effect.recipient === "effect-controller" &&
      ((effect.amount === 4 && s.permission === undefined) || (effect.amount === 3 && s.permission === "reaction"))) ||
      (effect.kind === "kill-unit" && effect.controller === "any" && effect.selection === "target") ||
      (effect.kind === "kill-units" && effect.controller === "any" && effect.selection === "all") ||
      (effect.kind === "each-player-kills-unit" && effect.selection === "each-player-choice") ||
      (effect.kind === "deal-damage" && effect.amount === 6 && effect.distribution === "each" &&
        (effect.targets as Record<string, unknown>)?.kind === "unit" && (effect.targets as Record<string, unknown>)?.controller === "any" &&
        (effect.targets as Record<string, unknown>)?.minSelections === 0 && (effect.targets as Record<string, unknown>)?.maxSelections === 2));
    return !!supported && same(s, { kind: "spell-resolution", ...(s.permission === undefined ? {} : { permission: "reaction" }), effects: [effect] });
  }
  // The reviewed point-damage Spell IR declares exactly one spell-resolution
  // direct-damage instruction and nothing else: no play cost and no Unit entry
  // effect. Its Deflect/target costing belongs to the Spell payment path, not to
  // a Unit's entry census. Only this complete reviewed shape is excepted; any
  // other/new opcode still falls through to `false` (unknown, never no-effect).
  if (s.kind === "point-damage-spell-resolution") {
    const effect = Array.isArray(s.effects) ? s.effects[0] as Record<string, unknown> : undefined;
    const target = effect?.target as Record<string, unknown> | undefined;
    const supported = !!effect && effect.kind === "point-damage" &&
      (effect.amount === 2 || effect.amount === 3 || effect.amount === 6 || effect.amount === 8) &&
      !!target && target.kind === "unit" && target.controller === "any" &&
      (target.location === "battlefield" || target.location === "any") &&
      target.minSelections === 1 && target.maxSelections === 1;
    return !!supported && same(s, { kind: "point-damage-spell-resolution", effects: [{
      kind: "point-damage", amount: effect!.amount, target: { kind: "unit", controller: "any",
        location: target!.location, minSelections: 1, maxSelections: 1 } }] });
  }
  return false;
}

function noUnitEntryEffect(program: DuelOfficialProgram, candidate: Candidate, actor: string, target: boolean): boolean {
  if (target) return isAccelerate(program);
  if (!noCardPlayCostEffect(program)) return false;
  const semantics = program.semantics as unknown as Record<string, unknown>;
  // The exact known unit-enter trigger is scoped to its own played source;
  // another UID cannot handle this target's entry.
  if (semantics.kind === "trigger" && semantics.event === "card-play-on-opponent-turn" &&
      (candidate.zone.kind === "board-base" || candidate.zone.kind === "board-battlefield") &&
      candidate.controllerPlayerId !== actor) return false;
  return true;
}

function unknownEntry(request: DuelPrintedUnitEntryRequestV4): DuelPrintedUnitEntryFactsV4 {
  return { ...request, sourceCensus: "unknown", scopes: { play: "unknown", replacement: "unknown", static: "unknown", trigger: "unknown", pendingTasks: "unknown", chain: "unknown" }, resolution: "unknown", sources: [] };
}

function contextMatches(match: DuelCanonicalPlayingStateV2, context: DuelPhaseSourceClosureContextV2): boolean {
  return match.matchId === context.matchId && match.dataVersion === context.dataVersion && match.catalogDigest === context.catalogDigest &&
    match.frame.turnNumber === context.turn && match.stateVersion === context.clock.stateVersion && match.eventSeq === context.clock.eventSeq &&
    context.taskId.includes(`turn-${context.turn}:`);
}

function genuineInternalChainHead(observed: DuelCanonicalPlayingStateV2 | null,
  candidate: DuelCanonicalPlayingStateV2, actor: string, uid: string): boolean {
  if (!observed || candidate === observed || observed.stage !== "playing" || observed.frame.phase !== "main" ||
      !observed.frame.stateOpen || observed.frame.turnPlayerId !== actor || observed.frame.priorityPlayerId !== actor ||
      candidate.frame.phase !== "main" || candidate.frame.stateOpen || candidate.frame.turnPlayerId !== actor ||
      candidate.frame.priorityPlayerId !== actor || candidate.matchId !== observed.matchId ||
      candidate.dataVersion !== observed.dataVersion || candidate.catalogDigest !== observed.catalogDigest ||
      candidate.frame.turnNumber !== observed.frame.turnNumber || candidate.frame.pendingPayment !== null) return false;
  try {
    const path = inspectDuelNativeCommitPathV2(observed, candidate);
    if (path.length !== 2 || path[0]!.before !== observed || path[1]!.after !== candidate ||
        path[0]!.transitions.length !== 1 || path[1]!.transitions.length !== 0 ||
        path.some(commit => commit.tokenBirths.length !== 0 || commit.tokenRetirements.length !== 0)) return false;
    const transition = path[0]!.transitions[0]!;
    const before = physicalSource(observed, actor, uid, undefined, "hand");
    const after = physicalSource(candidate, actor, uid, before?.cardId, "chain");
    return !!before && !!after && transition.uid === uid && transition.from.kind === "hand" &&
      transition.to.kind === "chain" && path[0]!.after.stage === "playing" &&
      path[0]!.after.frame.stateOpen &&
      candidate.physicalCardsByUID[uid]?.zoneEpoch === before.sourceEpoch + 1;
  } catch { return false; }
}

export function createDuelPrintedUnitChainServicesP8(
  options: DuelPrintedUnitChainServicesP8Options,
): DuelPrintedUnitChainServicesP8 {
  const { catalog, programs } = options;
  if (!catalog?.publicCatalog || !programs || typeof options.currentHead !== "function" ||
      typeof options.currentJournal !== "function" || typeof options.currentSession !== "function" ||
      typeof options.nextOpaqueId !== "function" ||
      catalog.publicCatalog.dataVersion !== programs.catalogStamp.dataVersion ||
      catalog.publicCatalog.digest !== programs.catalogStamp.digest)
    fail("catalog, genuine program authority, current journal and entropy are required");
  const initialHead = options.currentHead();
  if (!initialHead || initialHead.stage !== "playing" || initialHead.dataVersion !== catalog.publicCatalog.dataVersion ||
      initialHead.catalogDigest !== catalog.publicCatalog.digest) fail("admitted playing current head is required");
  try { assertAdmittedDuelMatchV2(initialHead); } catch { fail("admitted playing current head is required"); }
  const registry = getCardProgramRegistryForRuntime(programs);
  const printings = new Map(catalog.publicCatalog.cards.map(card => [card.id, card]));
  if (printings.size !== catalog.publicCatalog.cards.length) fail("duplicate catalog printing");
  const internalChoiceHeads = new WeakMap<DuelCanonicalPlayingStateV2, Map<string, DuelCanonicalPlayingStateV2>>();
  const boundAuthority = (head: DuelCanonicalPlayingStateV2): boolean => {
    try {
      const journal = options.currentJournal();
      const binding = inspectDuelNativeOperationJournalBindingV2(journal);
      const session = options.currentSession();
      inspectDuelNativeCommandSessionPathV2(session, session);
      return !!binding && binding.journal === journal && binding.head === head && binding.observed === head &&
        binding.census.matchId === head.matchId && binding.census.stateVersion === head.stateVersion &&
        binding.census.eventSeq === head.eventSeq && session.match === head &&
        options.currentJournal() === journal && options.currentHead() === head;
    } catch { return false; }
  };
  const head = (): DuelCanonicalPlayingStateV2 | null => {
    try {
      const value = options.currentHead();
      if (!value || value.stage !== "playing" || value.dataVersion !== catalog.publicCatalog.dataVersion ||
          value.catalogDigest !== catalog.publicCatalog.digest) return null;
      assertAdmittedDuelMatchV2(value);
      return value;
    } catch { return null; }
  };
  const targetProgram = (match: DuelCanonicalPlayingStateV2, actor: string, uid: string, cardId: string, sourceEpoch: number,
    location: "hand" | "chain"): { readonly program: DuelOfficialProgram; readonly fingerprint: string } => {
    const source = physicalSource(match, actor, uid, cardId, location);
    if (!source || source.sourceEpoch !== sourceEpoch || !originalUnit(match, actor, uid, cardId)) fail("physical Unit source mismatch");
    const card = sourceCard(catalog, cardId);
    const reference = programs.resolvedProgramReference(cardId);
    const program = registry.getProgram(cardId);
    if (!card || card.cardType !== "Unit" || !reference || !program || program.cardId !== cardId ||
        program.programId !== reference.programId || program.source.dataVersion !== match.dataVersion ||
        program.source.sourceCatalogDigest !== match.catalogDigest || !isAccelerate(program)) fail("unsupported Unit program");
    const fingerprint = digest({ dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, cardId,
      sourceEpoch, programId: program.programId, reference: reference.encodedReference, semantics: program.semantics, source: program.source });
    return { program, fingerprint };
  };
  const readSourceInternal = (match: DuelCanonicalPlayingStateV2, actor: string, uid: string,
    allowNativeDescendant: boolean) => {
    const observed = head();
    if (!observed || options.currentSession().match !== observed) fail("choice owner session head mismatch");
    inspectDuelNativeCommandSessionPathV2(options.currentSession(), options.currentSession());
    const internalChainHead = genuineInternalChainHead(observed, match, actor, uid);
    if ((match !== observed && (!allowNativeDescendant || !internalChainHead)) || match.frame.phase !== "main") fail("choice source head is stale or foreign");
    if (allowNativeDescendant && internalChainHead && observed) {
      const byUID = internalChoiceHeads.get(observed) ?? new Map<string, DuelCanonicalPlayingStateV2>();
      const prior = byUID.get(uid);
      if (prior && prior !== match) fail("choice source is a sibling of the issued Chain head");
      byUID.set(uid, match);
      internalChoiceHeads.set(observed, byUID);
    }
    const location = match.frame.stateOpen ? "hand" : "chain";
    const source = physicalSource(match, actor, uid, undefined, location);
    if (!source) fail("choice source is not actor Hand or Chain");
    const checked = targetProgram(match, actor, uid, source.cardId, source.sourceEpoch, location);
    return Object.freeze({ matchId: match.matchId, actor, uid, cardId: source.cardId,
      sourceEpoch: source.sourceEpoch, sourceProgramFingerprint: checked.fingerprint });
  };
  const readSource = (match: DuelCanonicalPlayingStateV2, actor: string, uid: string) =>
    readSourceInternal(match, actor, uid, false);
  const readSourceV4 = (match: DuelCanonicalPlayingStateV2, actor: string, uid: string,
    attemptProof: DuelPrintedUnitAttemptCapabilityV4) => {
    try {
      const source = physicalSource(match, actor, uid, undefined, "chain");
      if (!source) fail("V4 attempt source unavailable");
      inspectDuelPrintedUnitAttemptCapabilityV4(attemptProof, { match, actor, uid,
        cardId: source.cardId, sourceEpoch: source.sourceEpoch });
    } catch { fail("V4 attempt source proof unavailable"); }
    return readSourceInternal(match, actor, uid, true);
  };
  const program = (request: Parameters<DuelPrintedUnitPlayServicesV4["program"]>[0]) => {
    const match = request.match;
    const observed = head();
    if (!observed || options.currentSession().match !== observed) return { status: "unknown", kind: "other", cardId: request.cardId, programId: "unknown", programFingerprint: "unknown", optionalCost: "unknown" } as const;
    const internalChainHead = genuineInternalChainHead(observed, match, request.actor, request.uid);
    if ((match !== observed && (!internalChainHead || internalChoiceHeads.get(observed!)?.get(request.uid) !== match)) ||
        request.matchId !== match.matchId || request.dataVersion !== match.dataVersion ||
        request.catalogDigest !== match.catalogDigest) return { status: "unknown", kind: "other", cardId: request.cardId, programId: "unknown", programFingerprint: "unknown", optionalCost: "unknown" } as const;
    const location = (match.chainCards ?? []).some(card => card.uid === request.uid) ? "chain" : "hand";
    try {
      const checked = targetProgram(match, request.actor, request.uid, request.cardId, request.sourceEpoch, location);
      return Object.freeze({ status: "known" as const, kind: "Unit" as const, cardId: request.cardId,
        programId: checked.program.programId, programFingerprint: checked.fingerprint, optionalCost: "accelerate" as const });
    } catch {
      return { status: "unknown", kind: "other", cardId: request.cardId, programId: "unknown", programFingerprint: "unknown", optionalCost: "unknown" } as const;
    }
  };

  const closureFor = (request: Readonly<DuelPrintedUnitEntryRequestV4>, context: Readonly<DuelPhaseSourceClosureContextV2>) => {
    const pending = (reason: string) => ({ status: "pending" as const, reason });
    try {
      const match = head();
      if (!match || match !== request.match || !contextMatches(match, context) || !boundAuthority(match)) return pending("stale-or-foreign-head");
      const journal = options.currentJournal();
      const snapshot = journal.read(context);
      if (!snapshot || snapshot.scope !== "exact" || snapshot.status !== "resolved" ||
          !same({ matchId: snapshot.input.matchId, dataVersion: snapshot.input.dataVersion,
            catalogDigest: snapshot.input.catalogDigest, turn: snapshot.input.turn,
            taskId: snapshot.input.taskId, phase: snapshot.input.phase, event: snapshot.input.event,
            clock: snapshot.input.clock }, context)) return pending("missing-exact-journal");
      const actual = currentCandidates(match);
      const special = snapshot.input.preExitSources.map(item => item.source);
      const runtime = [snapshot.input.activeEffects, snapshot.input.chain, snapshot.input.effectQueue, snapshot.input.feprOutstanding]
        .flatMap(ledger => ledger.entries.map(entry => JSON.stringify(["runtime-effect", `effect:${entry.effectId}`, entry.sourceZoneEpoch, zoneKey({ zone: entry.zone } as Candidate)])));
      const keys = [...actual.map(candidateKey), ...special.map(candidateKey), ...runtime];
      if (!same([...keys].sort(), [...snapshot.candidateKeys].sort()) || new Set(keys).size !== keys.length) return pending("journal-census-mismatch");
      const bridge = createDuelPhaseSourceServerBridgeV2(programs, match, {
        resolveCore(locator) {
          const candidate = [...actual, ...special].find(item => item.uid === locator.uid);
          const reference = candidate?.cardId && programs.resolvedProgramReference(candidate.cardId);
          return candidate && reference ? { context, source: candidate, expectedProgramReference: reference.encodedReference, referenceKind: "printing" } : null;
        },
        resolveJournal(coreRequest, requirements) {
          const fresh = options.currentJournal().read(context);
          if (!fresh || fresh.journalRevision !== snapshot.journalRevision || fresh.candidateSetRevision !== snapshot.candidateSetRevision ||
              !same(fresh.candidateKeys, snapshot.candidateKeys) || requirements.some(required => !fresh.coverage.some(item => item.requirement === required))) return null;
          return { request: coreRequest, proofId: `${fresh.proofId}:${candidateKey(coreRequest.source)}`, journalRevision: fresh.journalRevision,
            candidateSetRevision: fresh.candidateSetRevision, coverage: fresh.coverage.filter(item => requirements.includes(item.requirement)) };
        },
      });
      const closureJournal = createDuelPhaseSourceClosureJournalV2(snapshot.input);
      return { status: "ready" as const, registry: bridge.closureRegistry, journal: closureJournal };
    } catch { return pending("closure-provider-failure"); }
  };
  const inspectClosure = (request: Readonly<DuelPrintedUnitEntryRequestV4>, context: Readonly<DuelPhaseSourceClosureContextV2>) => {
    const result = closureFor(request, context);
    if (result.status !== "ready") return result;
    try {
      const inspection = inspectDuelPhaseSourceClosureV2(request.match, context, result.registry!, result.journal!);
      return inspection.status === "ready" ? { ...result, status: "ready" as const } : { status: "pending" as const, reason: inspection.reason };
    } catch { return { status: "pending" as const, reason: "closure-inspection-failure" }; }
  };

  const entry = (request: Readonly<DuelPrintedUnitEntryRequestV4>): DuelPrintedUnitEntryFactsV4 => {
    const unknown = () => unknownEntry(request);
    try {
      const match = head();
      if (!match || match !== request.match || match.matchId !== request.matchId || match.stateVersion !== request.stateVersion || match.eventSeq !== request.eventSeq ||
          match.frame.phase !== "main" || match.frame.stateOpen || match.frame.pendingPayment !== null) return unknown();
      const target = currentCandidates(match).find(candidate => candidate.uid === request.uid);
      if (!target || target.zone.kind !== "chain" || target.zoneEpoch !== request.sourceEpoch || target.cardId !== request.cardId ||
          target.ownerPlayerId !== request.actor || target.controllerPlayerId !== request.actor || !originalUnit(match, request.actor, request.uid, request.cardId)) return unknown();
      const context: DuelPhaseSourceClosureContextV2 = Object.freeze({ matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
        turn: match.frame.turnNumber, taskId: `duel-v4:${match.matchId}:turn-${match.frame.turnNumber}:printed-unit:${request.uid}:${match.stateVersion}`,
        phase: "main", event: "chain", clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } });
      const inspected = inspectClosure(request, context);
      if (inspected.status !== "ready") return unknown();
      const raw = inspectDuelPhaseSourceClosureV2(match, context, inspected.registry!, inspected.journal!);
      if (raw.status !== "ready" || raw.activeSources.length !== 0 || raw.handlers.length !== 0 || raw.runtimeSources.length !== 0 ||
          raw.candidates.some(candidate => candidate.carrier !== "object" || candidate.cardId === null || candidate.zoneEpoch === null)) return unknown();
      const sources = raw.candidates.map(candidate => {
        const reference = candidate.uid === request.uid ? null : programs.resolvedProgramReference(candidate.cardId!);
        const candidateProgram = candidate.uid === request.uid ? program({ match, matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, actor: request.actor, uid: request.uid, cardId: request.cardId, sourceEpoch: request.sourceEpoch }) : registry.getProgram(candidate.cardId!);
        const official = registry.getProgram(candidate.cardId!);
        if (!candidateProgram || !official || !noUnitEntryEffect(official, candidate, request.actor, candidate.uid === request.uid) ||
            ("status" in candidateProgram && candidateProgram.status === "unknown")) throw new Error("applicable or unknown candidate program");
        return { uid: candidate.uid, zoneEpoch: candidate.zoneEpoch!, programId: candidate.uid === request.uid ? request.programId : (reference?.programId ?? ""), disposition: "known-no-effect" as const };
      });
      if (sources.length !== currentCandidates(match).length || !sources.some(source => source.uid === request.uid && source.programId === request.programId) || options.currentHead() !== match) return unknown();
      return { ...request, sourceCensus: "complete", scopes: { play: "clear", replacement: "clear", static: "clear", trigger: "clear", pendingTasks: "clear", chain: "clear" }, resolution: "complete", sources };
    } catch { return unknown(); }
  };

  const pins = new Map<string, {
    readonly binding: ReturnType<DuelSourceAttestorV2>;
    readonly cost: DuelRuneCost;
    readonly issuedAt: DuelCanonicalPlayingStateV2;
    readonly commandSession: DuelCommandSessionV2;
    readonly choiceReceipt: DuelOptionalPlayReceiptV2;
    readonly choiceData: DuelOptionalPlayReceiptDataV2;
    readonly census: DuelNativeCostCensusV2;
    readonly baseProofId: string;
    readonly coverageProofId: string;
  }>();
  const sourceAttestorV4 = (request: DuelPrintedUnitSourceAttestationRequestV4) => {
    const match = head();
    if (!match || match.frame.stateOpen || match.frame.phase !== "main" || request.match !== match || request.actor !== match.frame.turnPlayerId ||
        request.sourceReference.kind !== "card" || !text(request.sourceReference.sourceUID) || !text(request.sourceReference.referenceId)) fail("payment source head mismatch");
    const uid = request.sourceReference.sourceUID;
    const source = physicalSource(match, request.actor, uid, request.sourceReference.referenceId, "chain");
    if (!source || !originalUnit(match, request.actor, uid, source.cardId) || !epoch(source.sourceEpoch)) fail("payment source is not current Chain epoch");
    const prior = pins.get(request.paymentId);
    if (!prior || request.taskId !== prior.binding.taskId || request.continuationId !== prior.binding.continuationId ||
        request.actor !== prior.choiceData.actor || uid !== prior.choiceData.uid ||
        source.cardId !== prior.choiceData.cardId || source.sourceEpoch !== prior.choiceData.sourceEpoch ||
        !same(request.finalResolvedCost, prior.cost) || !same(request.sourceReference, prior.binding.sourceReference) ||
        (match === prior.issuedAt && !same(options.currentJournal().readCostCensus(), prior.census)))
      fail("payment task or fixed cost drift");
    try { inspectDuelNativeCommitPathV2(prior.issuedAt, match); }
    catch { fail("payment head left the original Chain lineage"); }
    const session = commandSession(options.currentSession());
    if (!session) fail("canonical command session required for payment");
    try { inspectDuelNativeCommandSessionPathV2(prior.commandSession, session); }
    catch { fail("payment command session left the original Chain lineage"); }
    if (session.match !== match) fail("payment command session head mismatch");
    const task = session.requiredTasks.find(item => item.paymentId === request.paymentId);
    if (match !== prior.issuedAt && (!task || task.taskId !== request.taskId ||
        task.continuationId !== request.continuationId || task.actor !== request.actor ||
        !same(task.finalResolvedCost, request.finalResolvedCost) ||
        !same(task.sourceBinding, prior.binding))) fail("Core task lineage is not current");
    if (request.previous ? !same(request.previous, prior.binding) : task !== undefined)
      fail("payment source binding drift");
    inspectDuelPrintedUnitAttemptCapabilityV4(request.attemptProof, { match: prior.issuedAt, actor: request.actor,
      uid, cardId: source.cardId, sourceEpoch: source.sourceEpoch });
    const choice = inspectDuelPrintedUnitChoiceProofV4(request.choiceProof, { match: prior.issuedAt,
      actor: request.actor, uid, cardId: source.cardId, sourceEpoch: source.sourceEpoch });
    const expectedPhase = match === prior.issuedAt ? (request.previous ? "prepare" : "issue") : "pay";
    if (choice.receipt !== prior.choiceReceipt ||
        choice.decision !== prior.choiceData.decision || request.phase !== expectedPhase)
      fail("V4 proof identity drift");
    return prior.binding;
  };
  const sourceAttestor: DuelSourceAttestorV2 = () => {
    fail("P8 V4 source proof required");
  };

  const costForChain = (request: Readonly<DuelPrintedUnitChainCostFactoryRequestV4>): DuelCostResolverAuthorityV2 => {
    const match = head();
    if (!match || match !== request.match || request.commandSession.match !== match || match.frame.stateOpen || match.frame.phase !== "main" ||
        request.matchId !== match.matchId || request.actor !== match.frame.turnPlayerId) fail("closed Chain cost head mismatch");
    if (options.currentSession() !== request.commandSession) fail("canonical Chain command session changed");
    inspectDuelNativeCommandSessionPathV2(request.commandSession, request.commandSession);
    if (!request.attemptProof) fail("V4 attempt proof missing");
    inspectDuelPrintedUnitAttemptCapabilityV4(request.attemptProof, { match, actor: request.actor,
      uid: request.cardUID, cardId: request.cardId, sourceEpoch: request.sourceEpoch });
    if (!request.choiceProof) fail("V4 choice proof missing");
    const inspectedChoice = inspectDuelPrintedUnitChoiceProofV4(request.choiceProof, { match,
      actor: request.actor, uid: request.cardUID, cardId: request.cardId, sourceEpoch: request.sourceEpoch });
    if (request.choiceReceipt !== inspectedChoice.receipt) fail("choice receipt identity mismatch");
    if (inspectedChoice.uid !== request.cardUID || inspectedChoice.cardId !== request.cardId || inspectedChoice.actor !== request.actor ||
        inspectedChoice.matchId !== match.matchId || inspectedChoice.sourceEpoch !== request.sourceEpoch || inspectedChoice.decision !== request.choiceReceipt.decision ||
        inspectedChoice.sourceProgramFingerprint !== request.program.programFingerprint || !text(inspectedChoice.commandId)) fail("choice receipt mismatch");
    const target = currentCandidates(match).find(candidate => candidate.uid === request.cardUID);
    if (!target || target.zone.kind !== "chain" || target.zoneEpoch !== request.sourceEpoch || target.cardId !== request.cardId) fail("Chain target changed");
    const card = sourceCard(catalog, request.cardId);
    const printed = card && bindDuelPrintedCost(card);
    if (!card || card.cardType !== "Unit" || !printed || printed.kind !== "numeric") fail("printed base cost unavailable");
    const journal = options.currentJournal();
    const binding = inspectDuelNativeOperationJournalBindingV2(journal);
    const census = journal.readCostCensus();
    if (!binding || binding.journal !== journal || binding.head !== match || binding.observed !== match || !census ||
        census.matchId !== match.matchId || census.stateVersion !== match.stateVersion || census.eventSeq !== match.eventSeq || census.unresolvedNativeHistory) fail("complete native cost census unavailable");
    const actual = currentCandidates(match);
    const objects = census.sources.filter(source => source.carrier === "object");
    const historyAllowed = options.allowResolvedPreExitCostHistory === true &&
      resolvedPreExitCostHistory(binding.commits, census, programs, registry);
    if (objects.length !== actual.length ||
        (options.allowResolvedPreExitCostHistory === true
          ? !historyAllowed : census.sources.length !== actual.length) ||
        objects.some(source => {
      const c = actual.find(item => item.uid === source.uid);
      return !c || source.status !== "live" || source.sourceEpoch !== c.zoneEpoch || source.cardId !== c.cardId || source.ownerPlayerId !== c.ownerPlayerId || source.controllerPlayerId !== c.controllerPlayerId || !same(source.zone, c.zone);
    })) fail("native candidate census differs from Chain head");
    const candidates = actual.map(source => {
      if (source.cardId === null || source.zoneEpoch === null) fail("null physical source");
      const p = registry.getProgram(source.cardId);
      const ref = programs.resolvedProgramReference(source.cardId);
      const bound = objects.find(item => item.uid === source.uid);
      if (!p || !ref || !bound || bound.programReference !== ref.encodedReference || p.source.dataVersion !== match.dataVersion || p.source.sourceCatalogDigest !== match.catalogDigest ||
          (source.uid === request.cardUID ? !isAccelerate(p) : !noCardPlayCostEffect(p))) fail("unknown or applicable source program");
      return { sourceUid: source.uid, sourceEpoch: source.zoneEpoch, choice: source.uid === request.cardUID ? (request.choiceReceipt.decision === "pay" ? "chosen-optional" as const : "declined-optional" as const) : "not-applicable" as const,
        modifierIds: source.uid === request.cardUID && request.choiceReceipt.decision === "pay" ? [`accelerate:${request.cardUID}:${request.sourceEpoch}`] : [] };
    });
    const accelerate = registry.getProgram(request.cardId);
    const domain = accelerate && (accelerate.semantics as unknown as { readonly additionalCost?: { readonly power?: readonly { readonly allowedDomains?: readonly string[] }[] } }).additionalCost?.power?.[0]?.allowedDomains;
    if (!domain || domain.length !== 1 || typeof domain[0] !== "string") fail("Accelerate domain binding unavailable");
    const modifier = request.choiceReceipt.decision === "pay" ? {
      id: `accelerate:${request.cardUID}:${request.sourceEpoch}`, sourceProofId: `proof:accelerate:${request.cardUID}:${request.sourceEpoch}`,
      stage: "additional" as const, target: { kind: "new-component" as const }, operation: "add" as const, choice: "chosen-optional" as const,
      cost: { energy: 1, power: [{ allowedDomains: [domain[0] as DuelDomain], amount: 1 }] },
    } : undefined;
    const verified: DuelCostVerifiedSourcesV2 = { registryRevision: `${match.catalogDigest}:${census.journalRevision}:${census.candidateSetRevision}`,
      catalogRevision: `${match.dataVersion}:${match.catalogDigest}`, nonResourceCosts: "none", base: { cost: printed.cost, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch }, candidates,
      orderedModifiers: modifier ? [modifier] : [] };
    const coverage = fingerprintDuelCostCoverageV2(verified);
    const tx = request.transactionId;
    const makeDecision = () => {
      if (options.currentHead() !== match || options.currentJournal() !== journal || JSON.stringify(options.currentJournal().readCostCensus()) !== JSON.stringify(census)) fail("cost snapshot changed");
      const baseProofId = `printed-unit-chain-v4:base:${tx}:${census.journalRevision}`;
      const coverageProofId = `printed-unit-chain-v4:coverage:${tx}:${census.journalRevision}`;
      const proofs = modifier ? [{ proofId: modifier.sourceProofId, modifierId: modifier.id, request: { transactionId: tx, subjectId: request.cardId, kind: "card-play" as const }, target: modifier.target, status: "complete" as const, applicability: "applies" as const, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch, registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision, modifierFingerprint: fingerprintDuelCostModifierV2({ transactionId: tx, subjectId: request.cardId, kind: "card-play" }, modifier), candidateSourcesFingerprint: coverage.candidateSourcesFingerprint, resolvedChoicesFingerprint: coverage.resolvedChoicesFingerprint }] : [];
      return { request: { transactionId: tx, subjectId: request.cardId, kind: "card-play" as const }, base: { request: { transactionId: tx, subjectId: request.cardId, kind: "card-play" as const }, cost: printed.cost, proofId: baseProofId, status: "complete" as const, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch, registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision }, coverage: { request: { transactionId: tx, subjectId: request.cardId, kind: "card-play" as const }, proofId: coverageProofId, status: "complete" as const, allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: "none" as const, registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision, ...coverage }, proofs, modifiers: modifier ? [modifier] : [] };
    };
    const fixed = resolveDuelTotalCostV2(createDuelCostResolverAuthorityV2(makeDecision, () => verified),
      { transactionId: tx, subjectId: request.cardId, kind: "card-play" });
    const paymentId = `printed-unit-chain-v4-payment:${request.actor}:${request.commandId}`;
    const taskId = `printed-unit-chain-v4-task:${request.actor}:${request.commandId}`;
    const continuationId = `printed-unit-chain-v4-continuation:${request.actor}:${request.commandId}`;
    const choiceData = inspectedChoice;
    if (!same(choiceData, inspectedChoice) || choiceData.commandId !== request.commandId ||
        request.chainVersion !== match.stateVersion || pins.has(paymentId)) fail("stale or duplicate Core choice transaction");
    const sourceReference = Object.freeze({ kind: "card" as const, referenceId: request.cardId, sourceUID: request.cardUID });
    const sourceProofId = digest({ matchId: match.matchId, actor: request.actor, uid: request.cardUID,
      sourceEpoch: request.sourceEpoch, paymentId, taskId, continuationId, transactionId: tx,
      decision: choiceData.decision, programFingerprint: request.program.programFingerprint,
      finalResolvedCost: fixed.finalResolvedCost, baseProofId: fixed.baseProofId,
      coverageProofId: fixed.coverageProofId, journalRevision: census.journalRevision,
      candidateSetRevision: census.candidateSetRevision });
    const sourceBinding = Object.freeze({ matchId: match.matchId, actor: request.actor, paymentId,
      sourceReference, sourceProofId, mode: "current" as const, sourceZoneEpoch: request.sourceEpoch,
      taskId, continuationId });
    pins.set(paymentId, Object.freeze({ binding: sourceBinding, cost: fixed.finalResolvedCost,
      issuedAt: match, commandSession: request.commandSession, choiceReceipt: inspectedChoice.receipt,
      choiceData, census,
      baseProofId: fixed.baseProofId, coverageProofId: fixed.coverageProofId }));
    return createDuelCostResolverAuthorityV2(makeDecision, () => verified);
  };
  const costBinding = (request: Readonly<DuelPrintedUnitCostBindingV4>) => {
    try {
      const match = head();
      const tuple = JSON.parse(request.transactionId) as unknown;
      const source = match ? currentCandidates(match).find(candidate => candidate.uid === request.uid) : undefined;
      const census = options.currentJournal().readCostCensus();
      const target = match && source && source.zone.kind === "chain" && source.cardId === request.cardId &&
        source.zoneEpoch === request.sourceEpoch && source.ownerPlayerId === request.actor && source.controllerPlayerId === request.actor;
      const checked = match && target ? program({ match, matchId: match.matchId, dataVersion: match.dataVersion,
        catalogDigest: match.catalogDigest, actor: request.actor, uid: request.uid, cardId: request.cardId,
        sourceEpoch: request.sourceEpoch }) : null;
      const journalBinding = match ? inspectDuelNativeOperationJournalBindingV2(options.currentJournal()) : null;
      const pin = match && Array.isArray(tuple) && text(tuple[3])
        ? pins.get(`printed-unit-chain-v4-payment:${request.actor}:${tuple[3]}`) : undefined;
      const ok = !!match && !!target && !!checked && checked.status === "known" && checked.programFingerprint === request.programFingerprint &&
        !!census && !!journalBinding && journalBinding.head === match && journalBinding.observed === match &&
        match.frame.phase === "main" && !match.frame.stateOpen && Array.isArray(tuple) && tuple.length === 7 && tuple[0] === "printed-unit-chain-v4" && tuple[1] === match.matchId && tuple[2] === request.actor && text(tuple[3]) && tuple[4] === request.uid && tuple[5] === request.sourceEpoch && tuple[6] === request.decision &&
        request.matchId === match.matchId && request.stateVersion === match.stateVersion && request.cardId === match.physicalCardsByUID[request.uid]?.cardId && match.board.bases.some(base => base.ownerPlayerId === request.actor && base.locationId === request.baseLocationId) && request.baseProofId === `printed-unit-chain-v4:base:${request.transactionId}:${census.journalRevision}` && request.coverageProofId === `printed-unit-chain-v4:coverage:${request.transactionId}:${census.journalRevision}` &&
        !!pin && pin.issuedAt === match && pin.baseProofId === request.baseProofId && pin.coverageProofId === request.coverageProofId &&
        pin.choiceData.decision === request.decision && pin.choiceData.sourceProgramFingerprint === request.programFingerprint;
      return { ...request, status: ok ? "complete" as const : "unknown" as const };
    } catch { return { ...request, status: "unknown" as const }; }
  };

  const services: DuelPrintedUnitChainServicesP8 = {
    programs: registry,
    program,
    costForChain,
    costBinding,
    entry,
    closure(request, context) {
      const result = closureFor(request, context);
      if (result.status !== "ready") fail(result.reason ?? "closure pending");
      return { registry: result.registry!, journal: result.journal! };
    },
    sourceAttestor,
    sourceAttestorV4,
    isUnitPrinting(cardId) { return sourceCard(catalog, cardId)?.cardType === "Unit"; },
    choice: Object.freeze({ readHead: () => { const value = head(); if (!value) fail("no current head"); return value; }, readSource, readSourceV4, nextOpaqueId: options.nextOpaqueId }),
    inspectClosure,
  };
  return Object.freeze(services);
}

export const createPrintedUnitChainServicesP8 = createDuelPrintedUnitChainServicesP8;
export const createDuelPrintedUnitPhysicalChainServicesP8 = createDuelPrintedUnitChainServicesP8;
