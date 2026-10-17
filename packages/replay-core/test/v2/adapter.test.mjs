import assert from "node:assert/strict";
import test from "node:test";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import { JournalReplayError, replayJournal } from "../../dist/v2/index.js";
import { makeSetup, recordGame, replayOptions } from "./support.mjs";

const value = value => ({ kind: "constant", value });
const program = {
  canonicalCardId: "synthetic:journal-draw-unit", rulesetVersion: "core-1.5", status: "executable",
  sourceText: "Synthetic replay test: explicit free play, draw one.",
  abilities: [{ kind: "play", cost: { kind: "explicit", energy: value(0), power: value([]) },
    body: [{ id: "draw-one", op: "effect.draw", args: { amount: value(1) } }] }],
};

function syntheticSetup() {
  const card = (id, types = ["unit"]) => ({ id, cardId: program.canonicalCardId, types });
  const deck = seat => ({
    mainDeck: Array.from({ length: 12 }, (_, index) => card(`${seat}:main:${index}`)),
    runeDeck: Array.from({ length: 8 }, (_, index) => card(`${seat}:rune:${index}`, ["rune"])),
    championLegend: card(`${seat}:legend`, ["legend"]), chosenChampion: card(`${seat}:champion`, ["champion"]),
    battlefields: [0, 1, 2].map(index => card(`${seat}:field:${index}`, ["battlefield"])),
  });
  const setup = makeSetup({ matchDecks: [deck("A"), deck("B")] });
  const binding = createProgramBinding({ cardPrograms: [program] });
  return {
    ...setup,
    executeCommand: (match, entry) => {
      const source = setup.kernel.getObject(entry.command.instanceId);
      assert.ok(source);
      assert.equal(source.controller, entry.playerId);
      const draft = binding.describePlay({ type: "play", object: source.ref, player: entry.playerId,
        location: { type: "base", player: entry.playerId } }, source);
      // The journal boundary assigns stable command-derived identities. The
      // program binder's process-local sequence is not a replay UID source.
      match.flow.execute({ ...draft, id: `${entry.commandId}:play`,
        ...(draft.cost ? { cost: { ...draft.cost, id: `${entry.commandId}:cost` } } : {}),
      });
      return { status: "accepted" };
    },
  };
}

test("legacy play adapter resolves a real program through chain, cost and event pipeline", () => {
  const recorded = recordGame({
    setupFactory: syntheticSetup,
    commands: ({ setup }) => [{ playerId: "A", command: {
      type: "play-card", instanceId: setup.kernel.objectsInZone("A", "hand")[0].id, targets: [],
    } }],
  });
  let replaySetup;
  const result = replayJournal(recorded.journal, replayOptions("A", {
    resolveSetup: () => (replaySetup = syntheticSetup()),
    executeCommand: (match, entry) => replaySetup.executeCommand(match, entry),
  }));
  assert.deepEqual(result.steps.map(step => step.projection), recorded.liveSteps.map(step => step.projections[0]));
  assert.equal(result.steps[1].projection.players.A.board.count, 1);
  assert.equal(result.steps[1].projection.players.A.hand.count, result.steps[0].projection.players.A.hand.count);
  assert.ok(recorded.match.events().some(event => event.timingPoint === "card-drawn"));
  const played = replaySetup.kernel.objects.find(object => object.controller === "A" && object.zone === "board");
  assert.equal(played.energy, null);
  assert.equal(played.power, null);
});

test("judge-required program rejection propagates without treating the command as applied", () => {
  const recorded = recordGame({
    setupFactory: syntheticSetup,
    commands: ({ setup }) => [{ playerId: "A", command: {
      type: "play-card", instanceId: setup.kernel.objectsInZone("A", "hand")[0].id, targets: [],
    } }],
  });
  const blocked = createProgramBinding({ cardPrograms: [{
    ...program, status: "judge-required", judgeReason: "Unsupported synthetic instruction", abilities: [],
  }] });
  let setup;
  assert.throws(() => replayJournal(recorded.journal, replayOptions("A", {
    engineVersion: "current-engine-with-blocked-program",
    resolveSetup: () => (setup = syntheticSetup()),
    executeCommand: (_match, entry) => {
      const source = setup.kernel.getObject(entry.command.instanceId);
      return blocked.describePlay({ type: "play", object: source.ref, player: entry.playerId }, source);
    },
  })), error => error instanceof JournalReplayError && error.code === "COMMAND_REJECTED" && error.cause.code === "judge-required");
  assert.equal(setup.kernel.objectsInZone("A", "board").length, 0);
});
