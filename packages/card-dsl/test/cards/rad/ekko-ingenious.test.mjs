import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ekko-ingenious.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import Ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import movement from "../../../../engine-core/dist/effects/instructions/continuous.movement.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { duelWorld, mainTiming, readinessFor, moveDuelUnitsStandard } from "../../../../engine-core/test/rules/movement/support.mjs";

const CARD_ID =
  "card.hash-4e3817bb5cbd6b0566c6696ba86ac4b5b31ef599a37c2c9b8a3254e0c9e4665b";

const [ganking, play] = program.abilities;
const [costPayment] = play.cost.payments;

test("rad-061-167 Ekko, Ingenious: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /return-to-hand/);
  assert.match(program.judgeReason, /mandatory additional/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /RIFT-358 进行中/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /zones\/movement\.ts/);
});

test("rad-061-167 Ekko, Ingenious: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "As an additional cost to play me, return a friendly unit to its owner's hand.\n" +
      "[Ganking] (I can move from battlefield to battlefield.)"
  );
});

test("rad-061-167 Ekko, Ingenious: [Ganking] is declared without a value (810.1)", () => {
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
});

test("rad-061-167 Ekko, Ingenious: the additional cost is mandatory, not optional (356.2)", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.optional, false);
  assert.equal(play.cost.payments.length, 1);
});

test("rad-061-167 Ekko, Ingenious: the returned unit is a non-target cost choice, not a target (355.10.c)", () => {
  assert.equal(costPayment.kind, "return-to-hand");
  assert.equal(costPayment.choice.id, "ekko-ingenious.returned-unit");
  assert.equal(costPayment.choice.min, 1);
  assert.equal(costPayment.choice.max, 1);
  assert.equal(costPayment.choice.selection, "one");
  assert.deepEqual(costPayment.choice.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  // Costs use picks; a TargetSpec here would wrongly fire "becomes a target" (355.10.c.1).
  assert.equal(costPayment.choice.targets, undefined);
});

test("rad-061-167 Ekko, Ingenious: the card has no effect body beyond cost and Ganking", () => {
  assert.deepEqual(play.body, []);
  assert.equal(program.abilities.length, 2);
});

test("rad-061-167 Ekko, Ingenious: the intended cost move is expressible by effect.zone (evidence for the missing cost kind)", () => {
  // The movement the cost wants exists (move a friendly unit to its owner's hand); what is
  // missing is charging it as a play cost (cost/plan-values.ts has no "return-to-hand" kind).
  const kernel = world().unit("friendly-unit").build();
  const ref = kernel.ref("friendly-unit");
  const run = runInstruction(
    zone,
    {
      // effect.zone takes the PickSpec id literally (its schema rejects an Expr here).
      pick: "ekko-ingenious.returned-unit",
      to: { kind: "constant", value: "hand" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, picks: { "ekko-ingenious.returned-unit": [ref] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").zone, "hand");
  assert.equal(kernel.player("A").handSize, 1);
  // 417.1.c style routing belongs to the action layer; here the owner's hand is the default.
  assert.equal(kernel.getObject("friendly-unit").owner, "A");
  // The kernel routes the move through the closed return-to-hand action (417/423.1).
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test.todo('Ekko, Ingenious: collect return-to-hand as a mandatory additional play cost, using a friendly-unit non-target choice (CR 356.2/355.10.c; RIFT-358)');
test.todo('Ekko, Ingenious: normalize the Ganking static permission to the movement query route shape (CR 810.1.b)');

test("Ekko, Ingenious: the movement primitive executes the expanded Ganking permission and the Standard Move consumer reads it", () => {
  const scene = duelWorld();
  const board = scene.place(scene.board, "ekko", "A", scene.bf1);
  const f = fixture({ cards: [{ id: "ekko", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("ekko"), to: "battlefield", location: { type: "battlefield", id: scene.bf1 } });
  f.engine.advance();
  const [permission] = Ganking.expand({ host: { canonicalCardId: CARD_ID } });
  const context = f.kernel.clone({ sourceSnapshot: f.kernel.getObject("ekko") });
  const expanded = permission.effect;
  const constant = value => ({ kind: "constant", value });
  const run = runInstruction(movement, {
    permission: constant(expanded.permission), source: constant(expanded.source),
    destination: constant(expanded.destination), move: constant(expanded.move),
    addsPermission: constant(expanded.addsPermission),
    appliesTo: { kind: "object-property", object: "self", property: "ref" }
  }, { world: context });
  assert.equal(run.result.status, "executed");
  const registry = new ContinuousEffectRegistry();
  for (const entry of context.continuousEffects) registry.register(entry.effect, entry.duration);
  const readiness = readinessFor(board);
  const request = { actor: "A", unitUIDs: ["ekko"], destinationLocationId: scene.bf2, timing: mainTiming("A") };
  const rules = {
    registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.kernel.getObject(unit.objectId),
  };
  assert.equal(readiness[0].hasGanking, false, "permission comes from the declared route via continuous.movement");
  const moved = moveDuelUnitsStandard(board, readiness, request, rules);
  assert.equal(moved.board.units[0].locationId, scene.bf2);
  assert.equal(moved.group.exhaustedCount, 1);
  assert.equal(moved.readiness[0].readied, false);
  for (const entry of registry.list()) registry.remove(entry.effect.id);
  assert.throws(() => moveDuelUnitsStandard(board, readiness, request, rules), /needs Ganking/);
});
