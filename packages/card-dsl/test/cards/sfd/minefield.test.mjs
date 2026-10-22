import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minefield.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CANONICAL_ID = "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4";
const SOURCE_TEXT = "When you conquer here, put the top 2 cards of your Main Deck into your trash.";
const c = value => ({ kind: "constant", value });
const field = id => ({ type: "battlefield", id });

// The registry rejects judge-required programs. Lift only this in-memory copy so
// the focused tests can exercise the authored IR through the production engine;
// the committed card status remains judge-required until every gap closes.
const admitted = { ...program, status: "executable", judgeReason: undefined };

function fixture({ mineAt = "bf1", cards = ["top", "second", "third"] } = {}) {
  const kernel = world()
    .player("A")
    .player("B")
    .deck(cards, { owner: "A" })
    .deck(["b:top", "b:second", "b:third"], { owner: "B" })
    .rune(["a:rune:0"], { owner: "A" })
    .rune(["b:rune:0"], { owner: "B" })
    .battlefield("mine", {
      cardId: CANONICAL_ID,
      types: ["battlefield"],
      controller: "A",
      location: field(mineAt),
      energy: null,
      power: null
    })
    .base("mover", { owner: "A", controller: "A", might: 3 })
    .build();
  const choose = request => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === "select-objects" && request.min === 0) return [];
    throw new Error(`Unexpected production choice ${request.type}/${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
  });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  // This explicit register is the supported-adapter golden bootstrap. The
  // default lifecycle does not yet bind pre-existing Board battlefields (gap 1
  // in judgeReason); remove this call once that lifecycle boundary is closed.
  const registered = binding.registerProgramTriggers(flow.chain, kernel.getObject("mine"));
  const settle = (budget = 80) => {
    for (let index = 0; index < budget; index++) {
      if (flow.chain.items.length) {
        flow.pass(flow.chain.priority);
        continue;
      }
      if (flow.chain.focus !== null) {
        flow.pass(flow.chain.focus);
        continue;
      }
      return;
    }
    throw new Error("Minefield resolution did not settle");
  };
  const conquerBf1 = () => flow.execute({
    id: "move-to-bf1",
    controller: "A",
    source: kernel.getObject("mover"),
    kind: "activated",
    speed: "normal",
    body: [{ id: "move", op: "effect.move", args: { to: c(field("bf1")) } }]
  });
  return { kernel, flow, binding, registered, settle, conquerBf1 };
}

test("minefield: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("minefield: exact identity, text, and current judge-required structure", () => {
  assert.equal(program.status, "judge-required");
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /programs\/lifecycle\.ts:439-441/);
  assert.match(program.judgeReason, /combat\/flow\.ts:393/);
  assert.match(program.judgeReason, /per-batch/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.event, "conquered");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  const instruction = ability.body[0];
  assert.equal(instruction.op, "effect.mill");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(instruction.args.player, undefined);
});

test("minefield: the closed trigger contract accepts self conquer at here", () => {
  const result = validateTriggerSpec(program.abilities[0].trigger);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(
    translateTriggerFilter(program.abilities[0].trigger.filter, "mine", "conquer"),
    { event: "conquered", here: true, player: "self" }
  );
});

test("minefield production golden: a real conquer at here enters the chain and mills the top 2", () => {
  const f = fixture({ mineAt: "bf1", cards: ["top", "second", "third", "fourth"] });
  assert.deepEqual(f.registered, ["program:mine:1:0"]);
  f.flow.start();

  f.conquerBf1();
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer").length, 0);
  // The initial execute() only Finalizes the Move. Pass real Priority/Focus until
  // the driver has emitted Conquer; this is the same state machine a match uses.
  for (let guard = 0; guard < 80 &&
    f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer").length === 0; guard++) {
    if (f.flow.chain.items.length) f.flow.pass(f.flow.chain.priority);
    else if (f.flow.chain.focus !== null) f.flow.pass(f.flow.chain.focus);
    else throw new Error("TurnFlow became idle before the real Conquer");
  }
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer").length, 1);
  const triggeringDeck = f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);
  const triggeringTrash = f.kernel.zoneSlice("A", "trash", "top").map(object => object.ref.id);
  f.settle();
  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].player, "A");
  assert.equal(conquer[0].object.ref.id, "mover");
  assert.equal(conquer[0].details.battlefieldId, "bf1");
  assert.equal(f.flow.battlefields[0].controller, "A");
  assert.deepEqual(
    f.kernel.zoneSlice("A", "trash", "top").map(object => object.ref.id),
    triggeringTrash.concat(triggeringDeck.slice(0, 2))
  );
  assert.deepEqual(
    f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id),
    triggeringDeck.slice(2)
  );
  assert.deepEqual(f.kernel.zoneSlice("B", "trash", "top"), []);
  assert.equal(f.flow.chain.items.length, 0);
});

test("minefield production boundary: a conquer at another Battlefield does not trigger here", () => {
  const f = fixture({ mineAt: "bf2", cards: ["top", "second", "third"] });
  f.flow.start();
  const deckBefore = f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);

  f.conquerBf1();
  f.settle();
  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].details.battlefieldId, "bf1");
  assert.equal(f.flow.chain.trace.filter(entry =>
    entry.step === "pending" && String(entry.item ?? "").startsWith("trigger:")).length, 0);
  assert.deepEqual(
    f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id),
    deckBefore
  );
  assert.deepEqual(f.kernel.zoneSlice("A", "trash", "top"), []);
});

test("minefield production boundary: Burn 2 moves fewer cards when the Main Deck is short", () => {
  const f = fixture({ mineAt: "bf1", cards: ["drawn", "last"] });
  f.flow.start();
  assert.deepEqual(f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id), ["last"]);
  f.conquerBf1();
  f.settle();
  assert.deepEqual(f.kernel.zoneSlice("A", "trash", "top").map(object => object.ref.id), ["last"]);
  assert.deepEqual(f.kernel.zoneSlice("A", "deck", "top"), []);
});

test.todo(
  "Minefield: attachLifecycle must register the pre-existing Board battlefield at production setup " +
    "(probe evidence: attach only leaves 0 registrations; programs/lifecycle.ts:439-441 scans Secret Zone only)"
);

test.todo(
  "Minefield: a Battlefield's ability controller must follow the current Battlefield controller under CR 190.6 " +
    "(probe evidence: B controls the Battlefield and Conquers while mine.controller remains A; combat/flow.ts:393 mutates only internal control)"
);

test.todo(
  "Minefield: one multi-Unit Score wave must create one conquer trigger, not one per participating Unit under CR 473.2.c " +
    "(probe evidence: two conquer events share batch action:5 and produce 2 Pending triggers; turn/flow.ts:159-163; TriggerOnce lacks per-batch)"
);
