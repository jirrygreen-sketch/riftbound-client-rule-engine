import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  channelDuelRunes,
  commitDuelPlayingMutation,
  issueDuelRequiredCostTask,
  prepareDuelRequiredCostPayment,
  type DuelCommandSession,
  type DuelRequiredCostTask,
} from "@riftbound/engine-core/duel";
import { isDuelProjection, type DuelCommandMessage } from "@riftbound/protocol";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createDuelRuntimeSession,
  executeDuelRuntimeCommand,
  projectDuelRuntime,
  type DuelRuntimeSeat,
} from "../../src/duel/runtime.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
let runtimePromise: Promise<CardCatalogRuntime> | null = null;
function runtime(): Promise<CardCatalogRuntime> {
  runtimePromise ??= loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  return runtimePromise;
}

function seats(): readonly [DuelRuntimeSeat, DuelRuntimeSeat] {
  return [
    { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
    { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
  ];
}

function makeSession(catalog: CardCatalogRuntime = undefined as never): DuelCommandSession {
  return createDuelRuntimeSession(catalog, seats(), "runtime-match", {
    randomIndex: () => 0,
    uidFactory: (() => {
      let n = 0;
      return () => `runtime-uid-${++n}`;
    })(),
  });
}

async function fixture(): Promise<DuelCommandSession> {
  return makeSession(await runtime());
}

function command(
  requestId: string,
  commandId: string,
  expectedVersion: number,
  value: DuelCommandMessage["command"],
): DuelCommandMessage {
  return { type: "duel-command", requestId, commandId, expectedVersion, command: value };
}

function completeMulligans(source: DuelCommandSession): DuelCommandSession {
  let session = source;
  const first = session.match.turnOrder[0]!;
  const second = session.match.turnOrder[1]!;
  let executed = executeDuelRuntimeCommand(session, first,
    command("mulligan-a", "mulligan-a", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] }));
  expect(executed.outbound.type).toBe("request-result");
  session = executed.session;
  executed = executeDuelRuntimeCommand(session, second,
    command("mulligan-b", "mulligan-b", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] }));
  expect(executed.outbound.type).toBe("request-result");
  return executed.session;
}

function activeResourceSession(source: DuelCommandSession): DuelCommandSession {
  const playing = completeMulligans(source);
  if (playing.match.stage !== "playing") throw new Error("expected playing match");
  const actor = playing.match.turnOrder[0]!;
  const resources = channelDuelRunes(playing.match.resources, actor, 2);
  const match = commitDuelPlayingMutation(playing.match, draft => ({ ...draft,
    resources,
    frame: { ...draft.frame, phase: "main", stateOpen: true, priorityPlayerId: actor,
      focusPlayerId: null, pendingPayment: null },
  }));
  return { ...playing, match };
}

function requiredPaymentSession(source: DuelCommandSession): DuelCommandSession {
  const active = activeResourceSession(source);
  if (active.match.stage !== "playing") throw new Error("expected playing match");
  const actor = active.match.turnOrder[0]!;
  const task: DuelRequiredCostTask = {
    matchId: active.match.matchId,
    expectedVersion: active.match.stateVersion,
    taskId: "required-task-1",
    paymentId: "required-payment-1",
    actor,
    finalResolvedCost: { energy: 0, power: [] },
    opaqueSource: { kind: "effect", referenceId: "trusted-test-source" },
    continuationId: "trusted-continuation-1",
  };
  const issued = issueDuelRequiredCostTask(active, task);
  return prepareDuelRequiredCostPayment(issued.session, issued.authority).session;
}

describe("duel runtime facade", () => {
  it("validates the trusted roster before UID allocation and setup RNG", async () => {
    const catalog = await runtime();
    let uidCalls = 0;
    let rngCalls = 0;
    const bad = seats();
    const broken: readonly [DuelRuntimeSeat, DuelRuntimeSeat] = [
      { ...bad[0], deck: { ...bad[0].deck, mainDeck: [{ cardId: "not-in-catalog", quantity: 1 }] } },
      bad[1],
    ];
    expect(() => createDuelRuntimeSession(catalog, broken, "invalid-runtime-match", {
      randomIndex: () => { rngCalls += 1; return 0; },
      uidFactory: () => { uidCalls += 1; return `uid-${uidCalls}`; },
    })).toThrow(/invalid_deck/);
    expect(uidCalls).toBe(0);
    expect(rngCalls).toBe(0);
  });

  it("projects the actual canonical match with owner-only hand data and spectator privacy", async () => {
    const session = await fixture();
    const owner = projectDuelRuntime(session, "alice");
    const spectator = projectDuelRuntime(session, null);
    expect(isDuelProjection(owner)).toBe(true);
    expect(isDuelProjection(spectator)).toBe(true);
    expect(owner.match.stage).toBe("setup");
    if (owner.match.stage !== "setup" || spectator.match.stage !== "setup") return;
    expect(owner.match.setup.players.find(player => player.playerId === "alice")?.hand).toHaveLength(4);
    expect(owner.match.setup.players.find(player => player.playerId === "bob")).not.toHaveProperty("hand");
    expect(spectator.actions).toEqual([]);
    // Selected Battlefield instance IDs are public; private hands and the receipts/task
    // sidecar are not present in a spectator projection.
    expect(spectator.match.stage === "setup" && spectator.match.setup.players.every(player => !Object.hasOwn(player, "hand"))).toBe(true);
    expect(JSON.stringify(spectator)).not.toContain("receipts");
    expect(JSON.stringify(spectator)).not.toContain("requiredTasks");
    expect(() => projectDuelRuntime(session, "outsider")).toThrow(/unknown viewer/);
  });

  it("offers only the current mulligan owner's own hand and stable action identity", async () => {
    const session = await fixture();
    const projection = projectDuelRuntime(session, "alice");
    expect(projection.actions).toHaveLength(1);
    const action = projection.actions[0]!;
    expect(action.kind).toBe("mulligan");
    expect(action.enabled).toBe(true);
    expect(action.id).toContain("runtime-match");
    expect(action.id).toContain("alice");
    expect(action.id).toContain("0");
    expect(action.id).toContain("mulligan");
    if (action.kind !== "mulligan" || projection.match.stage !== "setup") return;
    expect(action.selectableUIDs).toEqual(
      projection.match.setup.players.find(player => player.playerId === "alice")?.hand?.map(card => card.uid),
    );
    expect(action.maxSelections).toBe(2);
    expect(projectDuelRuntime(session, "bob").actions).toEqual([]);
  });

  it("reaches playing through two core mulligans without inventing a fake turn", async () => {
    const session = completeMulligans(await fixture());
    const projection = projectDuelRuntime(session, null);
    expect(projection.match.stage).toBe("playing");
    if (projection.match.stage !== "playing") return;
    expect(projection.match.frame.phase).toBe("awaiting-turn-start");
    expect(projection.match.resources.players[0]?.runePool.energy).toBe(0);
    expect(projection.actions).toEqual([]);
    expect(JSON.stringify(projection)).not.toContain("receipts");
    expect(JSON.stringify(projection)).not.toContain("requiredTasks");
  });

  it("rejects stale, wrong-actor, unknown, and extra-field packets without trimming them", async () => {
    const session = await fixture();
    const first = session.match.turnOrder[0]!;
    const second = session.match.turnOrder[1]!;
    const wrongActor = executeDuelRuntimeCommand(session, second,
      command("wrong", "wrong", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] }));
    expect(wrongActor.outbound).toMatchObject({ type: "error", code: "command-rejected", requestId: "wrong" });
    expect(wrongActor.persistRequired).toBe(true);
    const stale = executeDuelRuntimeCommand(wrongActor.session, first,
      command("stale", "stale", 99, { type: "mulligan", selectedUIDs: [] }));
    expect(stale.outbound).toMatchObject({ type: "error", code: "command-rejected", requestId: "stale" });
    const unknown = executeDuelRuntimeCommand(session, "outsider",
      command("unknown", "unknown", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] }));
    expect(unknown.outbound).toMatchObject({ type: "error", code: "command-rejected", requestId: "unknown" });
    expect(unknown.persistRequired).toBe(false);
    const extra = { ...command("extra", "extra", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] }), actor: first };
    const parsed = executeDuelRuntimeCommand(session, first, extra);
    expect(parsed.internalResult).toBeNull();
    expect(parsed.session).toBe(session);
    expect(parsed.persistRequired).toBe(false);
    expect(parsed.outbound).toEqual({ type: "error", requestId: "extra", code: "command-rejected", message: "Invalid duel command" });
  });

  it("keeps a semantic rejection sticky and duplicate-safe without rerunning RNG", async () => {
    const session = await fixture();
    let rngCalls = 0;
    const actor = session.match.turnOrder[0]!;
    const packet = command("sticky-request", "sticky-command", session.match.stateVersion,
      { type: "mulligan", selectedUIDs: ["not-in-hand"] });
    const rejected = executeDuelRuntimeCommand(session, actor, packet,
      { randomIndex: () => { rngCalls += 1; return 0; } });
    expect(rejected.persistRequired).toBe(true);
    expect(rejected.internalResult?.outcome).toEqual({ status: "rejected", reason: "mulligan-rejected" });
    const duplicate = executeDuelRuntimeCommand(rejected.session, actor, packet,
      { randomIndex: () => { rngCalls += 1; return 0; } });
    expect(duplicate.internalResult?.duplicate).toBe(true);
    expect(duplicate.persistRequired).toBe(false);
    expect(duplicate.internalResult?.match).toBe(rejected.session.match);
    expect(duplicate.session.receipts).toHaveLength(1);
    expect(rngCalls).toBe(0);
  });

  it("uses the core resource gate for source actions and discards all probes", async () => {
    const source = activeResourceSession(await fixture());
    const before = JSON.stringify(source);
    const owner = projectDuelRuntime(source, source.match.turnOrder[0]!);
    expect(owner.actions.some(action => action.kind === "rune-energy" && action.enabled)).toBe(true);
    expect(owner.actions.some(action => action.kind === "rune-power" && action.enabled)).toBe(true);
    // The client-visible energy label disambiguates the rune's domain through the same
    // DOMAIN_LABEL map as the recycle action; it must not alter uid/kind/enabled.
    const domainLabels = { Fury: "炽烈", Calm: "翠意", Mind: "灵光", Body: "摧破", Chaos: "混沌", Order: "序理" } as const;
    const enabledEnergy = owner.actions.find(action => action.kind === "rune-energy" && action.enabled);
    const energy = enabledEnergy?.kind === "rune-energy" ? enabledEnergy : undefined;
    const rune = owner.match.stage === "playing"
      ? owner.match.resources.bases.flatMap(base => base.baseRunes).find(item => item.uid === energy?.uid)
      : undefined;
    expect(energy?.label).toBe(`横置${domainLabels[rune!.domain]}符文：+1 能量`);
    expect(source.receipts).toHaveLength(2);
    expect(JSON.stringify(source)).toBe(before);
    expect(source.requiredTasks).toBeUndefined();
  });

  it("honors Closed/Alice-required-payment versus Bob-Priority core permission", async () => {
    const source = requiredPaymentSession(await fixture());
    if (source.match.stage !== "playing") throw new Error("expected playing match");
    const alice = source.match.turnOrder[0]!;
    const bob = source.match.turnOrder[1]!;
    const closed = commitDuelPlayingMutation(source.match, draft => ({ ...draft,
      frame: { ...draft.frame, stateOpen: false, priorityPlayerId: bob },
    }));
    const closedSession = { ...source, match: closed };
    const aliceProjection = projectDuelRuntime(closedSession, alice);
    const bobProjection = projectDuelRuntime(closedSession, bob);
    expect(aliceProjection.actions.find(action => action.kind === "pay-pending")?.enabled).toBe(true);
    expect(aliceProjection.actions.some(action => (action.kind === "rune-energy" || action.kind === "rune-power") && action.enabled)).toBe(true);
    expect(bobProjection.actions.filter(action => action.kind !== "pay-pending").every(action => !action.enabled)).toBe(true);
    expect(bobProjection.actions.some(action => action.kind === "pay-pending")).toBe(false);
    expect(closedSession.requiredTasks?.[0]?.status).toBe("active");
    expect(closedSession.receipts).toHaveLength(2);
  });

  it("returns only safe ACK/error DTOs while retaining private result sidecars", async () => {
    const source = requiredPaymentSession(await fixture());
    if (source.match.stage !== "playing") throw new Error("expected playing match");
    const actor = source.match.turnOrder[0]!;
    const paymentId = source.match.frame.pendingPayment?.paymentId;
    if (paymentId === undefined) throw new Error("expected pending payment");
    const packet = command("pay-request", "pay-command", source.match.stateVersion,
      { type: "pay-pending", paymentId, plan: { power: [] } });
    const executed = executeDuelRuntimeCommand(source, actor, packet);
    expect(executed.persistRequired).toBe(true);
    expect(executed.internalResult?.outcome.status).toBe("applied");
    expect(executed.outbound).toEqual(expect.objectContaining({
      type: "request-result", requestId: "pay-request", ok: true,
      commandId: "pay-command", appliedVersion: source.match.stateVersion + 1,
      eventSeq: source.match.eventSeq + 1, duplicate: false,
    }));
    expect(Object.keys(executed.outbound).sort()).toEqual([
      "appliedVersion", "commandId", "duplicate", "eventSeq", "ok", "requestId", "type",
    ]);
    expect(JSON.stringify(executed.outbound)).not.toContain("paymentCompleted");
    expect(JSON.stringify(executed.outbound)).not.toContain("continuationId");
    expect(executed.session.requiredTasks?.[0]?.status).toBe("completed");
  });
});
