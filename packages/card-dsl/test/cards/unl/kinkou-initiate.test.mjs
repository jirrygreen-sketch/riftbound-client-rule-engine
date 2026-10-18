// Whole-card execution evidence (the card-played Play Effect and the gated
// Draw 1 body through the real chain path) lives in
// test/cards/templates/triggered-card-played-effect-draw-656.test.mjs. This file
// keeps validation, identity, structure and the remaining sum-over-set gap.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/kinkou-initiate.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-578f670d7fdae87fd32e34179e331f901a8f108dcb51c337c971db00b3e3c498";
const SOURCE_TEXT = "When you play me, draw 1 if your other units have total Might 5 or more.";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("unl-097-219 Kinkou Initiate: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-097-219 Kinkou Initiate: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.2\.a\.1/);
  assert.match(program.judgeReason, /total Might/);
  assert.match(program.judgeReason, /count/);
  // The reason names the missing sum-over-set expression; exclude is already
  // consumed by the interpreter query path.
  assert.match(program.judgeReason, /sum-over-set|reduce/);
});

test("unl-097-219 Kinkou Initiate: 'when you play me' trigger is the card-played Play Effect", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-097-219 Kinkou Initiate: the gate sits on the draw instruction, not on the trigger", () => {
  // 383.2.a.1: "if …" follows the instruction, so it is part of the Effect; the
  // Loose Cannon example in the Core Rules has the same structure.
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "kinkou-initiate.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  // The draw is the implicit "you" = the ability controller (190.6.d).
  assert.equal(drawInstruction.args.player, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);

  const condition = drawInstruction.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-friendly-units-total-might");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    exclude: "self"
  });
});

test("unl-097-219 Kinkou Initiate golden: the merged effect.draw instruction really draws 1", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("unl-097-219 Kinkou Initiate: the printed gate is a sum of Effective Might over the filtered set", () => {
  // 143.2.a.1 / 143.1.b: "your other units have total Might 5 or more" sums the
  // Effective Might of the host's other board units. The card keeps the count
  // placeholder because no merged Expr produces that sum; this pins the rules
  // reading so the placeholder cannot be mistaken for it.
  const kernel = world()
    .unit("initiate", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("strong", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("weak", { owner: "A", controller: "A", might: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const others = kernel
    .query({ type: "unit", zone: "board", controller: "A" })
    .filter(unit => unit.ref.id !== "initiate");
  assert.deepEqual(others.map(unit => unit.might), [4, 1]);
  assert.equal(others.reduce((sum, unit) => sum + unit.might, 0), 5);
});

test("unl-097-219 Kinkou Initiate: the retained count diverges from the printed Might total", () => {
  // One other unit with Might 5 satisfies the printed sum (143.2.a.1) while the
  // retained count reads 1. Pinning the divergence keeps the placeholder from
  // ever being read as "sum of Might".
  const kernel = world()
    .unit("initiate", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("strong", { owner: "A", controller: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const others = kernel.query({ type: "unit", zone: "board", controller: "A" }).filter(unit => unit.ref.id !== "initiate");
  assert.equal(others.reduce((sum, unit) => sum + unit.might, 0), 5);
  assert.equal(others.length, 1);
  assert.notEqual(others.length, others.reduce((sum, unit) => sum + unit.might, 0));
});

test("unl-097-219 Kinkou Initiate golden: a single Might-5 ally still leaves the gate closed", async () => {
  // Real chain path (effects/testing/scenario: ProgramBinding + ChainEngine +
  // EventPipeline). The printed total is 5 but the retained count reads 1, so no
  // card is drawn — the placeholder's divergence is observable, not cosmetic.
  const { runCardScenario } = await import("../../../../engine-core/dist/effects/testing/scenario/index.js");
  const executableView = { ...program, status: "executable", judgeReason: undefined };
  const deckCards = count => Array.from({ length: count }, (_, index) => ({ id: `deck-${index}`, owner: "A", types: ["unit"], zone: "deck" }));
  const run = allies => runCardScenario(executableView, {
    players: { A: { energy: 20 } },
    objects: [
      {
        id: "kinkou",
        cardId: CANONICAL_ID,
        program: executableView,
        types: ["unit"],
        zone: "hand",
        energy: 3,
        power: null,
        might: 3
      },
      ...allies,
      ...deckCards(2)
    ],
    operations: [
      { type: "play", object: "kinkou", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });

  const printedFive = run([{ id: "strong", owner: "A", types: ["unit"], zone: "board", might: 5 }]);
  assert.equal(printedFive.state.players.A.handSize, 0);
  assert.equal(printedFive.state.players.A.deckSize, 2);
  assert.deepEqual(Object.keys(printedFive.links).filter(key => key.endsWith("drawn")), []);

  // Five Might-1 allies make the retained count and the printed sum agree, which
  // is the only world where the placeholder reproduces the printed behaviour.
  const counting = run(Array.from({ length: 5 }, (_, index) => ({
    id: `ally-${index}`, owner: "A", types: ["unit"], zone: "board", might: 1
  })));
  assert.equal(counting.links["kinkou-initiate.draw.drawn"], 1);
  assert.equal(counting.state.players.A.handSize, 1);
  assert.equal(counting.state.players.A.deckSize, 1);
});

test("unl-097-219 Kinkou Initiate golden: the card-played trigger registers through the merged program binding", async () => {
  // programs/filters.ts normalises {source: "self"} to the host object filter
  // and programs/triggers.ts registers the subscription; both halves of the
  // Play Effect are therefore merged.
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const f = fixture({ cards: [{ id: "initiate", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: [], might: 3 }], describePlay: binding.describePlay });
  const snapshot = { ...f.kernel.getObject("initiate"), cardId: CANONICAL_ID, zone: "board" };

  const ids = binding.registerProgramTriggers(f.engine, snapshot);
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^program:initiate:1:/);
});

test("unl-097-219 Kinkou Initiate golden: the body runs through the chain adapter and honours its gate", async () => {
  // The merged instruction path runs the card's own body. The world below is
  // chosen so the printed Might sum is 5 while the retained count placeholder
  // does not satisfy the gate, preserving evidence for the judge-required gap.
  const { resolveChainBody } = await import("../../../../engine-core/dist/chain/interpreter-adapter.js");
  const { translateInstructionTargets } = await import("../../../../engine-core/dist/programs/filters.js");
  const kernel = world()
    .unit("initiate", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("weak-ally", { owner: "A", controller: "A", might: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("strong-ally", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .deck(["top", "second"])
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("initiate"), controller: "A" });

  const totalMight = kernel
    .query({ type: "unit", zone: "board", controller: "A" })
    .filter(unit => unit.ref.id !== "initiate")
    .reduce((sum, unit) => sum + unit.might, 0);
  assert.equal(totalMight, 5);
  const outcome = resolveChainBody(translateInstructionTargets(ability.body), ctx);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    [outcome.results[0].result.status, outcome.results[0].result.reason],
    ["negated", "skipped"]
  );
  assert.equal(ctx.player("A").handSize, 0);
});

test.todo(
  "unl-097-219 Kinkou Initiate: sum Effective Might over the controller's other board units before " +
    "evaluating the draw gate, covering both sides of the threshold (CR 143.2.a.1; sum-over-set Expr)"
);
