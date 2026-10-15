/** Private Spell composition for the P4 owner. The owner retains the sole head,
 * command namespace, receipt store and native-path labels. */
import { createHash } from "node:crypto";
import { normalizeAbilityText } from "@riftbound/card-dsl/duel";
import {
  bindDuelPrintedCost, createDuelCostResolverAuthorityV2,
  createDuelSpellCardPlaySessionV2, enumerateDuelPhaseSourceClosureCandidatesV2,
  fingerprintDuelCostCoverageV2, fingerprintDuelCostModifierV2, inspectDuelChainCommittedProofV2,
  inspectDuelChainPrivateStateV2,
  inspectDuelSpellResolutionBindingV2, inspectDuelNativeCommitPathV2,
  inspectDuelSpellChainFirstLifecycleProofV3,
  inspectDuelSpellChainFirstResolvedProofV3,
  type DuelCanonicalPlayingStateV2, type DuelCommandSessionV2,
  type DuelCostRequestV2, type DuelCostVerifiedSourcesV2,
  type DuelCostModifierV2,
  type DuelNativeCommitV2, type DuelSourceAttestorV2,
  type DuelSpellCardPlayResultV2, type DuelSpellCardPlayServicesV2,
  type DuelSpellCardPlaySessionV2, type DuelSpellCostBindingV2,
  type DuelSpellCommandDispatcherV2, type DuelSpellResolutionBindingV2,
  type DuelSpellChainFirstCostRequestV3, type DuelSpellChainFirstLifecycleProofV3,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import { getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import type { DuelNativeOperationJournalV2, DuelNativeOperationPathV2,
  DuelNativeCostCensusV2 } from "./operation-journal-v2.js";

export interface P4SpellServicesOptions {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  readonly getOperationHead: () => DuelCanonicalPlayingStateV2;
  readonly setOperationHead: (head: DuelCanonicalPlayingStateV2) => void;
  readonly currentJournal: () => DuelNativeOperationJournalV2;
  /** Owner labels every Core commit in the actual native path. */
  readonly observeNativePath: (request: Readonly<{
    readonly ancestor: DuelCanonicalPlayingStateV2;
    readonly descendant: DuelCanonicalPlayingStateV2;
    readonly commits: readonly DuelNativeCommitV2[];
    readonly stage: "spell-play" | "spell-progress" | "spell-resolution";
  }>) => DuelNativeOperationPathV2;
  readonly dispatcher: DuelSpellCommandDispatcherV2;
  readonly sourceAttestor: DuelSourceAttestorV2;
  readonly closure: DuelSpellCardPlayServicesV2["closure"];
  readonly uidFactory: () => string;
  /** DATA-only owner snapshot of claim, finish, committed receipt and notification state. */
  readonly dispatcherSnapshot: () => unknown;
}

export interface P4SpellServices {
  readonly coreServices: DuelSpellCardPlayServicesV2;
  readonly createSession: (commandSession: DuelCommandSessionV2) => DuelSpellCardPlaySessionV2;
  /** Publish each Core result before invoking another Spell/Unit/Turn action. */
  readonly handoff: (result: DuelSpellCardPlayResultV2) => void;
  readonly verifiedCostSource: (request: DuelCostRequestV2) => DuelCostVerifiedSourcesV2;
  /** Include this frozen private DATA in the owner's complete private fingerprint. */
  readonly privateFingerprintData: () => Readonly<Record<string, unknown>>;
}

function fail(message: string): never { throw new TypeError(`P4 Spell services: ${message}`); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function safe(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
function dataCopy(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value)) fail("private owner snapshot must be DATA");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && proto !== Array.prototype)
    fail("private owner snapshot contains an opaque handle");
  seen.add(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) fail("private owner snapshot has a sparse or extended array");
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) fail("private owner snapshot contains an accessor");
      out.push(dataCopy(descriptor.value, seen));
    }
    seen.delete(value);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key === "__proto__") fail("private owner snapshot has a non-DATA key");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) fail("private owner snapshot contains an accessor");
    out[key] = dataCopy(descriptor.value, seen);
  }
  seen.delete(value);
  return out;
}
function transaction(request: DuelCostRequestV2, head: DuelCanonicalPlayingStateV2):
  { readonly actor: string; readonly commandId: string; readonly uid: string; readonly epoch: number } {
  let value: unknown;
  try { value = JSON.parse(request.transactionId); } catch { fail("invalid Spell cost transaction"); }
  if (!Array.isArray(value) || value.length !== 6 || value[0] !== head.matchId ||
      value[1] !== head.stateVersion || !text(value[2]) || !text(value[3]) ||
      !text(value[4]) || !safe(value[5])) fail("stale or foreign Spell cost transaction");
  return { actor: value[2], commandId: value[3], uid: value[4], epoch: value[5] };
}

const DRAW_SPELL_EFFECTS: ReadonlySet<string> = new Set(["draw-cards"]);
const KILL_SPELL_EFFECTS: ReadonlySet<string> = new Set(["draw-cards", "kill-unit", "kill-units"]);

export function createP4SpellServices(options: P4SpellServicesOptions): P4SpellServices {
  return createSpellServices(options, DRAW_SPELL_EFFECTS, "hand");
}

/** Opt-in cost and Core service composition for complete single-effect Kill Spells. */
export function createP4KillSpellServicesV1(options: P4SpellServicesOptions): P4SpellServices {
  const registry = getCardProgramRegistryForRuntime(options.programs);
  if (options.programs.catalogStamp.dataVersion !== options.catalog.publicCatalog.dataVersion ||
      options.programs.catalogStamp.digest !== options.catalog.publicCatalog.digest ||
      registry.size !== options.catalog.publicCatalog.cards.length ||
      options.catalog.publicCatalog.cards.some(card => {
        const program = registry.getProgram(card.id);
        if (!program) return false;
        const source = program.source;
        return source.cardId !== card.id || source.cardType !== card.cardType ||
          source.normalizedAbilityText !== normalizeAbilityText(card.ability) || source.energy !== card.energy ||
          source.power !== card.power || source.might !== card.might ||
          source.canonicalCardId !== card.canonicalCardId || source.name !== card.name ||
          source.fullName !== card.fullName || source.localizedName !== (card.localizedName ?? "") ||
          source.setCode !== card.setCode || source.cardNumber !== card.cardNumber ||
          source.variant !== card.variant ||
          JSON.stringify(source.domains) !== JSON.stringify(card.domains) ||
          JSON.stringify(source.tags) !== JSON.stringify(card.tags);
      }))
    fail("Spell program authority is not bound to the current catalog");
  return createSpellServices(options, KILL_SPELL_EFFECTS, "hand");
}

const POINT_SPELL_EFFECTS: ReadonlySet<string> = new Set(["point-damage"]);

/**
 * Explicit production opt-in for the four source-reviewed Point Damage
 * printings.  The returned service enters Core only through Chain-first V3;
 * the legacy Hand-first factory above cannot admit this semantic tag.
 */
export function createP4PointDamageSpellServicesV1(options: P4SpellServicesOptions): P4SpellServices {
  const registry = getCardProgramRegistryForRuntime(options.programs);
  if (options.programs.catalogStamp.dataVersion !== options.catalog.publicCatalog.dataVersion ||
      options.programs.catalogStamp.digest !== options.catalog.publicCatalog.digest ||
      registry.size !== options.catalog.publicCatalog.cards.length ||
      options.catalog.publicCatalog.cards.some(card => {
        const program = registry.getProgram(card.id);
        if (!program) return false;
        const source = program.source;
        return source.cardId !== card.id || source.cardType !== card.cardType ||
          source.normalizedAbilityText !== normalizeAbilityText(card.ability) || source.energy !== card.energy ||
          source.power !== card.power || source.might !== card.might ||
          source.canonicalCardId !== card.canonicalCardId || source.name !== card.name ||
          source.fullName !== card.fullName || source.localizedName !== (card.localizedName ?? "") ||
          source.setCode !== card.setCode || source.cardNumber !== card.cardNumber ||
          source.variant !== card.variant || JSON.stringify(source.domains) !== JSON.stringify(card.domains) ||
          JSON.stringify(source.tags) !== JSON.stringify(card.tags);
      }))
    fail("Point Spell program authority is not bound to the current catalog");
  if (!options.closure?.pointDamage) fail("Point Spell damage/cleanup closure is required");
  return createSpellServices(options, POINT_SPELL_EFFECTS, "chain-point");
}

function createSpellServices(options: P4SpellServicesOptions,
  supportedEffects: ReadonlySet<string>, mode: "hand" | "chain-point"): P4SpellServices {
  if (typeof options.dispatcher.notifyCommitted !== "function" ||
      typeof options.dispatcherSnapshot !== "function" || typeof options.uidFactory !== "function")
    fail("parent dispatcher, private snapshot and identity tape are required");
  const registry = getCardProgramRegistryForRuntime(options.programs);
  const cardById = new Map(options.catalog.publicCatalog.cards.map(card => [card.id, card]));
  const identityTape: string[] = [];
  const notified = new Map<string, { readonly proof: object; readonly head: DuelCanonicalPlayingStateV2;
    readonly business: string; acknowledged: boolean }>();
  const chainSnapshots = new Map<string, {
    readonly request: DuelSpellChainFirstCostRequestV3;
    readonly proof: DuelSpellChainFirstLifecycleProofV3;
    readonly head: DuelCanonicalPlayingStateV2;
    readonly census: ReturnType<DuelNativeOperationJournalV2["readCostCensus"]> extends infer C ? Exclude<C, null> : never;
    readonly verified: DuelCostVerifiedSourcesV2;
    readonly fingerprints: ReturnType<typeof fingerprintDuelCostCoverageV2>;
    readonly printed: ReturnType<typeof bindDuelPrintedCost>;
    readonly authority: ReturnType<typeof createDuelCostResolverAuthorityV2>;
  }>();
  let binding: DuelSpellResolutionBindingV2 | undefined;
  const journal = () => options.currentJournal();

  const registerChainEntry = (match: DuelCanonicalPlayingStateV2, uid: string, epoch: number,
    item: DuelSpellChainFirstCostRequestV3["chain"]["items"][number]) => {
    const chainCard = match.chainCards?.find(card => card.uid === uid);
    const source = enumerateDuelPhaseSourceClosureCandidatesV2(match).find(candidate =>
      candidate.uid === uid && candidate.zoneEpoch === epoch && candidate.zone.kind === "chain");
    const entry = [...journal().listCommits()].reverse().find(commit =>
      commit.transitions.some(step => step.uid === uid && step.from.kind === "hand" &&
        step.to.kind === "chain" && step.toZoneEpoch === epoch) &&
      (() => { try { inspectDuelNativeCommitPathV2(commit.after, match); return true; }
        catch { return false; } })());
    if (!entry || !chainCard || !source || !source.cardId || !binding ||
        chainCard.controllerPlayerId !== source.controllerPlayerId ||
        item.controllerPlayerId !== source.controllerPlayerId ||
        !options.programs.resolvedProgramReference(source.cardId))
      fail("native Chain source/program/item mismatch");
    const existing = journal().readCostCensus()?.sources.find(candidate =>
      candidate.carrier === "runtime-effect" && candidate.ledger === "chain" &&
      candidate.effectId === item.id);
    if (existing) {
      if (existing.status !== "pending" || existing.sourceUID !== uid ||
          existing.sourceEpoch !== epoch || existing.cardId !== source.cardId)
        fail("foreign Chain runtime effect");
      return;
    }
    const context = { matchId: match.matchId, dataVersion: match.dataVersion,
      catalogDigest: match.catalogDigest, turn: match.frame.turnNumber,
      taskId: `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:spell:${item.id}`,
      phase: "main" as const, event: "chain" as const,
      clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } };
    journal().registerRuntimeEffect({ ledger: "chain", operationId: entry.label.operationId, context,
      entry: { effectId: item.id, eventId: entry.label.eventId, kind: "chain-effect",
        sourceUID: source.uid, sourceZoneEpoch: epoch, cardId: source.cardId,
        controllerPlayerId: source.controllerPlayerId, zone: source.zone,
        programReference: options.programs.resolvedProgramReference(source.cardId)!.encodedReference },
      resolutionBinding: { authority: binding.resolutionAuthority,
        chainId: binding.chainId, executorId: binding.executorId } });
  };

  const snapshotFor = (request: DuelCostRequestV2) => {
    if (request.kind !== "card-play") fail("unsupported cost request");
    const head = options.getOperationHead();
    const tx = transaction(request, head);
    const census = journal().readCostCensus();
    if (!census || census.matchId !== head.matchId || census.stateVersion !== head.stateVersion ||
        census.eventSeq !== head.eventSeq || census.unresolvedNativeHistory || census.phaseClosed !== false ||
        census.sources.length === 0) fail("missing exact native cost census");
    const subject = census.sources.find(source => source.carrier === "object" && source.uid === tx.uid &&
      source.cardId === request.subjectId && source.sourceEpoch === tx.epoch &&
      source.ownerPlayerId === tx.actor && source.zone.kind === "hand" &&
      source.zone.zonePlayerId === tx.actor);
    if (!subject) fail("Spell source is not the current owned Hand card");
    const physical = head.physicalCardsByUID[tx.uid];
    if (!physical || physical.cardId !== request.subjectId || physical.ownerPlayerId !== tx.actor ||
        physical.zoneEpoch !== tx.epoch) fail("physical Spell binding changed");
    const card = cardById.get(request.subjectId);
    const spell = registry.getProgram(request.subjectId);
    if (!card || card.cardType !== "Spell" || !spell || spell.semantics.kind !== "spell-resolution" ||
        spell.semantics.effects.length !== 1 ||
        !supportedEffects.has(spell.semantics.effects[0].kind) ||
        !options.programs.resolvedProgramReference(request.subjectId)) fail("unsupported Spell cost slice");
    const printed = bindDuelPrintedCost(card);
    if (printed.kind !== "numeric") fail("unresolved printed Spell cost");
    const seen = new Set<string>();
    const candidates = census.sources.flatMap(source => {
      if (!text(source.uid) || !safe(source.sourceEpoch) || !safe(source.bindingRevision) ||
          !text(source.programReference) ||
          !text(source.controllerPlayerId) && source.zone.kind !== "board-battlefield" &&
            !["hand", "main-deck", "trash", "rune-deck", "champion-zone", "legend-zone"].includes(source.zone.kind) ||
          !text(source.ownerPlayerId) && source.carrier !== "runtime-effect" &&
            source.zone.kind !== "board-battlefield")
        fail("unbound native cost source");
      const key = JSON.stringify([source.carrier, source.uid, source.sourceEpoch,
        source.ledger ?? null, source.effectId ?? null]);
      if (seen.has(key)) fail("duplicate native cost source");
      seen.add(key);
      if (source.cardId !== null) {
        const reference = options.programs.resolvedProgramReference(source.cardId);
        const program = registry.getProgram(source.cardId);
        if (!reference || !program || reference.encodedReference !== source.programReference ||
            program.source.dataVersion !== head.dataVersion ||
            program.source.sourceCatalogDigest !== head.catalogDigest) fail("unknown source program");
        // The current complete IR has no card-play cost modifier. Review every new kind here.
        switch (program.semantics.kind) {
          case "no-ability": case "basic-rune": case "spell-resolution":
          case "trigger": case "activated": case "passive": case "static": case "continuous": break;
          default: fail("unreviewed source semantics");
        }
      } else {
        let tokenReference: unknown;
        try { tokenReference = JSON.parse(source.programReference); }
        catch { fail("unknown token program"); }
        if (!tokenReference || typeof tokenReference !== "object" ||
            !("kind" in tokenReference) ||
            tokenReference.kind !== "duel-intrinsic-token-ability-reference" &&
              tokenReference.kind !== "recruit-birth-reference")
          fail("unknown token program");
      }
      if (source.carrier === "runtime-effect" && (!text(source.effectId) || !source.ledger ||
          source.status === "pending" && source.ledger !== "chain"))
        fail("unresolved runtime cost relevance");
      if (source.carrier === "runtime-effect" && !census.sources.some(bound =>
        bound.uid === source.sourceUID && bound.sourceEpoch === source.sourceEpoch &&
        bound.cardId === source.cardId && bound.controllerPlayerId === source.controllerPlayerId &&
        bound.programReference === source.programReference &&
        (bound.carrier === "object" || bound.carrier === "pre-exit")))
        fail("runtime cost source has no lifecycle binding");
      if (source.carrier === "source-work" && source.status !== "resolved")
        fail("unresolved source work");
      // Source-work is a lifecycle obligation on the already counted object,
      // not another independently payable UID/epoch.
      return source.carrier === "source-work" ? [] : [{ sourceUid: source.uid,
        sourceEpoch: source.sourceEpoch, choice: "not-applicable" as const,
        modifierIds: [] as readonly string[] }];
    });
    if (options.getOperationHead() !== head || journal().readCostCensus()?.journalRevision !== census.journalRevision)
      fail("cost census changed during read");
    const verified: DuelCostVerifiedSourcesV2 = {
      registryRevision: `${head.catalogDigest}:${census.journalRevision}:${census.candidateSetRevision}`,
      catalogRevision: `${head.dataVersion}:${head.catalogDigest}`,
      nonResourceCosts: "none", base: { cost: printed.cost, sourceUid: tx.uid, sourceEpoch: tx.epoch },
      candidates, orderedModifiers: [],
    };
    return { head, tx, census, printed, verified, fingerprints: fingerprintDuelCostCoverageV2(verified) };
  };

  /** Build the Point cost snapshot from the post-move native Chain head. */
  const chainSnapshotFor = (request: DuelSpellChainFirstCostRequestV3) => {
    if (mode !== "chain-point") fail("Point Spell requires the production Chain-first factory");
    const lifecycle = inspectDuelSpellChainFirstLifecycleProofV3(request);
    if (!lifecycle || lifecycle.request !== request || lifecycle.match !== request.match ||
        lifecycle.commandSession !== request.commandSession || lifecycle.chain !== request.chain ||
        lifecycle.cardUID !== request.cardUID || lifecycle.cardId !== request.cardId ||
        lifecycle.controller !== request.controller || lifecycle.sourceEpoch !== request.sourceEpoch ||
        lifecycle.transactionId !== request.transactionId ||
        JSON.stringify(lifecycle.targetUIDs) !== JSON.stringify(request.targetUIDs))
      fail("missing native Chain-first lifecycle proof");
    const head = request.match;
    if (head.stage !== "playing" || head.stateVersion !== lifecycle.stateVersion ||
        request.chain.stateVersion !== lifecycle.chainVersion || request.chain.items.at(-1)?.id !== lifecycle.chainItemId ||
        request.chain.items.at(-1)?.controllerPlayerId !== request.controller)
      fail("stale or foreign Chain-first head");
    const values: unknown = (() => { try { return JSON.parse(request.transactionId); } catch { return null; } })();
    if (!Array.isArray(values) || (values.length !== 6 && values.length !== 7) ||
        values[0] !== head.matchId || values[1] !== head.stateVersion || values[2] !== request.controller ||
        !text(values[3]) || values[4] !== request.cardUID || values[5] !== request.sourceEpoch ||
        values.length === 7 && JSON.stringify(values[6]) !== JSON.stringify(request.targetUIDs))
      fail("invalid Chain-first Point transaction");
    const candidate = enumerateDuelPhaseSourceClosureCandidatesV2(head).find(source =>
      source.uid === request.cardUID && source.cardId === request.cardId && source.zone.kind === "chain" &&
      source.zoneEpoch === request.sourceEpoch && source.controllerPlayerId === request.controller);
    if (!candidate) fail("Point Spell source is not the current native Chain card");
    const physical = head.physicalCardsByUID[request.cardUID];
    if (!physical || physical.cardId !== request.cardId || physical.ownerPlayerId !== request.controller ||
        physical.zoneEpoch !== request.sourceEpoch) fail("Point Spell physical Chain binding changed");
    // Core invokes this callback synchronously after the native Hand -> Chain
    // commit and before the owner receives the result. Bind that exact ancestry
    // into the protected journal now; clones or foreign heads fail in observe.
    if (options.getOperationHead() !== head) {
      observe(head, "spell-play");
      if (options.getOperationHead() !== head || journal().observedHead() !== head)
        fail("native Point Chain handoff was not synchronous");
    }
    registerChainEntry(head, request.cardUID, request.sourceEpoch, request.chain.items.at(-1)!);
    const card = cardById.get(request.cardId);
    const spell = registry.getProgram(request.cardId);
    if (!card || card.cardType !== "Spell" || !spell || spell.semantics.kind !== "point-damage-spell-resolution" ||
        spell.semantics.effects.length !== 1 || spell.semantics.effects[0]?.kind !== "point-damage" ||
        !options.programs.resolvedProgramReference(request.cardId)) fail("unsupported Point Spell source");
    const printed = bindDuelPrintedCost(card);
    if (printed.kind !== "numeric") fail("unresolved Point Spell printed cost");
    const census = journal().readCostCensus();
    if (!census || census.matchId !== head.matchId || census.stateVersion !== head.stateVersion ||
        census.eventSeq !== head.eventSeq || census.unresolvedNativeHistory || census.phaseClosed !== false ||
        census.sources.length === 0 || journal().observedHead() !== head)
      fail("missing exact native Chain cost census");
    const censusSource = census.sources.find(source => source.carrier === "object" && source.uid === request.cardUID &&
      source.cardId === request.cardId && source.sourceEpoch === request.sourceEpoch && source.zone.kind === "chain" &&
      source.controllerPlayerId === request.controller);
    if (!censusSource || censusSource.programReference !== options.programs.resolvedProgramReference(request.cardId)?.encodedReference)
      fail("Point Spell Chain census has no bound source");
    const targetUIDs = request.targetUIDs === null ? [] : [...request.targetUIDs];
    if (targetUIDs.length !== 1) fail("Point Spell requires one native target");
    const targetUID = targetUIDs[0]!;
    const target = head.board.units.find(unit => unit.objectId === targetUID);
    if (!target) fail("Point Spell target left the native board");
    const sourceCandidates = census.sources;
    const seen = new Set<string>();
    const modifiers: DuelCostModifierV2[] = [];
    const candidates = sourceCandidates.flatMap(source => {
      if (!text(source.uid) || !safe(source.sourceEpoch) || !safe(source.bindingRevision) ||
          !text(source.programReference) || !text(source.controllerPlayerId) && source.zone.kind !== "board-battlefield" &&
            !["hand", "main-deck", "trash", "rune-deck", "champion-zone", "legend-zone"].includes(source.zone.kind) ||
          !text(source.ownerPlayerId) && source.carrier !== "runtime-effect" && source.zone.kind !== "board-battlefield")
        fail("unbound native Point cost source");
      const sourceWork = source.carrier === "source-work";
      if (sourceWork && source.status !== "resolved") fail("unresolved Point source work");
      if (!sourceWork) {
        const key = JSON.stringify([source.carrier, source.uid, source.sourceEpoch,
          source.ledger ?? null, source.effectId ?? null]);
        if (seen.has(key)) fail("duplicate native Point cost source");
        seen.add(key);
      }
      if (source.cardId !== null) {
        const reference = options.programs.resolvedProgramReference(source.cardId);
        const program = registry.getProgram(source.cardId);
        if (!reference || !program || reference.encodedReference !== source.programReference ||
            program.source.dataVersion !== head.dataVersion || program.source.sourceCatalogDigest !== head.catalogDigest)
          fail("unknown Point cost source program");
        switch (program.semantics.kind) {
          case "no-ability": case "basic-rune": case "spell-resolution":
          case "point-damage-spell-resolution": case "trigger": case "activated":
          case "passive": case "static": case "continuous": case "compound-vi-self":
          case "accelerate": case "equip-activated-ability":
          case "beginning-phase-conditional-draw": case "deflect": break;
          default: fail("unreviewed Point cost source semantics");
        }
      } else {
        let parsed: unknown;
        try { parsed = JSON.parse(source.programReference); } catch { fail("unknown Point token program"); }
        if (!parsed || typeof parsed !== "object" || !("kind" in parsed) ||
            (parsed as { kind?: unknown }).kind !== "duel-intrinsic-token-ability-reference" &&
            (parsed as { kind?: unknown }).kind !== "recruit-birth-reference")
          fail("unknown Point token program");
      }
      let modifierIds: string[] = [];
      let choice: "mandatory" | "not-applicable" = "not-applicable";
      if (source.uid === targetUID && source.carrier === "object" &&
          (source.zone.kind === "board-battlefield" || source.zone.kind === "board-base") &&
          source.controllerPlayerId !== request.controller && source.cardId !== null) {
        if (source.controllerPlayerId !== target.controllerPlayerId ||
            source.zone.locationId !== target.locationId)
          fail("Deflect source is not the selected native unit");
        const targetProgram = registry.getProgram(source.cardId);
        if (targetProgram?.semantics.kind === "deflect") {
          const deflect = targetProgram.semantics.modifier;
          if (deflect.kind !== "additional-opponent-power-cost" || deflect.amount !== 1 ||
              deflect.powerDomain !== "wildcard" || deflect.payer !== "opponent" ||
              deflect.timing !== "additional-play-cost" || deflect.per !== "each-choice-of-source" ||
              deflect.optional || deflect.automaticPayment ||
              deflect.choice.source !== "spell-or-ability" ||
              deflect.choice.target !== "source-unit-on-board")
            fail("unreviewed Deflect cost definition");
          const modifierId = `point-deflect:${targetUID}:${request.cardUID}:${source.sourceEpoch}`;
          const sourceProofId = `point-deflect-proof:${head.matchId}:${head.stateVersion}:${targetUID}:${request.cardUID}`;
          modifiers.push({ id: modifierId, sourceProofId, stage: "additional", operation: "add",
            target: { kind: "new-component" }, choice: "mandatory",
            cost: { energy: 0, power: [{ allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"], amount: 1 }] } });
          modifierIds = [modifierId]; choice = "mandatory";
        }
      }
      if (source.carrier === "runtime-effect" && (!text(source.effectId) || !source.ledger ||
          source.status === "pending" && source.ledger !== "chain")) fail("unresolved Point runtime cost source");
      if (source.carrier === "runtime-effect" && !census.sources.some(bound =>
        bound.uid === source.sourceUID && bound.sourceEpoch === source.sourceEpoch &&
        bound.cardId === source.cardId && bound.controllerPlayerId === source.controllerPlayerId &&
        bound.programReference === source.programReference &&
        (bound.carrier === "object" || bound.carrier === "pre-exit")))
        fail("Point runtime cost source has no lifecycle binding");
      if (sourceWork) return [];
      return [{ sourceUid: source.uid, sourceEpoch: source.sourceEpoch, choice,
        modifierIds: Object.freeze(modifierIds) }];
    });
    const verified: DuelCostVerifiedSourcesV2 = {
      registryRevision: `${head.catalogDigest}:${census.journalRevision}:${census.candidateSetRevision}`,
      catalogRevision: `${head.dataVersion}:${head.catalogDigest}`, nonResourceCosts: "none",
      base: { cost: printed.cost, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch },
      candidates, orderedModifiers: modifiers,
    };
    if (options.getOperationHead() !== head || journal().readCostCensus()?.journalRevision !== census.journalRevision)
      fail("Point cost census changed during read");
    const fingerprints = fingerprintDuelCostCoverageV2(verified);
    return { request, proof: lifecycle, head, census, printed, verified, fingerprints };
  };
  const verifiedCostSource = (request: DuelCostRequestV2): DuelCostVerifiedSourcesV2 => {
    if (mode === "chain-point") fail("Point Spell cost is only available after native Chain entry");
    return snapshotFor(request).verified;
  };
  const cost = createDuelCostResolverAuthorityV2(request => {
    if (mode === "chain-point") fail("Point Spell base cost requires native Chain lifecycle");
    const snapshot = snapshotFor(request);
    const baseProofId = `spell-base:${request.transactionId}:${snapshot.census.journalRevision}`;
    const coverageProofId = `spell-coverage:${request.transactionId}:${snapshot.census.journalRevision}`;
    return { request, base: { cost: snapshot.printed.cost, proofId: baseProofId,
      status: "complete" as const, request, sourceUid: snapshot.tx.uid, sourceEpoch: snapshot.tx.epoch,
      registryRevision: snapshot.verified.registryRevision, catalogRevision: snapshot.verified.catalogRevision },
      coverage: { proofId: coverageProofId, status: "complete" as const, request,
        allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: "none" as const,
        registryRevision: snapshot.verified.registryRevision, catalogRevision: snapshot.verified.catalogRevision,
        candidateSourcesFingerprint: snapshot.fingerprints.candidateSourcesFingerprint,
        resolvedChoicesFingerprint: snapshot.fingerprints.resolvedChoicesFingerprint },
      proofs: [], modifiers: [] };
  }, verifiedCostSource);
  const costBinding = (request: Readonly<DuelSpellCostBindingV2>) => {
    try {
      if (mode === "chain-point") {
        const snapshot = chainSnapshots.get(request.transactionId);
        const resolvedProof = snapshot && inspectDuelSpellChainFirstResolvedProofV3(snapshot.request);
        const resolvedBase = `point-base:${request.transactionId}:${snapshot?.census.journalRevision ?? -1}`;
        const resolvedCoverage = `point-coverage:${request.transactionId}:${snapshot?.census.journalRevision ?? -1}`;
        const complete = !!snapshot && request.matchId === snapshot.head.matchId &&
          request.stateVersion === snapshot.head.stateVersion && request.actor === snapshot.request.controller &&
          request.uid === snapshot.request.cardUID && request.cardId === snapshot.request.cardId &&
          request.sourceEpoch === snapshot.request.sourceEpoch && request.baseProofId === resolvedBase &&
          request.coverageProofId === resolvedCoverage &&
          inspectDuelSpellChainFirstLifecycleProofV3(snapshot.request) === snapshot.proof &&
          resolvedProof?.lifecycle === snapshot.proof && resolvedProof.authority === snapshot.authority &&
          resolvedProof.resolved.baseProofId === request.baseProofId &&
          resolvedProof.resolved.coverageProofId === request.coverageProofId &&
          snapshot.printed.kind === "numeric" &&
          JSON.stringify(resolvedProof.resolved.baseCost) === JSON.stringify(snapshot.printed.cost) &&
          resolvedProof.resolved.applications.length === snapshot.verified.orderedModifiers.length &&
          resolvedProof.resolved.applications.every((application, index) =>
            application.modifierId === snapshot.verified.orderedModifiers[index]?.id &&
            application.sourceProofId === snapshot.verified.orderedModifiers[index]?.sourceProofId);
        return { ...request, status: complete ? "complete" as const : "unknown" as const };
      }
      const snapshot = snapshotFor({ transactionId: request.transactionId,
        subjectId: request.cardId, kind: "card-play" });
      const complete = request.matchId === snapshot.head.matchId &&
        request.stateVersion === snapshot.head.stateVersion && request.actor === snapshot.tx.actor &&
        request.uid === snapshot.tx.uid && request.sourceEpoch === snapshot.tx.epoch &&
        request.baseProofId === `spell-base:${request.transactionId}:${snapshot.census.journalRevision}` &&
        request.coverageProofId === `spell-coverage:${request.transactionId}:${snapshot.census.journalRevision}`;
      return { ...request, status: complete ? "complete" as const : "unknown" as const };
    } catch { return { ...request, status: "unknown" as const }; }
  };

  const costForChain = mode === "chain-point"
    ? (request: Readonly<DuelSpellChainFirstCostRequestV3>) => {
      const snapshot = chainSnapshotFor(request);
      const baseProofId = `point-base:${request.transactionId}:${snapshot.census.journalRevision}`;
      const coverageProofId = `point-coverage:${request.transactionId}:${snapshot.census.journalRevision}`;
      const authority = createDuelCostResolverAuthorityV2(costRequest => {
        if (costRequest.transactionId !== request.transactionId || costRequest.subjectId !== request.cardId)
          fail("Point cost request changed during Chain lifecycle");
        const current = chainSnapshotFor(request);
        if (current.head !== snapshot.head || current.census.journalRevision !== snapshot.census.journalRevision)
          fail("Point Chain cost census changed during read");
        const proofs = snapshot.verified.orderedModifiers.map(modifier => ({
          proofId: modifier.sourceProofId, modifierId: modifier.id, request: costRequest,
          target: modifier.target, status: "complete" as const, applicability: "applies" as const,
          sourceUid: snapshot.verified.candidates.find(candidate => candidate.modifierIds.includes(modifier.id))!.sourceUid,
          sourceEpoch: snapshot.verified.candidates.find(candidate => candidate.modifierIds.includes(modifier.id))!.sourceEpoch,
          registryRevision: snapshot.verified.registryRevision,
          catalogRevision: snapshot.verified.catalogRevision,
          modifierFingerprint: fingerprintDuelCostModifierV2(costRequest, modifier),
          candidateSourcesFingerprint: snapshot.fingerprints.candidateSourcesFingerprint,
          resolvedChoicesFingerprint: snapshot.fingerprints.resolvedChoicesFingerprint,
        }));
        return { request: costRequest,
          base: { cost: snapshot.printed.cost, proofId: baseProofId, status: "complete" as const,
            request: costRequest, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch,
            registryRevision: snapshot.verified.registryRevision, catalogRevision: snapshot.verified.catalogRevision },
          coverage: { proofId: coverageProofId, status: "complete" as const, request: costRequest,
            allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: "none" as const,
            registryRevision: snapshot.verified.registryRevision, catalogRevision: snapshot.verified.catalogRevision,
            candidateSourcesFingerprint: snapshot.fingerprints.candidateSourcesFingerprint,
            resolvedChoicesFingerprint: snapshot.fingerprints.resolvedChoicesFingerprint },
          proofs, modifiers: snapshot.verified.orderedModifiers };
      }, costRequest => {
        if (costRequest.transactionId !== request.transactionId || costRequest.subjectId !== request.cardId)
          fail("Point cost verification request changed");
        return snapshot.verified;
      });
      chainSnapshots.set(request.transactionId, { request, proof: snapshot.proof, head: snapshot.head,
        census: snapshot.census,
        verified: snapshot.verified, fingerprints: snapshot.fingerprints, printed: snapshot.printed,
        authority });
      return authority;
    }
    : undefined;

  const sourceAttestor: DuelSourceAttestorV2 = request => {
    const match = request.match;
    const origin = request.sourceReference;
    if (match.stage !== "playing" || origin.kind !== "card" || !text(origin.sourceUID) ||
        !text(origin.referenceId) || !text(request.paymentId) || !text(request.actor))
      fail("unbound Spell payment source");
    const physical = match.physicalCardsByUID[origin.sourceUID];
    const chainCard = match.chainCards?.find(item => item.uid === origin.sourceUID);
    const candidate = enumerateDuelPhaseSourceClosureCandidatesV2(match).find(item =>
      item.uid === origin.sourceUID && item.zone.kind === "chain");
    if (!physical || !chainCard || !candidate || physical.cardId !== origin.referenceId ||
        physical.ownerPlayerId !== request.actor || chainCard.cardId !== origin.referenceId ||
        chainCard.controllerPlayerId !== request.actor || candidate.zoneEpoch !== physical.zoneEpoch ||
        candidate.controllerPlayerId !== request.actor || candidate.cardId !== origin.referenceId)
      fail("payment source is not the current physical Chain Spell");
    const parent = options.getOperationHead();
    if (journal().observedHead() !== parent) fail("payment parent head is not journal-owned");
    const native = inspectDuelNativeCommitPathV2(parent, match);
    const entering = native.some(commit => commit.transitions.some(step =>
      step.uid === origin.sourceUID && step.from.kind === "hand" && step.to.kind === "chain"));
    const registered = journal().readCostCensus()?.sources.some(source =>
      source.carrier === "runtime-effect" && source.ledger === "chain" && source.status === "pending" &&
      source.sourceUID === origin.sourceUID && source.sourceEpoch === physical.zoneEpoch &&
      source.cardId === origin.referenceId && source.controllerPlayerId === request.actor);
    if (!entering && !registered || native.some(commit => commit.transitions.some(step =>
      step.uid === origin.sourceUID && step.to.kind !== "chain")))
      fail("payment source has no owned native Chain lifecycle");
    const binding = options.sourceAttestor(request);
    if (!binding || binding.matchId !== match.matchId || binding.actor !== request.actor ||
        binding.paymentId !== request.paymentId || binding.sourceReference.kind !== origin.kind ||
        binding.sourceReference.referenceId !== origin.referenceId ||
        binding.sourceReference.sourceUID !== origin.sourceUID || binding.mode !== "current" ||
        binding.sourceZoneEpoch !== physical.zoneEpoch || !text(binding.sourceProofId) ||
        binding.taskId !== request.taskId || binding.continuationId !== request.continuationId ||
        request.previous && request.previous.sourceProofId !== binding.sourceProofId)
      fail("parent payment attestation does not match native Spell source");
    return binding;
  };

  const observe = (descendant: DuelCanonicalPlayingStateV2,
    stage: "spell-play" | "spell-progress" | "spell-resolution") => {
    const ancestor = options.getOperationHead();
    if (ancestor === descendant) return [] as const;
    const commits = inspectDuelNativeCommitPathV2(ancestor, descendant);
    const path = options.observeNativePath(Object.freeze({ ancestor, descendant, commits, stage }));
    if (path.ancestor !== ancestor || path.descendant !== descendant) fail("owner native path mismatch");
    journal().observe(path);
    options.setOperationHead(descendant);
    if (options.getOperationHead() !== descendant || journal().observedHead() !== descendant)
      fail("owner head handoff was not synchronous");
    return journal().listCommits().slice(-commits.length);
  };
  const notifyCommitted: NonNullable<DuelSpellCommandDispatcherV2["notifyCommitted"]> = request => {
    if (!binding) fail("Spell resolution is not admitted");
    const proof = inspectDuelChainCommittedProofV2(request.proof);
    inspectDuelChainPrivateStateV2(request.chain);
    if (proof.resolutionAuthority !== binding.resolutionAuthority || proof.chainId !== binding.chainId ||
        proof.executorId !== binding.executorId || proof.itemId !== request.ticket.itemId ||
        proof.idempotencyKey !== request.ticket.idempotencyKey || request.chain.chainId !== binding.chainId ||
        request.ticket.chainId !== binding.chainId || request.ticket.executorId !== binding.executorId)
      fail("foreign Spell resolution proof");
    const business = JSON.stringify([request.ticket.idempotencyKey, request.ticket.itemId,
      request.cardUID, request.cardId, request.controller, request.sourceEpoch]);
    const prior = notified.get(proof.idempotencyKey);
    const head = request.commandSession.match as DuelCanonicalPlayingStateV2;
    if (prior) {
      if (prior.proof !== request.proof || prior.head !== head || prior.business !== business ||
          options.getOperationHead() !== head)
        fail("conflicting repeated Spell notification");
      if (prior.acknowledged) return;
      const confirmation = options.dispatcher.notifyCommitted?.(request);
      if (confirmation !== undefined) fail("parent notification did not confirm synchronously");
      prior.acknowledged = true;
      return;
    }
    const pending = journal().readCostCensus()?.sources.find(source => source.carrier === "runtime-effect" &&
      source.ledger === "chain" && source.effectId === request.ticket.itemId &&
      source.sourceUID === request.cardUID && source.sourceEpoch === request.sourceEpoch &&
      source.cardId === request.cardId && source.controllerPlayerId === request.controller);
    if (!pending || pending.status !== "pending") fail("Spell notification has no owned pending Chain work");
    const native = observe(head, "spell-resolution");
    const exit = native.find(commit => commit.transitions.some(step =>
      step.uid === request.cardUID && step.from.kind === "chain" && step.to.kind === "trash" &&
      step.fromZoneEpoch === request.sourceEpoch));
    if (!exit || head.physicalCardsByUID[request.cardUID]?.cardId !== request.cardId)
      fail("Spell retirement lacks its native Chain exit");
    const context = { matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: head.frame.turnNumber,
      taskId: `duel-v2:${head.matchId}:turn-${head.frame.turnNumber}:spell:${request.ticket.itemId}`,
      phase: "main" as const, event: "chain" as const,
      clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } };
    journal().retireRuntimeEffect({ ledger: "chain", operationId: exit.label.operationId,
      context, effectId: request.ticket.itemId, committedProof: request.proof });
    notified.set(proof.idempotencyKey, { proof: request.proof, head, business, acknowledged: false });
    const confirmation = options.dispatcher.notifyCommitted?.(request);
    if (confirmation !== undefined) fail("parent notification did not confirm synchronously");
    notified.get(proof.idempotencyKey)!.acknowledged = true;
  };
  const coreServices: DuelSpellCardPlayServicesV2 = Object.freeze({ programs: registry, cost,
    costBinding, sourceAttestor,
    dispatcher: Object.freeze({ ...options.dispatcher, notifyCommitted }), closure: options.closure,
    ...(mode === "chain-point" ? { cardPlayOrder: "chain-first-v3" as const, pointDamageSpellV1: true,
      costForChain } : {}),
    identityFactory: () => { const uid = options.uidFactory(); if (!text(uid)) fail("empty owner identity");
      identityTape.push(uid); return uid; } });
  const createSession = (commandSession: DuelCommandSessionV2) => {
    if (binding) fail("Spell branch already admitted");
    if (commandSession.match !== options.getOperationHead()) fail("Spell session is not on owner head");
    const session = createDuelSpellCardPlaySessionV2(commandSession, coreServices);
    binding = inspectDuelSpellResolutionBindingV2(session);
    return session;
  };
  const handoff = (result: DuelSpellCardPlayResultV2) => {
    const match = result.session.commandSession.match;
    if (match.stage !== "playing") fail("Spell result left playing state");
    const native = observe(match, result.outcome.status === "pending" && result.outcome.step === "payment"
      ? "spell-play" : "spell-progress");
    const entry = native.find(commit => commit.transitions.some(step =>
      step.from.kind === "hand" && step.to.kind === "chain"));
    if (!entry) return;
    if (!binding) fail("Chain entry has no Spell resolution binding");
    const transition = entry.transitions.find(step => step.from.kind === "hand" && step.to.kind === "chain")!;
    registerChainEntry(match, transition.uid, transition.toZoneEpoch, result.session.chain.items.at(-1)!);
  };
  const privateFingerprintData = () => deepFreeze({ schema: "p4-spell-private-v1",
    owner: dataCopy(options.dispatcherSnapshot()),
    resolutionBinding: binding ? { chainId: binding.chainId, executorId: binding.executorId } : null,
    journalRevision: journal().revision(),
    costCensus: dataCopy(journal().readCostCensus()),
    chainCostSnapshots: [...chainSnapshots.entries()].map(([transactionId, snapshot]) => ({
      transactionId, matchId: snapshot.head.matchId, stateVersion: snapshot.head.stateVersion,
      eventSeq: snapshot.head.eventSeq, journalRevision: snapshot.census.journalRevision,
      candidateSourcesFingerprint: snapshot.fingerprints.candidateSourcesFingerprint,
      resolvedChoicesFingerprint: snapshot.fingerprints.resolvedChoicesFingerprint,
    })),
    identityTape: [...identityTape],
    notified: [...notified.entries()].map(([key, value]) => ({ key,
      stateVersion: value.head.stateVersion, eventSeq: value.head.eventSeq,
      business: value.business, acknowledged: value.acknowledged })),
    digest: createHash("sha256").update(JSON.stringify(identityTape)).digest("hex") });
  return Object.freeze({ coreServices, createSession, handoff, verifiedCostSource, privateFingerprintData });
}
