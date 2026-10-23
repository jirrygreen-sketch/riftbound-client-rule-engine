import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/concentrate.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-faa895f1e7713ee3a12d2dc5921967e2171457086b5582208825c5b0eae45fd6";
const SOURCE_TEXT =
  "Draw 2.\n" +
  "[Level 6][>] This costs :rb_energy_2: less. (While you have 6+ XP, get the effect.)\n" +
  "[Level 11][>] This costs :rb_energy_4: less instead.";

const [levelSix, levelEleven, play] = program.abilities;
const [drawTwo] = play.body;

test("unl-091-219 Concentrate: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-091-219 Concentrate: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /356\.4/);
  // Re-probed 2026-10-18: the planner applies caller-supplied discounts but no
  // production path derives them from a card's static effect. The Level gates
  // now retain the real controller-xp count shape; the base evaluator still
  // cannot read that subject.
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /discounts/);
  assert.match(program.judgeReason, /controller-xp/);
  assert.doesNotMatch(program.judgeReason, /level-active/);
});

test("unl-091-219 Concentrate: the two [Level] cost reductions are recorded as static cost.modify shapes", () => {
  assert.equal(program.abilities.length, 3);
  for (const [ability, amount, threshold] of [
    [levelSix, -2, 6],
    [levelEleven, -4, 11]
  ]) {
    assert.equal(ability.kind, "static");
    // 356.4: the discount applies to this card's printed Energy cost while it is
    // being played; no merged consumer reads this shape (see judgeReason).
    assert.deepEqual(ability.effect, {
      kind: "cost.modify",
      resource: "energy",
      component: "total",
      appliesTo: "self",
      amount: { kind: "constant", value: amount }
    });
    // 824.1.b.1 / 824.1.c: the Level gate is the controller's XP threshold.
    assert.deepEqual(ability.condition, {
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: threshold }
    });
  }
});

test("unl-091-219 Concentrate: the play half is an independent Draw 2", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(drawTwo.id, "concentrate.draw-2");
  assert.equal(drawTwo.op, "effect.draw");
  assert.deepEqual(drawTwo.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawTwo.linkedTo, undefined);
  assert.equal(drawTwo.condition, undefined);
});

test("unl-091-219 Concentrate golden: Draw 2 draws two cards for the caster", () => {
  const kernel = world().player("A").deck(["card-one", "card-two", "card-three"]).build();
  const run = runInstruction(draw, { amount: drawTwo.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("unl-091-219 Concentrate golden: a short deck still draws as many as possible (432.1.c)", () => {
  const kernel = world().deck(["only-card"]).build();
  const run = runInstruction(draw, { amount: drawTwo.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
});

test("unl-091-219 Concentrate golden: the merged cost plan really applies a caller-supplied discount (356.4)", () => {
  // Re-checked 2026-10-17: the Finalize-side consumer really subtracts a
  // caller-supplied discount from the printed Energy total; what is missing is a
  // path that derives that input from the card's static cost.modify declaration.
  const kernel = world().player("A", { energy: 5 }).build();
  kernel.addObject({
    ref: { id: "concentrate", zoneEntryId: 1 },
    cardId: program.canonicalCardId,
    name: "Concentrate",
    types: ["spell"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "chain",
    location: null,
    might: null,
    energy: 5,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, "chain");
  const context = kernel.clone({ source: kernel.ref("concentrate"), sourceSnapshot: kernel.getObject("concentrate") });
  const plan = buildCostPlan(context, {
    id: "cost:concentrate",
    cost: { kind: "explicit", energy: { kind: "constant", value: 5 } },
    discounts: [{ id: "level-6", resource: "energy", amount: { kind: "constant", value: 2 } }]
  });
  assert.equal(plan.finalized, true);
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.discounts.map((entry) => entry.amount), [2]);
});

test("unl-091-219 Concentrate: the merged static binder installs both cost.modify declarations (CR 356.4)", () => {
  // Re-probed 2026-10-17: the production static binder (createEngineStaticBinder,
  // used by attachProgramLifecycle) has no layer mapping for cost.modify, so the
  // card's discount declaration cannot reach any Finalize cost plan. This test
  // drives the real binder instead of asserting the refusal from prose.
  const board = fixture({
    cards: [{ id: "concentrate", cardId: program.canonicalCardId, types: ["spell"], energy: 5, power: null, might: null }]
  });
  const binder = createEngineStaticBinder(board.engine);
  for (const ability of [levelSix, levelEleven]) {
    const handle = binder.bindStatic(ability, board.kernel.getObject("concentrate"));
    assert.equal(typeof handle.unbind, "function");
    handle.unbind();
  }
});

test("unl-091-219 Concentrate boundary: the retained Level count shape counts objects instead of XP (CR 824.1.b.1 / 824.1.c)", () => {
  // The authored gates now use the contract's controller-xp subject. The base
  // interpreter still evaluates count as queryObjects(filter).length, so an
  // object-rich zero-XP state incorrectly activates the Level 6 branch while a
  // six-XP state with no matching objects incorrectly deactivates it.
  const withXpNoObjects = world().player("A", { xp: 6 }).build();
  const withObjectsNoXp = world().player("A", { xp: 0 });
  for (let index = 0; index < 6; index++) withObjectsNoXp.unit(`unit-${index}`, { might: 1 });
  const populated = withObjectsNoXp.build();
  const evaluate = (ability, kernel) => resolveChainBody([{
    id: "check-level-gate",
    op: "condition.value",
    args: { value: { kind: "constant", value: true } },
    condition: ability.condition
  }], kernel);
  assert.equal(evaluate(levelSix, withXpNoObjects).results[0].result.status, "negated");
  assert.equal(evaluate(levelSix, populated).results[0].result.status, "executed");
  assert.equal(evaluate(levelEleven, populated).results[0].result.status, "negated");
  assert.deepEqual(levelSix.condition.left, { kind: "count", subject: "controller-xp", filter: { player: "controller" } });
  assert.deepEqual(levelEleven.condition.left, levelSix.condition.left);
});
