/** Server-private, five-command V2 replay. A journal is data, never an admission token. */
import { createHash, randomUUID } from "node:crypto";
import {
  applyDuelResourceCommandV2,
  type DuelCommandEnvelopeV2,
  type DuelCommandOutcomeV2,
  type DuelCommandResultV2,
  type DuelCommandSessionV2,
  type DuelTrustedCardTypeResolverV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import {
  createDuelRuntimeSessionV2,
  projectDuelRuntimeV2,
  type DuelRuntimeSeatV2,
} from "./runtime-v2.js";
import { projectDuelRuntimeV3 } from "./runtime-v3.js";
import { JournalWriter, digestJournalValue, isJournalV1, replayJournal, type Journal, type JournalCommand, type JournalJsonValue } from "./runtime/journal/index.js";

type Trace =
  | { readonly kind: "uid"; readonly value: string }
  | { readonly kind: "random"; readonly bound: number; readonly value: number }
  | { readonly kind: "card-type"; readonly cardId: string; readonly value: string };

interface Entry {
  readonly actor: string;
  readonly envelope: DuelCommandEnvelopeV2;
  readonly trace: readonly Trace[];
  readonly outcome: DuelCommandOutcomeV2;
  readonly clock: { readonly stateVersion: number; readonly eventSeq: number };
  readonly sessionHash: string;
}

export interface SealedDuelCommandJournalV2 {
  readonly kind: "private-duel-command-journal-v2";
  readonly schemaVersion: 1;
  readonly creation: {
    readonly matchId: string;
    readonly roster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2];
    readonly catalogHash: string;
    readonly trace: readonly Trace[];
    readonly clock: { readonly stateVersion: number; readonly eventSeq: number };
    readonly sessionHash: string;
  };
  readonly entries: readonly Entry[];
  readonly journal?: Journal;
}

export interface DuelCommandJournalOptionsV2 {
  readonly randomIndex: (bound: number) => number;
  readonly uidFactory?: () => string;
  readonly trustedCardType: DuelTrustedCardTypeResolverV2;
}

export class DuelCommandJournalErrorV2 extends TypeError {
  constructor(detail: string) {
    super(`Duel V2 command journal: ${detail}`);
    this.name = "DuelCommandJournalErrorV2";
  }
}

function check(ok: unknown, detail: string): asserts ok {
  if (!ok) throw new DuelCommandJournalErrorV2(detail);
}

function exact(raw: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(raw !== null && typeof raw === "object" && !Array.isArray(raw), "record required");
  check(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null,
    "plain record required");
  const keys = Reflect.ownKeys(raw);
  check(required.every(key => keys.includes(key)) && keys.length >= required.length &&
    keys.length <= required.length + optional.length && keys.every(key =>
      typeof key === "string" && [...required, ...optional].includes(key) &&
      Object.getOwnPropertyDescriptor(raw, key)?.enumerable === true &&
      "value" in Object.getOwnPropertyDescriptor(raw, key)!), "exact data keys required");
  return raw as Record<string, unknown>;
}

function dense(raw: unknown): readonly unknown[] {
  check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype &&
    raw.length <= 100000 && Reflect.ownKeys(raw).length === raw.length + 1, "dense array required");
  for (let i = 0; i < raw.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
    check(descriptor?.enumerable === true && "value" in descriptor, "dense data elements required");
  }
  return raw;
}

function id(raw: unknown): string {
  check(typeof raw === "string" && raw.length > 0 && raw.length <= 4096 && raw.trim().length > 0,
    "nonblank identifier required");
  return raw;
}

function count(raw: unknown): number {
  check(typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0, "safe counter required");
  return raw;
}

function jsonData(raw: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  check(depth <= 100, "JSON depth limit");
  if (raw === null || typeof raw === "boolean" || typeof raw === "string") return raw;
  if (typeof raw === "number") { check(Number.isFinite(raw), "finite JSON number required"); return raw; }
  check(typeof raw === "object", "JSON data required");
  check(!seen.has(raw), "acyclic JSON data required");
  seen.add(raw);
  if (Array.isArray(raw)) {
    const value = dense(raw).map(item => jsonData(item, depth + 1, seen));
    seen.delete(raw);
    return value;
  }
  const keys = Reflect.ownKeys(raw);
  exact(raw, keys as string[]);
  check(keys.length <= 100000, "JSON record size limit");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = jsonData((raw as Record<string, unknown>)[key], depth + 1, seen);
  seen.delete(raw);
  return result;
}

function digest(raw: unknown): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

function freezeDeep(raw: unknown): void {
  if (raw === null || typeof raw !== "object" || Object.isFrozen(raw)) return;
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor && "value" in descriptor) freezeDeep(descriptor.value);
  }
  Object.freeze(raw);
}

function catalogHash(catalog: CardCatalogRuntime): string {
  // Include validation policy and the private identity lookup, not just the public marker.
  const metadata = catalog.constructedRules.identityMetadata;
  return digest(jsonData({
    publicCatalog: catalog.publicCatalog,
    validationCards: catalog.validationCards,
    deckRules: catalog.deckRules,
    policy: catalog.constructedRules.policy,
    identities: [...metadata.byCardId.entries()],
    knownChampionTags: [...metadata.knownChampionTags.values()],
  }));
}

function sessionHash(session: DuelCommandSessionV2): string {
  return digest(jsonData(session));
}

function clock(session: DuelCommandSessionV2) {
  return { stateVersion: session.match.stateVersion, eventSeq: session.match.eventSeq };
}

function v2JournalCommand(command: DuelCommandEnvelopeV2["command"]): JournalCommand {
  switch (command.type) {
    case "mulligan": return { type: "pass" };
    case "rune-energy":
    case "rune-power":
    case "gold-power": return { type: "play-card", instanceId: command.uid, targets: [] };
    case "pay-pending": return { type: "respond-to-prompt", promptId: command.paymentId, optionId: command.paymentId, targets: [] };
  }
}

function v2JournalEntropy(trace: readonly Trace[]) {
  return trace.filter((item): item is Exclude<Trace, { readonly kind: "card-type" }> => item.kind !== "card-type");
}

function buildV2Journal(ctx: Context, creation: SealedDuelCommandJournalV2["creation"], entries: readonly Entry[], session: DuelCommandSessionV2): Journal {
  const creationStep = replaySources(ctx, creation.trace);
  let replaySession = createDuelRuntimeSessionV2(ctx.catalog, ctx.roster, ctx.matchId, creationStep.options);
  creationStep.done();
  const writer = new JournalWriter({
    header: {
      engineVersion: "riftbound-game-server:v2-compat", matchId: ctx.matchId, roomId: ctx.matchId,
      catalogDigest: ctx.catalog.publicCatalog.digest,
      rosterDigest: digestJournalValue(ctx.roster.map(seat => ({ playerId: seat.playerId, name: seat.displayName }))),
      trustedDeckDigest: digestJournalValue(ctx.roster.map(seat => seat.deck)), seed: digestJournalValue([ctx.matchId, ctx.catalog.publicCatalog.digest]),
      seats: ctx.roster.map(seat => ({ playerId: seat.playerId, name: seat.displayName })),
      creation: { entropy: creation.trace.filter(item => item.kind !== "card-type"), deterministicSeed: digestJournalValue([ctx.matchId, ctx.catalog.publicCatalog.digest]),
        uidSeed: creation.trace.find(item => item.kind === "uid")?.value ?? null, creator: "game-server" },
    }, stateVersion: creation.clock.stateVersion, eventSeq: creation.clock.eventSeq, roomVersion: 0,
    stateDigest: digestJournalValue(projectDuelRuntimeV3(replaySession, null)), privateStateDigest: creation.sessionHash,
  });
  for (const entry of entries) {
    if (entry.outcome.status !== "applied") continue;
    const step = replaySources(ctx, entry.trace);
    const replayed = applyDuelResourceCommandV2(replaySession, entry.actor, entry.envelope,
      { randomIndex: step.options.randomIndex });
    step.done();
    check(replayed.persistRequired && !replayed.duplicate && replayed.outcome.status === "applied" &&
      JSON.stringify(jsonData(replayed.outcome)) === JSON.stringify(jsonData(entry.outcome)) &&
      JSON.stringify(clock(replayed.session)) === JSON.stringify(entry.clock) &&
      sessionHash(replayed.session) === entry.sessionHash, "unified journal source replay drift");
    replaySession = replayed.session;
    const acceptedAt = new Date(0).toISOString();
    const projection = projectDuelRuntimeV3(replaySession, null);
    writer.recordCommand({
      playerId: entry.actor, actor: entry.actor, requestId: entry.envelope.commandId, commandId: entry.envelope.commandId,
      command: v2JournalCommand(entry.envelope.command), payload: v2JournalCommand(entry.envelope.command), acceptedAt,
      expectedStateVersion: entry.envelope.expectedVersion, appliedStateVersion: entry.outcome.appliedVersion,
      eventSeq: entry.outcome.eventSeq, roomVersion: 0,
      result: { accepted: true, outcome: jsonData(entry.outcome) as JournalJsonValue, legacyEnvelope: jsonData(entry.envelope) as JournalJsonValue,
        legacyTrace: jsonData(entry.trace) as JournalJsonValue, legacySessionHash: entry.sessionHash },
      publicReceipt: { accepted: true, outcome: jsonData(entry.outcome) as JournalJsonValue }, entropyConsumed: v2JournalEntropy(entry.trace),
      projectionDigestByViewer: { public: digestJournalValue(projection) },
      state: { stateVersion: entry.outcome.appliedVersion, eventSeq: entry.outcome.eventSeq, roomVersion: 0,
        stateDigest: digestJournalValue(projection), privateStateDigest: entry.sessionHash },
    });
  }
  return writer.snapshot();
}

function parseTrace(raw: unknown): Trace[] {
  return dense(raw).map(item => {
    const r = exact(item, ["kind", "value"], ["bound", "cardId"]);
    if (r.kind === "uid") { exact(item, ["kind", "value"]); return { kind: "uid", value: id(r.value) }; }
    if (r.kind === "card-type") {
      exact(item, ["kind", "cardId", "value"]);
      return { kind: "card-type", cardId: id(r.cardId), value: id(r.value) };
    }
    check(r.kind === "random", "unknown trace kind");
    exact(item, ["kind", "bound", "value"]);
    const bound = count(r.bound), value = count(r.value);
    check(bound > 0 && value < bound, "random out of range");
    return { kind: "random", bound, value };
  });
}

function parseEnvelope(raw: unknown): DuelCommandEnvelopeV2 {
  const r = exact(raw, ["commandId", "expectedVersion", "command"]);
  const command = exact(r.command, ["type"], ["selectedUIDs", "uid", "paymentId", "plan"]);
  let parsed: DuelCommandEnvelopeV2["command"];
  if (command.type === "mulligan") {
    exact(r.command, ["type", "selectedUIDs"]);
    parsed = { type: "mulligan", selectedUIDs: dense(command.selectedUIDs).map(id) };
  } else if (command.type === "rune-energy" || command.type === "rune-power" || command.type === "gold-power") {
    exact(r.command, ["type", "uid"]);
    parsed = { type: command.type, uid: id(command.uid) };
  } else {
    check(command.type === "pay-pending", "unknown command type");
    exact(r.command, ["type", "paymentId"], ["plan"]);
    if (Object.hasOwn(command, "plan")) {
      const plan = exact(command.plan, ["power"]);
      parsed = { type: "pay-pending", paymentId: id(command.paymentId), plan: {
        power: dense(plan.power).map(item => {
          const allocation = exact(item, ["requirementIndex", "from", "amount"]);
          check(typeof allocation.from === "string" &&
            ["Fury", "Calm", "Mind", "Body", "Chaos", "Order", "any"].includes(allocation.from),
          "unknown allocation source");
          return { requirementIndex: count(allocation.requirementIndex),
            from: allocation.from as "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" | "any",
            amount: count(allocation.amount) };
        }),
      } };
    } else parsed = { type: "pay-pending", paymentId: id(command.paymentId) };
  }
  return { commandId: id(r.commandId), expectedVersion: count(r.expectedVersion), command: parsed };
}

function parseOutcome(raw: unknown): DuelCommandOutcomeV2 {
  const r = exact(raw, ["status"], ["appliedVersion", "eventSeq", "reason", "paymentCompleted"]);
  if (r.status === "applied") {
    exact(raw, ["status", "appliedVersion", "eventSeq"], ["paymentCompleted"]);
    return { status: "applied", appliedVersion: count(r.appliedVersion), eventSeq: count(r.eventSeq),
      ...(Object.hasOwn(r, "paymentCompleted") ? { paymentCompleted: jsonData(r.paymentCompleted) as
        Extract<DuelCommandOutcomeV2, { status: "applied" }>["paymentCompleted"] } : {}) };
  }
  check(r.status === "rejected", "unknown outcome status");
  exact(raw, ["status", "reason"]);
  check(typeof r.reason === "string" && ["stale-version", "invalid-stage", "invalid-phase",
    "no-permission", "mulligan-rejected", "resource-rejected", "payment-rejected", "version-overflow"]
    .includes(r.reason), "nonpersistent or unknown rejection");
  return { status: "rejected", reason: r.reason as Extract<DuelCommandOutcomeV2,
    { status: "rejected" }>["reason"] };
}

function parseClock(raw: unknown) {
  const r = exact(raw, ["stateVersion", "eventSeq"]);
  return { stateVersion: count(r.stateVersion), eventSeq: count(r.eventSeq) };
}

function parseHash(raw: unknown): string {
  check(typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw), "SHA-256 shape required");
  return raw;
}

function parseJournal(raw: unknown): SealedDuelCommandJournalV2 {
  const root = exact(raw, ["kind", "schemaVersion", "creation", "entries"]);
  check(root.kind === "private-duel-command-journal-v2" && root.schemaVersion === 1,
    "journal schema mismatch");
  const c = exact(root.creation, ["matchId", "roster", "catalogHash", "trace", "clock", "sessionHash"]);
  const roster = dense(c.roster);
  check(roster.length === 2, "two seats required");
  const entries = dense(root.entries).map(rawEntry => {
    const e = exact(rawEntry, ["actor", "envelope", "trace", "outcome", "clock", "sessionHash"]);
    return { actor: id(e.actor), envelope: parseEnvelope(e.envelope), trace: parseTrace(e.trace),
      outcome: parseOutcome(e.outcome), clock: parseClock(e.clock), sessionHash: parseHash(e.sessionHash) };
  });
  return { kind: "private-duel-command-journal-v2", schemaVersion: 1,
    creation: { matchId: id(c.matchId), roster: jsonData(c.roster) as unknown as
      [DuelRuntimeSeatV2, DuelRuntimeSeatV2], catalogHash: parseHash(c.catalogHash),
      trace: parseTrace(c.trace), clock: parseClock(c.clock), sessionHash: parseHash(c.sessionHash) },
    entries };
}

interface Context {
  readonly catalog: CardCatalogRuntime;
  readonly roster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2];
  readonly matchId: string;
  readonly trustedCardType: DuelTrustedCardTypeResolverV2;
  readonly futureRandomIndex?: (bound: number) => number;
  readonly contextHash: string;
}

function context(catalog: CardCatalogRuntime, roster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2],
  matchId: string, trustedCardType: DuelTrustedCardTypeResolverV2,
  futureRandomIndex?: (bound: number) => number): Context {
  id(matchId);
  const snapshot = jsonData(roster) as unknown as [DuelRuntimeSeatV2, DuelRuntimeSeatV2];
  return { catalog, roster, matchId, trustedCardType, futureRandomIndex,
    contextHash: digest({ roster: snapshot, catalogHash: catalogHash(catalog) }) };
}

function contextCurrent(ctx: Context): void {
  check(digest({ roster: jsonData(ctx.roster), catalogHash: catalogHash(ctx.catalog) }) === ctx.contextHash,
    "trusted creation context changed");
}

function recordSources(options: DuelCommandJournalOptionsV2, trace: Trace[]) {
  return {
    uidFactory: () => { const value = id((options.uidFactory ?? randomUUID)());
      trace.push({ kind: "uid", value }); return value; },
    randomIndex: (bound: number) => { const value = options.randomIndex(bound);
      check(Number.isSafeInteger(value) && value >= 0 && value < bound, "random out of range");
      trace.push({ kind: "random", bound, value }); return value; },
    trustedCardType: ((cardId: string) => { const value = options.trustedCardType(cardId);
      trace.push({ kind: "card-type", cardId, value }); return value; }) as DuelTrustedCardTypeResolverV2,
  };
}

function replaySources(ctx: Context, expected: readonly Trace[]) {
  let cursor = 0;
  const take = (kind: Trace["kind"]): Trace => {
    const item = expected[cursor++];
    check(item?.kind === kind, `missing or reordered ${kind} call`);
    return item;
  };
  return {
    options: {
      uidFactory: () => (take("uid") as Extract<Trace, { kind: "uid" }>).value,
      randomIndex: (bound: number) => { const item = take("random") as Extract<Trace, { kind: "random" }>;
        check(item.bound === bound && item.value < bound, "random bound/value drift"); return item.value; },
      trustedCardType: ((cardId: string) => {
        const item = take("card-type") as Extract<Trace, { kind: "card-type" }>;
        check(item.cardId === cardId && item.value === ctx.trustedCardType(cardId),
          "trusted card type drift");
        return item.value;
      }) as DuelTrustedCardTypeResolverV2,
    },
    done: () => check(cursor === expected.length, "unused UID/random/card-type calls"),
  };
}

const gates = new WeakSet<object>();
export interface TrustedDuelCommandJournalReplayGateV2 { readonly _trustedReplayGateV2: unique symbol }

/** Caller must obtain these inputs independently of the candidate private data. */
export function createTrustedDuelCommandJournalReplayGateV2(
  catalog: CardCatalogRuntime, roster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2], matchId: string,
  trustedCardType: DuelTrustedCardTypeResolverV2, futureRandomIndex: (bound: number) => number,
): TrustedDuelCommandJournalReplayGateV2 {
  const gate = { context: context(catalog, roster, matchId, trustedCardType, futureRandomIndex) };
  gates.add(gate);
  return gate as unknown as TrustedDuelCommandJournalReplayGateV2;
}

export class DuelCommandJournalRecorderV2 {
  private readonly ownedSessions = new WeakSet<object>();
  private constructor(private readonly ctx: Context, private session: DuelCommandSessionV2,
    private readonly creation: SealedDuelCommandJournalV2["creation"],
    private readonly entries: Entry[], private readonly randomIndex?: (bound: number) => number) {
    this.ownedSessions.add(session);
  }

  static create(catalog: CardCatalogRuntime, roster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2],
    matchId: string, options: DuelCommandJournalOptionsV2): DuelCommandJournalRecorderV2 {
    const ctx = context(catalog, roster, matchId, options.trustedCardType);
    const trace: Trace[] = [];
    const session = createDuelRuntimeSessionV2(catalog, roster, matchId, recordSources(options, trace));
    contextCurrent(ctx);
    return new DuelCommandJournalRecorderV2(ctx, session, {
      matchId, roster: jsonData(roster) as unknown as [DuelRuntimeSeatV2, DuelRuntimeSeatV2],
      catalogHash: catalogHash(catalog), trace, clock: clock(session), sessionHash: sessionHash(session),
    }, [], options.randomIndex);
  }

  static replay(raw: unknown, gate: TrustedDuelCommandJournalReplayGateV2): DuelCommandJournalRecorderV2 {
    check(typeof gate === "object" && gate !== null && gates.has(gate), "trusted replay gate required");
    const ctx = (gate as unknown as { context: Context }).context;
    contextCurrent(ctx);
    const candidate = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    let unified: Journal | undefined;
    if (candidate?.journal !== undefined) {
      check(isJournalV1(candidate.journal), "unified journal v1 required");
      unified = candidate.journal;
      replayJournal(unified, { engineVersion: "riftbound-game-server:v2-compat" });
      raw = { kind: candidate.kind, schemaVersion: candidate.schemaVersion, creation: candidate.creation, entries: [] };
    }
    const journal = parseJournal(raw);
    check(journal.creation.matchId === ctx.matchId &&
      JSON.stringify(journal.creation.roster) === JSON.stringify(jsonData(ctx.roster)) &&
      journal.creation.catalogHash === catalogHash(ctx.catalog), "creation context mismatch");
    const source = replaySources(ctx, journal.creation.trace);
    const session = createDuelRuntimeSessionV2(ctx.catalog, ctx.roster, ctx.matchId, source.options);
    source.done();
    check(JSON.stringify(clock(session)) === JSON.stringify(journal.creation.clock) &&
      sessionHash(session) === journal.creation.sessionHash, "creation outcome/clock drift");
    const recorder = new DuelCommandJournalRecorderV2(ctx, session, journal.creation, [], ctx.futureRandomIndex);
    const entries = unified === undefined ? journal.entries : unified.entries.map(record => {
      check(record.kind === "entry", "V2 unified journal cannot contain operations");
      const payload = exact(record.result, ["accepted", "outcome", "legacyEnvelope", "legacyTrace", "legacySessionHash"]);
      const envelope = parseEnvelope(payload.legacyEnvelope);
      const trace = parseTrace(payload.legacyTrace);
      const outcome = parseOutcome(payload.outcome);
      check(record.actor === record.playerId && record.commandId === envelope.commandId &&
        record.requestId === envelope.commandId && record.expectedStateVersion === envelope.expectedVersion &&
        JSON.stringify(record.command) === JSON.stringify(v2JournalCommand(envelope.command)) &&
        record.appliedStateVersion === (outcome.status === "applied" ? outcome.appliedVersion : 0) &&
        record.eventSeq === (outcome.status === "applied" ? outcome.eventSeq : 0) &&
        JSON.stringify(record.entropyConsumed) === JSON.stringify(v2JournalEntropy(trace)),
      "unified command metadata drift");
      check(outcome.status === "applied", "V2 unified journal contains a nonpersistent command");
      return { actor: record.actor, envelope, trace, outcome,
        clock: { stateVersion: record.appliedStateVersion, eventSeq: record.eventSeq },
        sessionHash: parseHash(payload.legacySessionHash) } satisfies Entry;
    });
    for (const entry of entries) {
      const before = recorder.session;
      const step = replaySources(ctx, entry.trace);
      const result = applyDuelResourceCommandV2(before, entry.actor, entry.envelope,
        { randomIndex: step.options.randomIndex });
      step.done();
      check(result.persistRequired && !result.duplicate &&
        JSON.stringify(jsonData(result.outcome)) === JSON.stringify(jsonData(entry.outcome)) &&
        JSON.stringify(clock(result.session)) === JSON.stringify(entry.clock) &&
        sessionHash(result.session) === entry.sessionHash, "command outcome/clock/state drift");
      recorder.session = result.session;
      recorder.ownedSessions.add(result.session);
      recorder.entries.push(entry);
    }
    contextCurrent(ctx);
    return recorder;
  }

  get stateVersion(): number { return this.session.match.stateVersion; }
  get stage(): DuelCommandSessionV2["match"]["stage"] { return this.session.match.stage; }

  project(viewer: string | null) {
    contextCurrent(this.ctx);
    return projectDuelRuntimeV2(this.session, viewer);
  }

  /** Publish the permanent DTO without exposing the admitted private session. */
  projectV3(viewer: string | null) {
    contextCurrent(this.ctx);
    return projectDuelRuntimeV3(this.session, viewer);
  }

  /** Actor is supplied by authenticated server state, never by the command packet. */
  apply(actor: string, envelope: DuelCommandEnvelopeV2): Pick<DuelCommandResultV2,
    "outcome" | "duplicate" | "persistRequired"> {
    check(this.ownedSessions.has(this.session), "foreign session identity");
    contextCurrent(this.ctx);
    const trace: Trace[] = [];
    const result = applyDuelResourceCommandV2(this.session, actor, envelope,
      { randomIndex: (bound) => { check(this.randomIndex !== undefined, "replayed recorder is read-only");
        const value = this.randomIndex(bound);
        check(Number.isSafeInteger(value) && value >= 0 && value < bound, "random out of range");
        trace.push({ kind: "random", bound, value }); return value; } });
    contextCurrent(this.ctx);
    if (result.persistRequired) {
      check(!result.duplicate, "duplicate cannot persist");
      this.entries.push({ actor: id(actor), envelope: parseEnvelope(envelope), trace,
        outcome: parseOutcome(result.outcome), clock: clock(result.session),
        sessionHash: sessionHash(result.session) });
      this.session = result.session;
      this.ownedSessions.add(result.session);
    } else check(trace.length === 0 && result.session === this.session,
      "nonpersistent command consumed authority");
    return { outcome: jsonData(result.outcome) as DuelCommandOutcomeV2,
      duplicate: result.duplicate, persistRequired: result.persistRequired };
  }

  /** Private candidate only. The protected store/atomic head is supplied by the parent. */
  seal(): SealedDuelCommandJournalV2 {
    check(this.ownedSessions.has(this.session), "foreign session identity");
    contextCurrent(this.ctx);
    check(this.session.turnCursorV2 === undefined && this.session.requiredTasks.length === 0 &&
      this.session.priorityPayments.length === 0 &&
      (this.session.match.stage === "setup" ||
        this.session.match.frame.phase === "awaiting-turn-start"),
    "unrecorded turn/payment/cursor mutation");
    const candidate = parseJournal({ kind: "private-duel-command-journal-v2", schemaVersion: 1,
      creation: this.creation, entries: this.entries });
    const gate = createTrustedDuelCommandJournalReplayGateV2(
      this.ctx.catalog, this.ctx.roster, this.ctx.matchId, this.ctx.trustedCardType,
      this.randomIndex ?? (() => { throw new DuelCommandJournalErrorV2("random source unavailable"); }));
    const verified = DuelCommandJournalRecorderV2.replay(candidate, gate);
    check(sessionHash(verified.session) === sessionHash(this.session), "external session mutation");
    const unified = buildV2Journal(this.ctx, candidate.creation, candidate.entries, this.session);
    const sealed = { ...candidate, journal: unified };
    freezeDeep(sealed);
    return sealed;
  }
}

export const createDuelCommandJournalV2 = DuelCommandJournalRecorderV2.create;
export const replayDuelCommandJournalV2 = DuelCommandJournalRecorderV2.replay;
