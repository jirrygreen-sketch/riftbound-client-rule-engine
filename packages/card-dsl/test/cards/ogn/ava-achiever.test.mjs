import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ava-achiever.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Ava Achiever program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Ava Achiever identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-2c1a169269b0950e25c0db04cc22a192284b006d0d720477f488d2f0ddef6e3b"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason names the remaining finalize/pick wiring instead of a missing
  // payment primitive.
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /finalized cost plan/);
  assert.match(program.judgeReason, /picks/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.equal(
    program.sourceText,
    "When I attack, you may pay :rb_rune_mind: to play a card with [Hidden] from your hand here, ignoring its cost."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: attack trigger (once per combat) with a single choice.optional wrapper", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "attack-declared");
  // 383.4.e.2.a：攻击触发每次战斗只检查一次。
  assert.equal(ability.trigger.once, "per-combat");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);

  // 契约 §3.9："you may …" 必须把被选择的指令包进 choice.optional 的 body，
  // 不得写成 choice + 后续 linkedTo。
  assert.equal(ability.body.length, 1);
  const [choice] = ability.body;
  assert.equal(choice.id, "ava.opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.linkedTo, undefined);
  assert.equal(choice.args.body.kind, "constant");

  const body = choice.args.body.value;
  assert.deepEqual(
    body.map(instruction => instruction.id),
    ["ava.pay", "ava.play-hidden"]
  );

  // ":rb_rune_mind:" = 1 Mind Power（134/163.1）。
  assert.equal(body[0].op, "cost.pay");
  assert.deepEqual(body[0].args.payments, c({ energy: 0, power: ["Mind"] }));
  assert.equal(body[0].linkedTo, undefined);

  const play = body[1];
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, "ava.pay");
  // 355.7：非公开区域（手牌）的选择不是目标 → 用 picks，不是 targets。
  assert.equal(play.targets, undefined);
  assert.deepEqual(play.args.pick, c("ava.hidden-card"));
  // 356.1.b.1：ignoring its cost → base Energy/Power 皆置 0 的 finalized 计划。
  assert.deepEqual(play.args.cost, c({ finalized: true, energy: 0, power: [] }));
  // 359.3.f/359.3.f.2："here" 在执行时读取来源当前位置。
  assert.deepEqual(play.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.equal(play.picks.length, 1);
  const [pick] = play.picks;
  assert.equal(pick.id, "ava.hidden-card");
  assert.deepEqual(pick.filter, { zone: "hand", owner: "controller", keyword: "hidden" });
  assert.equal(pick.selection, "one");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
});

test("golden: declining the optional payment skips the whole payment/play body", () => {
  const kernel = world()
    .unit("ava", { might: 4 })
    .hand("hidden-card", { types: ["unit"], keywords: [{ id: "hidden" }] })
    .build();
  kernel.setAnswers({ "ava.opt-in/optional": false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(result => result.id),
    ["ava.opt-in"]
  );
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  // 拒绝执行：没有任何支付，牌仍留在手里。
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("hidden-card").zone, "hand");
});

test("golden: choosing to proceed pays 1 Mind and plays the [Hidden] card with a zero-cost plan", () => {
  // The accepted branch runs both instructions in the program's own
  // choice.optional body; cost.pay must settle before effect.play.
  const kernel = world()
    .player("A", { power: ["Mind"] })
    .unit("ava", { might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .hand("hidden-card", {
      types: ["unit"],
      keywords: [{ id: "hidden" }],
      energy: 2,
      power: ["Fury"]
    })
    .build();
  kernel.setAnswers({ "ava.opt-in/optional": true });
  kernel.setPicks("ava.hidden-card", [kernel.ref("hidden-card")]);

  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ava") });
  const outcome = resolveChainBody(ability.body, context);

  assert.equal(outcome.status, "executed");
  const payResult = outcome.results.find(result => result.id === "ava.pay");
  const playResult = outcome.results.find(result => result.id === "ava.play-hidden");
  assert.equal(payResult.result.status, "executed");
  assert.equal(playResult.result.status, "executed");
  assert.deepEqual(payResult.result.linkedValues.payment.total.power, [
    { amount: 1, allowedDomains: ["Mind"] }
  ]);
  assert.equal(payResult.result.events[0].action, "pay");
  assert.equal(playResult.result.linkedValues.played, 1);
  assert.equal(context.getObject("hidden-card").zone, "board");
  assert.deepEqual(context.getObject("hidden-card").location, {
    type: "battlefield",
    id: "battlefield-1"
  });
  assert.deepEqual(outcome.events.map(event => event.action), ["pay", "play"]);
  assert.equal(context.getObject("hidden-card").energy, 2);
  assert.deepEqual(context.getObject("hidden-card").power, ["Fury"]);
});

test("Ava Achiever: accepting without Mind power cannot pay or play the selected card", () => {
  const kernel = world()
    .unit("ava", { might: 4 })
    .hand("hidden-card", { types: ["unit"], keywords: [{ id: "hidden" }], energy: 2, power: ["Fury"] })
    .build();
  kernel.setAnswers({ "ava.opt-in/optional": true });
  kernel.setPicks("ava.hidden-card", [kernel.ref("hidden-card")]);

  assert.throws(() => resolveChainBody(ability.body, kernel), {
    name: "CostPlanError",
    reason: "cannot-pay-cost"
  });
  assert.equal(kernel.getObject("hidden-card").zone, "hand");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "Ava Achiever: emit the real attack-declared event, choose a Hidden card from hand at resolution, and generate its finalized ignore-base plan while preserving additional costs/increases (CR 466.2/355.10.a/356.1.b.1/356.1.b.3)."
);
