import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isV2Projection, type V2Command } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, projectionDigest, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

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
  });

  it("rebuilds the same projection from journal commands", () => {
    const options = { matchId: "m3", decks: [m1Deck("rumble-sfd"), m1Deck("fiora-sfd")] as const, seed: "m3" };
    const runtime = createEngineRuntime(options).start();
    runtime.submit(runtime.projectFor(null).activePlayerId, command({ type: "pass" }, "cmd-1", 0));
    const journal = runtime.journal();
    const restored = createEngineRuntime(options).restore(journal);
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
    expect(runtime.journal().head.stateDigest).toBe(projectionDigest(runtime.projectFor(null)));
  });

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
  });

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
});
