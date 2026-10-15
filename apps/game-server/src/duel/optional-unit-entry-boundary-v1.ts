/**
 * P4 composition for the narrow whole-pure Accelerate Unit-entry boundary.
 *
 * This callback is deliberately only a proof producer for P6.  It does not
 * select pay/decline, resolve the additional cost, change readiness, or move a
 * card.  Core's optional CardPlay owner remains responsible for those actions.
 */
import {
  enumerateDuelPhaseSourceClosureCandidatesV2,
  type DuelCanonicalPlayingStateV2,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelUnitEntryRequestV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import {
  getCardProgramRegistryForRuntime,
  type CardProgramAuthority,
} from "./card-program-authority.js";
import {
  createDuelOptionalUnitProgramReader,
} from "./optional-unit-services-p4.js";
import type {
  DuelNativeCostCensusV2,
  DuelNativeCostSourceV2,
} from "./operation-journal-v2.js";
import type {
  OptionalUnitEntryBoundaryProofP6,
} from "./optional-unit-native-source-p6.js";

export type { OptionalUnitEntryBoundaryProofP6 } from "./optional-unit-native-source-p6.js";

export interface PureAccelerateEntryBoundaryOptionsV1 {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  /** The one admitted Core head used for the complete proof. */
  readonly currentHead: () => DuelCanonicalPlayingStateV2;
}

export type PureAccelerateEntryBoundaryV1 = (
  request: Readonly<DuelUnitEntryRequestV2>,
  candidates: readonly DuelPhaseSourceClosureCandidateV2[],
  census: DuelNativeCostCensusV2,
) => OptionalUnitEntryBoundaryProofP6 | null;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function safeEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameZone(a: DuelPhaseSourceClosureCandidateV2["zone"],
  b: DuelPhaseSourceClosureCandidateV2["zone"]): boolean {
  const shape = (zone: DuelPhaseSourceClosureCandidateV2["zone"]): boolean => {
    if (zone === null || typeof zone !== "object") return false;
    const keys = zone.kind === "board-base" || zone.kind === "board-battlefield"
      ? ["kind", "locationId"] : ["kind", "zonePlayerId"];
    const own = Reflect.ownKeys(zone);
    return own.length === keys.length && keys.every(key => own.includes(key));
  };
  return shape(a) && shape(b) && same(a, b);
}

/** Compare the complete object carrier, not just its UID. */
function sameCandidate(a: DuelPhaseSourceClosureCandidateV2,
  b: DuelPhaseSourceClosureCandidateV2): boolean {
  const keys = ["uid", "kind", "cardId", "zoneEpoch", "controllerPlayerId", "zone",
    "ownerPlayerId", "locationId", "attachedToUID", "visibility", "carrier"];
  const exactShape = (value: object) => {
    const own = Reflect.ownKeys(value);
    return own.length === keys.length && keys.every(key => own.includes(key));
  };
  if (!exactShape(a) || !exactShape(b)) return false;
  return a.uid === b.uid && a.kind === b.kind && a.cardId === b.cardId &&
    a.zoneEpoch === b.zoneEpoch && a.controllerPlayerId === b.controllerPlayerId &&
    a.ownerPlayerId === b.ownerPlayerId && a.locationId === b.locationId &&
    a.attachedToUID === b.attachedToUID && a.visibility === b.visibility &&
    a.carrier === b.carrier && sameZone(a.zone, b.zone);
}

function sameCensusSource(source: DuelNativeCostSourceV2,
  candidate: DuelPhaseSourceClosureCandidateV2): boolean {
  const keys = ["uid", "sourceEpoch", "cardId", "ownerPlayerId", "controllerPlayerId",
    "programReference", "carrier", "zone", "bindingRevision", "status"];
  const own = Reflect.ownKeys(source);
  if (own.length !== keys.length || !keys.every(key => own.includes(key))) return false;
  return source.carrier === "object" && source.status === "live" &&
    source.uid === candidate.uid && source.cardId === candidate.cardId &&
    source.sourceEpoch === candidate.zoneEpoch &&
    source.ownerPlayerId === candidate.ownerPlayerId &&
    source.controllerPlayerId === candidate.controllerPlayerId &&
    sameZone(source.zone, candidate.zone);
}

function isPureAccelerate(program: { readonly semantics: { readonly kind: string } }): boolean {
  const semantics = program.semantics as unknown as Record<string, unknown>;
  if (Reflect.ownKeys(semantics).length !== 5 ||
      !["kind", "choiceTiming", "optional", "additionalCost", "paidEffect"].every(key =>
        Reflect.ownKeys(semantics).includes(key)) || semantics.kind !== "accelerate") return false;
  const cost = semantics.additionalCost;
  if (!cost || typeof cost !== "object" || Array.isArray(cost) ||
      Reflect.ownKeys(cost).length !== 2 ||
      !["energy", "power"].every(key => Reflect.ownKeys(cost).includes(key)) ||
      (cost as Record<string, unknown>).energy !== 1) return false;
  const powerList = (cost as Record<string, unknown>).power;
  if (!Array.isArray(powerList) || powerList.length !== 1) return false;
  const power = powerList[0] as unknown;
  if (!power || typeof power !== "object" || Array.isArray(power) ||
      Reflect.ownKeys(power).length !== 2 ||
      !["allowedDomains", "amount"].every(key => Reflect.ownKeys(power).includes(key)) ||
      (power as Record<string, unknown>).amount !== 1 ||
      !Array.isArray((power as Record<string, unknown>).allowedDomains)) return false;
  const allowedDomains = (power as Record<string, unknown>).allowedDomains;
  if (!Array.isArray(allowedDomains) || allowedDomains.length !== 1 ||
      typeof allowedDomains[0] !== "string") return false;
  return semantics.choiceTiming === "card-play-choices" && semantics.optional === true &&
    same(semantics.paidEffect, { kind: "enter-ready-replacement", timing: "unit-entry" });
}

/**
 * Source-local absence cases that are complete in the official IR and are
 * evaluated against the current entry target.  A phase-scope query describes
 * potential subevents; it does not say that one of them happened here.
 */
function sourceHasNoEntryEffect(
  candidate: DuelPhaseSourceClosureCandidateV2,
  program: { readonly source: { readonly cardType: string }; readonly semantics: unknown },
  target: DuelPhaseSourceClosureCandidateV2,
  candidates: readonly DuelPhaseSourceClosureCandidateV2[],
  request: Readonly<DuelUnitEntryRequestV2>,
  head: DuelCanonicalPlayingStateV2,
): boolean {
  const semantics = program.semantics as Record<string, unknown>;
  if (candidate.zone.kind === "chain") return false;
  if (semantics.kind === "no-ability") {
    const playability = semantics.playability;
    return program.source.cardType === "Unit" && playability !== null &&
      typeof playability === "object" && !Array.isArray(playability) &&
      Reflect.ownKeys(playability).length === 4 &&
      ["kind", "fromHand", "energyCost", "tokenOnly"].every(key =>
        Reflect.ownKeys(playability).includes(key)) &&
      ((playability as Record<string, unknown>).kind === "printed-unit" ||
        (playability as Record<string, unknown>).kind === "recruit-token") &&
      typeof (playability as Record<string, unknown>).fromHand === "boolean" &&
      ((playability as Record<string, unknown>).energyCost === null ||
        Number.isSafeInteger((playability as Record<string, unknown>).energyCost)) &&
      typeof (playability as Record<string, unknown>).tokenOnly === "boolean";
  }
  if (semantics.kind === "basic-rune") {
    const abilities = semantics.abilities;
    return program.source.cardType === "Rune" && candidate.kind === "rune" &&
      Array.isArray(abilities) && abilities.length === 2 &&
      abilities.every(ability => {
        if (!ability || typeof ability !== "object" || Array.isArray(ability)) return false;
        const value = ability as Record<string, unknown>;
        return value.event === "activate" && value.sourceScope === "source-basic-rune" &&
          (value.kind === "basic-rune-energy" || value.kind === "basic-rune-power");
      });
  }
  if (semantics.kind === "spell-resolution") {
    // A physical Spell outside Chain is not the Spell currently resolving. The
    // source IR is still required; card type/text shortcuts are not accepted.
    const effects = semantics.effects;
    return program.source.cardType === "Spell" && Array.isArray(effects) &&
      effects.length === 1 && candidate.uid !== target.uid;
  }
  if (isPureAccelerate(program as { readonly semantics: { readonly kind: string } })) {
    // Accelerate is self-only. A different physical Unit in any admitted
    // non-Chain zone cannot affect this target's entry.
    return candidate.uid !== target.uid && program.source.cardType === "Unit";
  }
  if (semantics.kind === "compound-vi-self") {
    // The Fury roster's Vi printing is a whole compound program: Ganking only
    // grants standard movement, while activate is an explicit source-unit
    // action with a trash choice and self Might effect. Neither runs during a
    // different Unit's Card-from-Hand entry.
    return candidate.uid !== target.uid && program.source.cardType === "Unit" &&
      same(semantics, {
        kind: "compound-vi-self", sourceScope: "source-unit-on-board",
        ganking: { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" },
        activation: { event: "activate", sourceScope: "source-unit-on-board",
          costs: [{ kind: "recycle-from-trash", amount: 1, selector: "one-card",
            zone: "controller-trash", payer: "ability-controller" }],
          effects: [{ kind: "add-might", amount: 1, recipient: "ability-source-unit",
            duration: "this-turn" }] },
      });
  }
  if (semantics.kind === "deflect") {
    // CR 809.1.c/d is scoped to a Spell or Ability choosing the source Unit.
    // This entry is a plain Unit CardPlay and contains no such choice. The
    // exact shape prevents a future Deflect-like opcode from inheriting this
    // no-effect result.
    return candidate.uid !== target.uid && program.source.cardType === "Unit" &&
      same(semantics, {
        kind: "deflect", sourceScope: "source-unit-on-board", event: "opponent-choice",
        modifier: { kind: "additional-opponent-power-cost", amount: 1,
          powerDomain: "wildcard", payer: "opponent", timing: "additional-play-cost",
          per: "each-choice-of-source", optional: false, automaticPayment: false,
          choice: { source: "spell-or-ability", target: "source-unit-on-board" } },
      });
  }
  if (semantics.kind === "static") {
    const abilities = semantics.abilities;
    if (program.source.cardType !== "Unit" || !Array.isArray(abilities) || abilities.length === 0 ||
        abilities.some(ability => {
          if (!ability || typeof ability !== "object" || Array.isArray(ability)) return true;
          const value = ability as Record<string, unknown>;
          return Reflect.ownKeys(value).length !== 4 || value.subject !== "self" ||
            value.mode !== (value.scope === "unit-enter" ? "replacement" : "permission") ||
            (value.kind !== "ganking" && value.kind !== "enter-ready") ||
            (value.scope !== "standard-move" && value.scope !== "unit-enter");
        })) return false;
    // The reviewed static templates only apply to the source object itself.
    return candidate.uid !== target.uid;
  }
  if (semantics.kind === "trigger") {
    if (semantics.event === "hold" || semantics.event === "conquer") return true;
    if (semantics.event === "unit-enter") {
      return semantics.sourceScope === "played-source-unit" && candidate.uid !== target.uid;
    }
    if (semantics.event === "play-gear") {
      return semantics.sourceScope === "controller-plays-gear" && target.kind === "unit" &&
        target.cardId !== null;
    }
    if (semantics.event === "card-play-on-opponent-turn") {
      return semantics.sourceScope === "controller-plays-card-on-opponent-turn" &&
        head.frame.turnPlayerId === request.actor;
    }
    return false;
  }
  if (semantics.kind === "activated") {
    // Only the reviewed full opcode is admitted. Its event is an explicit
    // activation, and the closed native census contains no activation work.
    return same(semantics, {
      kind: "activated", event: "activate", sourceScope: "ability-source",
      costs: [{ kind: "energy", amount: 1, payer: "ability-controller" },
        { kind: "exhaust-source" }],
      effects: [{ kind: "play-recruit-token", token: {
        kind: "unit-token", cardType: "Unit", domains: [], domainless: true,
        tags: ["Recruit"], energy: null, power: null, might: 1,
        physicalPrintingCardId: null,
      }, controller: "effect-controller", owner: "effect-controller",
      destination: "executor-defined", resolution: "deferred-token-play" }],
    });
  }
  if (semantics.kind === "passive") {
    if (semantics.event === "hide") {
      return semantics.sourceScope === "source-battlefield" && same(semantics.modifier, {
        kind: "additional-hide-permission", amount: 1, optional: true, scope: "source-battlefield",
      });
    }
    if (semantics.event === "attacker") {
      const modifier = semantics.modifier as Record<string, unknown>;
      return semantics.sourceScope === "source-unit-on-board" && modifier?.kind === "self-assault" &&
        modifier.amount === (modifier.amount as number) && Number.isSafeInteger(modifier.amount);
    }
    return false;
  }
  if (semantics.kind === "continuous") {
    const modifier = semantics.modifier as Record<string, unknown>;
    if (program.source.cardType !== "Unit" || semantics.sourceScope !== "source-unit-on-board" ||
        !modifier || modifier.kind !== "token-unit-might" || modifier.amount !== 1 ||
        modifier.controller !== "ability-controller" || modifier.scope !== "board") return false;
    // A physical target is not a token. A live token in the same source census
    // keeps the current scope open, so absence cannot be asserted globally.
    return target.uid !== candidate.uid && target.cardId !== null && target.kind === "unit" &&
      !candidates.some(item => item.uid !== target.uid && item.kind === "unit" && item.cardId === null);
  }
  return false;
}

function targetBinding(
  options: PureAccelerateEntryBoundaryOptionsV1,
  request: Readonly<DuelUnitEntryRequestV2>,
  head: DuelCanonicalPlayingStateV2,
) {
  const reader = createDuelOptionalUnitProgramReader(options);
  const source = reader.readSource(head, request.actor, request.uid);
  if (source.matchId !== request.matchId || source.uid !== request.uid ||
      source.actor !== request.actor || source.cardId !== request.cardId ||
      source.sourceEpoch !== request.sourceEpoch ||
      source.sourceProgramFingerprint !== request.programId) return null;
  const binding = reader.describe({
    match: head,
    matchId: request.matchId,
    dataVersion: head.dataVersion,
    catalogDigest: head.catalogDigest,
    actor: request.actor,
    uid: request.uid,
    cardId: request.cardId,
    sourceEpoch: request.sourceEpoch,
  });
  if (binding.programFingerprint !== request.programId ||
      binding.description.status !== "known" ||
      binding.description.semantics.kind !== "accelerate") return null;
  return binding;
}

function exactCandidates(
  head: DuelCanonicalPlayingStateV2,
  candidates: readonly DuelPhaseSourceClosureCandidateV2[],
  census: DuelNativeCostCensusV2,
): boolean {
  if (!Array.isArray(candidates) || !Array.isArray(census.sources) ||
      candidates.length === 0 || census.sources.length !== candidates.length ||
      census.phaseClosed !== false || census.unresolvedNativeHistory ||
      census.matchId !== head.matchId || census.stateVersion !== head.stateVersion ||
      census.eventSeq !== head.eventSeq || !safeEpoch(census.journalRevision) ||
      !safeEpoch(census.candidateSetRevision)) return false;
  const actual = enumerateDuelPhaseSourceClosureCandidatesV2(head);
  if (actual.length !== candidates.length ||
      new Set(actual.map(item => item.uid)).size !== actual.length ||
      new Set(candidates.map(item => item.uid)).size !== candidates.length ||
      new Set(census.sources.map(item => item.uid)).size !== census.sources.length) return false;
  const supplied = new Map(candidates.map(item => [item.uid, item]));
  const actualByUID = new Map(actual.map(item => [item.uid, item]));
  const censusByUID = new Map(census.sources.map(item => [item.uid, item]));
  for (const [uid, candidate] of supplied) {
    const current = actualByUID.get(uid);
    const source = censusByUID.get(uid);
    if (!current || !source || !sameCandidate(candidate, current) ||
        !safeEpoch(candidate.zoneEpoch) || !safeEpoch(source.bindingRevision) ||
        source.bindingRevision !== census.candidateSetRevision ||
        !sameCensusSource(source, candidate)) return false;
  }
  return true;
}

/** Build a callback accepted by `createOptionalUnitNativeSourceP6`. */
export function createP4PureAccelerateEntryBoundaryV1(
  options: PureAccelerateEntryBoundaryOptionsV1,
): PureAccelerateEntryBoundaryV1 {
  const registry = getCardProgramRegistryForRuntime(options.programs);
  let busy = false;
  let reentered = false;
  const callback: PureAccelerateEntryBoundaryV1 = (request, candidates, census) => {
    if (busy) {
      reentered = true;
      return null;
    }
    busy = true;
    reentered = false;
    try {
      const head = options.currentHead();
      if (!head || head !== request.match || head.stage !== "playing" ||
          head.matchId !== request.matchId || head.stateVersion !== request.stateVersion ||
          head.eventSeq !== request.eventSeq ||
          head.dataVersion !== options.catalog.publicCatalog.dataVersion ||
          head.catalogDigest !== options.catalog.publicCatalog.digest ||
          options.programs.catalogStamp.dataVersion !== head.dataVersion ||
          options.programs.catalogStamp.digest !== head.catalogDigest ||
          head.frame.phase !== "main" || !head.frame.stateOpen ||
          head.frame.priorityPlayerId !== request.actor ||
          head.frame.turnPlayerId !== request.actor ||
          ("chainCards" in head && Array.isArray(head.chainCards) && head.chainCards.length !== 0) ||
          reentered ||
          !text(request.actor) || !text(request.uid) || !text(request.cardId) ||
          !text(request.programId) || !safeEpoch(request.sourceEpoch) ||
          !text(request.baseLocationId) || !exactCandidates(head, candidates, census)) return null;

      const target = candidates.find(candidate => candidate.uid === request.uid);
      if (!target || target.carrier !== "object" || target.cardId !== request.cardId ||
          target.zone.kind !== "hand" || target.zone.zonePlayerId !== request.actor ||
          target.ownerPlayerId !== request.actor || target.zoneEpoch !== request.sourceEpoch) return null;
      const physical = head.physicalCardsByUID[request.uid];
      if (!physical || physical.cardId !== request.cardId ||
          physical.ownerPlayerId !== request.actor || physical.zoneEpoch !== request.sourceEpoch) return null;
      if (!head.board.bases.some(base => base.locationId === request.baseLocationId &&
          base.ownerPlayerId === request.actor)) return null;

      const targetDescription = targetBinding(options, request, head);
      if (!targetDescription) return null;
      const targetProgram = registry.getProgram(request.cardId);
      if (!targetProgram || targetProgram.cardId !== request.cardId ||
          targetProgram.programId !== `riftbound-duel-official-v1:${request.cardId}` ||
          targetProgram.source.cardType !== "Unit" ||
          targetProgram.source.dataVersion !== head.dataVersion ||
          targetProgram.source.sourceCatalogDigest !== head.catalogDigest ||
          !isPureAccelerate(targetProgram) ||
          !same(targetProgram.semantics, targetDescription.description.semantics)) return null;

      const sources: OptionalUnitEntryBoundaryProofP6["sources"][number][] = [];
      for (const candidate of candidates) {
        if (candidate.cardId === null || !safeEpoch(candidate.zoneEpoch) ||
            candidate.carrier !== "object" || !candidate.ownerPlayerId) return null;
        const program = registry.getProgram(candidate.cardId);
        if (!program || program.cardId !== candidate.cardId ||
            program.source.dataVersion !== head.dataVersion ||
            program.source.sourceCatalogDigest !== head.catalogDigest) return null;
        const programReference = options.programs.resolvedProgramReference(candidate.cardId);
        if (candidate.uid === request.uid) {
          const targetReference = census.sources.find(source => source.uid === candidate.uid)?.programReference;
          if (targetReference !== null && (!programReference || targetReference !== programReference.encodedReference)) return null;
        } else if (!programReference || programReference.programId !== program.programId ||
            census.sources.find(source => source.uid === candidate.uid)?.programReference !==
              programReference.encodedReference) return null;
        if (candidate.uid === request.uid) {
          if (!isPureAccelerate(program) ||
              !same(program.semantics, targetProgram.semantics)) return null;
        } else if (!sourceHasNoEntryEffect(candidate, program, target, candidates, request, head)) return null;
        sources.push({ candidate, programId: candidate.uid === request.uid
          ? request.programId : program.programId, disposition: "known-no-effect" });
      }
      if (sources.length !== candidates.length ||
          options.currentHead() !== head || reentered) return null;
      return Object.freeze({
        matchId: request.matchId,
        stateVersion: request.stateVersion,
        eventSeq: request.eventSeq,
        actor: request.actor,
        uid: request.uid,
        cardId: request.cardId,
        sourceEpoch: request.sourceEpoch,
        baseLocationId: request.baseLocationId,
        programId: request.programId,
        sources: Object.freeze(sources),
        scopes: Object.freeze({ play: "clear", replacement: "clear", static: "clear",
          trigger: "clear", pendingTasks: "clear", chain: "clear" }),
      });
    } catch {
      return null;
    } finally {
      busy = false;
    }
  };
  return callback;
}

