import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/meticulous-restorationist.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan, assessCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-c53e9086202d34746759796f864fa5b794a4a294941dad556175a2e226acace5";
const SOURCE_TEXT =
  "When you play a card with Energy cost :rb_energy_7: or more, you may play me from your trash for :rb_rune_order:.";

test("rad-120-167 Meticulous Restorationist: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-120-167 Meticulous Restorationist: judgeReason names the event condition and trash subscription", () => {
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /基础 Energy/);
  assert.match(program.judgeReason, /activeZones: \[board\]/);
  assert.match(program.judgeReason, /trash/);
});

test("rad-120-167 Meticulous Restorationist: card-played trigger with an optional play-from-trash body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.deepEqual(ability.trigger, {
    at: "card-played",
    filter: { event: "card-played", player: "controller" }
  });
  // CR 383.3.a: one optional Finalize decision, followed by the original body.
  assert.equal(ability.optional, true);
  assert.equal(ability.body.length, 1);
  const [play] = ability.body;
  assert.equal(play.id, "meticulous-restorationist.play-me");
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, undefined);
  // “me from your trash”：静态 IR 用符号选择器 "source" 读自身 ref（契约 3.6），不写运行时 ObjectRef。
  assert.deepEqual(play.args.object, {
    kind: "object-property",
    object: "source",
    property: "ref"
  });
  // “for :rb_rune_order:”：已 Finalize 的费用计划（一个 Order Power），由打出动作收取。
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    value: { finalized: true, power: ["Order"] }
  });
});

test("rad-120-167 Meticulous Restorationist: card-played is a real timing point (383.4.a)", () => {
  // The trigger subscribes to a closed-enum timing point, and the ability's
  // condition contract (a ThresholdSpec over the played card's printed Energy
  // cost) is recorded in judgeReason and the todos, not probed here.
  const timing = getTimingPoint("card-played");
  assert.equal(timing.id, "card-played");
  assert.equal(program.abilities[0].trigger.at, timing.id);
});

test("rad-120-167 Meticulous Restorationist: the original body ignores a stale source reference", () => {
  const kernel = world().object("restorationist", { types: ["gear"], zone: "trash", might: 2 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("restorationist") });
  scoped.perform({ type: "move-zone", object: scoped.ref("restorationist"), to: "hand" });
  const outcome = resolveChainBody(program.abilities[0].body, scoped);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(scoped.getObject("restorationist").zone, "hand");
  assert.equal(outcome.events.length, 0);
});

test("rad-120-167 Meticulous Restorationist: accept path plays the card from trash through effect.play", () => {
  const kernel = world()
    .player("A", { power: ["Order"] })
    .object("restorationist", {
      owner: "A",
      controller: "A",
      types: ["gear"],
      tags: ["Device"],
      might: 2,
      zone: "trash"
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("restorationist") });
  const playInstruction = program.abilities[0].body[0];
  const outcome = resolveChainBody(program.abilities[0].body, scoped);
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("restorationist").zone, "board");
  assert.deepEqual(outcome.events.map((event) => event.action), ["play"]);
  assert.deepEqual(outcome.events.map((event) => event.timingPoint), ["card-played"]);
  // 打出是区域迁移：按 124 取得新的区域身份，旧引用失效（解释器负责，IR 不写运行时时序）。
  assert.notDeepEqual(scoped.getObject("restorationist").ref, scoped.source.ref);
  assert.equal(outcome.linkedValues[`${playInstruction.id}.restored`], 1);
});

test.todo('Meticulous Restorationist: bind the card-played event object, compare its base Energy >=7, and handle null without coercion (CR 206.1, RIFT-359).');
test.todo('Meticulous Restorationist: activate this optional trigger from Trash through the card program lifecycle and resolve it with one Order Power payment.');

test("Meticulous Restorationist: the actual cost planner requires an Order Power override", () => {
  const kernel = world().player("A", { power: ["Order"] })
    .object("restorationist", { types: ["gear"], zone: "trash", energy: 2, power: null }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("restorationist") });
  const override = program.abilities[0].body[0].args.cost.value;
  const plan = buildCostPlan(scoped, { id: "restorationist:cost", cost: { power: { kind: "constant", value: override.power } } });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Order"] }]);
  const receipt = payCostPlan(scoped, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions[0].action.plan.power, ["Order"]);
  const wrong = world().player("A", { power: ["Fury"] })
    .object("restorationist", { types: ["gear"], zone: "trash", energy: 2, power: null }).build();
  const wrongContext = wrong.clone({ sourceSnapshot: wrong.getObject("restorationist") });
  assert.equal(assessCostPayment(wrongContext, plan).payable, false);
});
