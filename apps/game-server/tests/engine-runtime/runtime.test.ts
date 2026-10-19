import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isV2Projection, type V2Command } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, projectionDigest, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";

type M1Card = {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly cardType: string;
};

type M1Candidate = {
  readonly id: string;
  readonly chosenChampion: string;
  readonly officialCardList: readonly M1Card[];
};

const m1Catalog = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
  readonly candidates: readonly M1Candidate[];
};

function m1Deck(candidateId: string): EngineRuntimeDeck {
  const candidate = m1Catalog.candidates.find(item => item.id === candidateId);
  if (!candidate) throw new Error(`Unknown M1 candidate ${candidateId}`);
  const expand = (entries: readonly M1Card[], zone: string) => entries.flatMap(entry => Array.from({ length: entry.quantity }, (_, index) => ({
    id: `${candidate.id}:${zone}:${index}:${entry.canonicalCardId}`,
    cardId: entry.canonicalCardId,
    name: entry.name,
    types: [entry.cardType.toLowerCase()],
    energy: null,
    power: null,
  })));
  const legendEntry = candidate.officialCardList.find(entry => entry.zone === "legend");
  const chosenEntry = candidate.officialCardList.find(entry => entry.zone === "champion" && entry.name === candidate.chosenChampion);
  if (!legendEntry || !chosenEntry) throw new Error(`Incomplete M1 candidate ${candidateId}`);
  const mainDeck = expand(candidate.officialCardList.filter(entry => entry.zone === "mainDeck"), "main");
  const chosenIndex = mainDeck.findIndex(card => card.cardId === chosenEntry.canonicalCardId);
  if (chosenIndex < 0) throw new Error(`Chosen champion is absent from M1 main deck ${candidateId}`);
  mainDeck.splice(chosenIndex, 1);
  const battlefields = expand(candidate.officialCardList.filter(entry => entry.zone === "battlefields"), "battlefield");
  if (battlefields.length !== 3) throw new Error(`M1 candidate ${candidateId} must have three battlefields`);
  return {
    mainDeck,
    runeDeck: expand(candidate.officialCardList.filter(entry => entry.zone === "runes"), "rune"),
    championLegend: { ...expand([legendEntry], "legend")[0]! },
    chosenChampion: { ...expand([chosenEntry], "champion")[0]! },
    battlefields: battlefields as EngineRuntimeDeck["battlefields"],
  };
}

function command(command: Omit<V2Command, "commandId" | "stateVersion">, commandId: string, stateVersion: number): V2Command {
  return { ...command, commandId, stateVersion } as V2Command;
}

describe("engine runtime", () => {
  it("keeps ordinary Buffs separate from layered Empowered state and rolls back a failed mutation", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
    const ref = host.addCard("A", { id: "empower-card", cardId: "card", name: "Unit", types: ["unit"] }, "board");
    expect(host.object(ref)).toMatchObject({ buffs: 0, empowered: 0 });
    expect(host.perform({ type: "buff", object: ref, amount: 2 }).status).toBe("done");
    expect(host.perform({ type: "empower", object: ref }).status).toBe("done");
    expect(host.perform({ type: "empower", object: ref }).status).toBe("prevented");
    expect(host.object(ref)).toMatchObject({ buffs: 2, empowered: 1 });
    expect(host.perform({ type: "empower", object: ref, amount: 2, multiple: true, limit: 3 }).status).toBe("done");
    expect(host.object(ref)).toMatchObject({ buffs: 2, empowered: 3 });
    const checkpoint = host.checkpoint();
    expect(host.perform({ type: "disempower", object: ref }).status).toBe("done");
    expect(host.object(ref)).toMatchObject({ buffs: 2, empowered: 2 });
    host.restore(checkpoint);
    expect(host.object(ref)).toMatchObject({ buffs: 2, empowered: 3 });
    expect(host.perform({ type: "disempower", object: ref }).status).toBe("done");
    expect(host.perform({ type: "disempower", object: ref }).status).toBe("done");
    expect(host.perform({ type: "disempower", object: ref }).status).toBe("done");
    expect(host.perform({ type: "disempower", object: ref }).status).toBe("prevented");
    expect(host.object(ref)).toMatchObject({ buffs: 2, empowered: 0 });
  });

  it("starts the new match lifecycle and keeps opponent hand identities private", () => {
    const decks = [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")] as const;
    const opening = createEngineRuntime({ matchId: "m1-opening", decks, seed: "m1" }).start();
    const selectedA = opening.projectFor("A").zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects?.[0]?.cardId;
    const selectedB = opening.projectFor("B").zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "B")?.objects?.[0]?.cardId;
    expect(selectedA).toBeTruthy();
    expect(selectedB).toBeTruthy();
    const runtime = createEngineRuntime({ matchId: "m1", decks, seed: "m1", mulligans: [[selectedA!], [selectedB!]] }).start();
    const own = runtime.projectFor("A");
    const opponent = runtime.projectFor("B");
    const spectator = runtime.projectFor(null);
    expect(isV2Projection(own)).toBe(true);
    expect(isV2Projection(opponent)).toBe(true);
    expect(isV2Projection(spectator)).toBe(true);
    expect(own.players.find(player => player.playerId === "A")?.handCount).toBe(5);
    expect(opponent.players.find(player => player.playerId === "A")?.handCount).toBe(5);
    expect(opponent.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects).toBeUndefined();
    expect(opponent.objects.filter(object => object.ownerPlayerId === "A" && object.zone === "facedown").every(object => object.cardId === undefined && object.name === undefined)).toBe(true);
  });

  // Runtime bootstrapping loads protocol + engine-core source through the
  // per-worker transformer; under serial full-suite load these can exceed the
  // default 10s without any assertion change.
  it("enforces state versions, command idempotency, and journal metadata", () => {
    const runtime = createEngineRuntime({ matchId: "m2", decks: [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")], seed: "m2" }).start();
    const initial = runtime.projectFor(null);
    const actor = initial.activePlayerId;
    const pass = command({ type: "pass" }, "cmd-1", 0);
    const accepted = runtime.submit(actor, pass);
    expect(accepted.receipt.status).toBe("accepted");
    expect(accepted.receipt.stateVersion).toBe(1);
    const duplicate = runtime.submit(actor, pass);
    expect(duplicate.receipt.status).toBe("duplicate");
    expect(runtime.submit("B", command({ type: "pass" }, "cmd-stale", 0)).receipt.status).toBe("rejected");
    const journal = runtime.journal();
    expect(journal.header.engineVersion).toContain("engine-core");
    expect(journal.header.rulesetVersion).toBe("core-1.5");
    expect(journal.entries.filter(entry => entry.commandId === "cmd-1")).toHaveLength(2);
    expect(journal.entries.at(-1)?.duplicate).toBe(true);

    let stateVersion = accepted.receipt.stateVersion;
    for (let index = 0; index < 4; index += 1) {
      const actorNow = runtime.projectFor(null).activePlayerId;
      const next = runtime.submit(actorNow, command({ type: "pass" }, `cmd-turn-${index}`, stateVersion));
      expect(next.receipt.status).toBe("accepted");
      stateVersion = next.receipt.stateVersion;
    }
    expect(runtime.projectFor(null).turnNumber).toBeGreaterThan(1);
  }, 60_000);

  it("rebuilds the same projection from journal commands", () => {
    const options = { matchId: "m3", decks: [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")] as const, seed: "m3" };
    const runtime = createEngineRuntime(options).start();
    runtime.submit(runtime.projectFor(null).activePlayerId, command({ type: "pass" }, "cmd-1", 0));
    const journal = runtime.journal();
    const restored = createEngineRuntime(options).restore(journal);
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
    expect(runtime.journal().head.stateDigest).toBe(projectionDigest(runtime.projectFor(null)));
  }, 60_000);

  it("restores setup mulligans from journal metadata and rejects forged actors", () => {
    const decks = [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")] as const;
    const opening = createEngineRuntime({ matchId: "m5-probe", decks, seed: "m5" }).start();
    const selected = opening.projectFor("A").zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects?.[0]?.cardId;
    expect(selected).toBeTruthy();
    const runtime = createEngineRuntime({ matchId: "m5", decks, seed: "m5", mulligans: [[selected!], []] }).start();
    const restored = createEngineRuntime({ matchId: "m5", decks, seed: "m5" }).restore(runtime.journal());
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));

    const opponentCard = runtime.projectFor("B").objects.find(object => object.zone === "hand" && object.ownerPlayerId === "B");
    expect(opponentCard?.objectId).toBeTruthy();
    const forged = runtime.submit("A", { type: "move", commandId: "forged", stateVersion: 0, objectId: opponentCard!.objectId, to: { zone: "base", playerId: "A" } });
    expect(forged.receipt.status).toBe("rejected");
    const invalid = runtime.submit("C", { type: "unknown", commandId: "invalid", stateVersion: 0 } as never);
    expect(invalid.receipt.status).toBe("rejected");
    expect(isV2Projection(invalid.projection)).toBe(true);

    runtime.submit(runtime.projectFor(null).activePlayerId, { type: "pass", commandId: "integrity", stateVersion: 0 });
    const forgedJournal = structuredClone(runtime.journal()) as any;
    forgedJournal.entries[0].result = { accepted: false };
    expect(() => createEngineRuntime({ matchId: "m5", decks, seed: "m5" }).restore(forgedJournal)).toThrow(/integrity|digest/i);
  }, 60_000);

  // Loading protocol + engine-core source through the per-worker transformer can
  // take >10s under parallel load; give this case its own headroom so the real
  // suspension/replay behavior is what is under test, not the runner's clock.
  it("journals a suspended choice and replays it before the answer", () => {
    const decks = [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")] as const;
    const probe = createEngineRuntime({ matchId: "m4", decks, seed: "m4" }).start();
    const source = probe.projectFor("A").objects.find(object => object.zone === "hand" && object.ownerPlayerId === "A" && object.cardId);
    expect(source?.cardId).toBeTruthy();
    const program = {
      canonicalCardId: source!.cardId,
      rulesetVersion: "core-1.5",
      status: "executable",
      sourceText: "runtime choice test",
      abilities: [{
        kind: "activated",
        timing: "action",
        cost: { kind: "explicit", energy: { kind: "constant", value: 0 } },
        body: [{ id: "choose", op: "choice.optional", args: { body: { kind: "constant", value: [] } } }],
      }],
    } as const;
    const runtime = createEngineRuntime({ matchId: "m4", decks, seed: "m4", programs: [program] }).start();
    const objectId = source!.objectId;
    runtime.submit("A", { type: "move", commandId: "move-choice-source", stateVersion: 0, objectId, to: { zone: "base", playerId: "A" } });
    runtime.submit("A", { type: "activate", commandId: "activate-choice", stateVersion: 1, sourceObjectId: objectId, abilityId: "0" });
    runtime.submit("A", { type: "pass", commandId: "pass-choice-a", stateVersion: 2 });
    const pending = runtime.submit("B", { type: "pass", commandId: "pass-choice-b", stateVersion: 3 });
    expect(pending.receipt.status).toBe("pending");
    expect(pending.receipt.choice?.ownerPlayerId).toBe("A");
    expect(runtime.journal().entries.at(-1)?.pendingReason).toMatchObject({ kind: "optional" });
    expect(runtime.projectFor("B").pendingChoice).toEqual({
      status: "pending",
      choiceId: pending.receipt.choice!.choiceId,
      ownerPlayerId: "A",
      stateVersion: 3,
      kind: "optional",
    });
    const answered = runtime.submit("A", {
      type: "choose",
      commandId: "answer-choice",
      stateVersion: 3,
      choiceId: pending.receipt.choice!.choiceId,
      answer: false,
    });
    expect(answered.receipt.status).toBe("accepted");
    const restored = createEngineRuntime({ matchId: "m4", decks, seed: "m4", programs: [program] }).restore(runtime.journal());
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
  }, 60_000);

  it("projects an authoritative number range only to its chooser and rejects malformed answers", () => {
    const decks = [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")] as const;
    const probe = createEngineRuntime({ matchId: "number-probe", decks, seed: "number" }).start();
    const source = probe.projectFor("A").objects.find(object => object.zone === "hand" && object.ownerPlayerId === "A" && object.cardId);
    expect(source?.cardId).toBeTruthy();
    const program = {
      canonicalCardId: source!.cardId,
      rulesetVersion: "core-1.5",
      status: "executable",
      sourceText: "number choice test",
      abilities: [{
        kind: "activated",
        timing: "action",
        cost: { kind: "explicit", energy: { kind: "constant", value: 0 } },
        body: [{
          id: "repeat", op: "effect.repeat",
          args: {
            choices: { kind: "constant", value: [{ id: "repeat-amount", field: "amount", type: "number",
              min: { kind: "literal", value: 1 }, max: { kind: "literal", value: 2 } }] },
            actions: { kind: "constant", value: [{ type: "gain-energy",
              values: { player: { kind: "literal", value: "A" }, amount: { kind: "literal", value: 1 } } }] },
          },
        }],
      }],
    } as const;
    const runtime = createEngineRuntime({ matchId: "number", decks, seed: "number", programs: [program] }).start();
    const objectId = source!.objectId;
    const moved = runtime.submit("A", { type: "move", commandId: "move-number-source", stateVersion: 0,
      objectId, to: { zone: "base", playerId: "A" } });
    const played = runtime.submit("A", { type: "activate", commandId: "activate-number", stateVersion: moved.receipt.stateVersion,
      sourceObjectId: objectId, abilityId: "0" });
    expect(played.receipt.status).toBe("accepted");
    const firstPass = runtime.submit("A", { type: "pass", commandId: "pass-number-a", stateVersion: played.receipt.stateVersion });
    const next = runtime.submit("B", { type: "pass", commandId: "pass-number-b", stateVersion: firstPass.receipt.stateVersion });
    expect(next.receipt.status).toBe("pending");
    const owner = runtime.projectFor("A").pendingChoice;
    expect(owner).toMatchObject({ status: "pending", kind: "number", min: 1, max: 2 });
    expect(runtime.projectFor("B").pendingChoice).toEqual({ status: "pending", choiceId: owner.choiceId,
      ownerPlayerId: "A", stateVersion: owner.stateVersion, kind: "number", min: 1, max: 2 });
    const choiceId = owner.choiceId;
    for (const answer of [0, 3, 1.5, Number.NaN]) {
      const rejected = runtime.submit("A", { type: "choose", commandId: `bad-number-${String(answer)}`,
        stateVersion: next.receipt.stateVersion, choiceId, answer });
      expect(rejected.receipt.status).toBe("rejected");
      expect(runtime.projectFor("A").pendingChoice).toMatchObject({ status: "pending", choiceId });
    }
    const accepted = runtime.submit("A", { type: "choose", commandId: "good-number",
      stateVersion: next.receipt.stateVersion, choiceId, answer: 1 });
    expect(accepted.receipt.status).toBe("accepted");
    expect(runtime.submit("A", { type: "choose", commandId: "good-number",
      stateVersion: next.receipt.stateVersion, choiceId, answer: 1 }).receipt.status).toBe("duplicate");
    const restored = createEngineRuntime({ matchId: "number", decks, seed: "number", programs: [program] })
      .restore(runtime.journal());
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
  }, 60_000);
});
