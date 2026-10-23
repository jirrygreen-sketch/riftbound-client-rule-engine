import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/power-nexus.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import score from "../../../../engine-core/dist/effects/instructions/effect.score.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL =
  "card.hash-37ce210574e7c91a9622befdf13147021c67804d234496c259e656e10217be0e";
const SOURCE_TEXT =
  "When you hold here, you may pay " +
  ":rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow: to score 1 point.";

const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, gainPoint] = choice.args.body.value;

test("sfd-214-221 Power Nexus: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("sfd-214-221 Power Nexus: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Build-time codegen over src/cards/**; the golden proves the identity is
  // actually registered (one identity, one file).
  assert.equal(cardProgramsById.get(CANONICAL), program);
  // The current dependency is the battlefield-relative anchor / unknown filter
  // field; cost.pay is merged and executed by the golden below (see judgeReason).
  assert.match(program.judgeReason, /hold producer and its closed discriminant are merged/);
  assert.match(program.judgeReason, /Unsupported filter field here/);
  assert.match(program.judgeReason, /battlefield-relative/);
  assert.match(program.judgeReason, /383\.4\.d\.2\.a/);
  assert.match(program.judgeReason, /cost\.pay/);
});

test("sfd-214-221: hold trigger whose printed may is one choice.optional body (3.9)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  // 053.3 "here" + 190.6.d "you"; sibling battlefield programs keep this
  // placeholder spelling while the hold pipeline is unmerged.
  assert.deepEqual(ability.trigger.filter, {
    event: "held",
    here: true,
    // "you" is the ability controller (190.6.d); PlayerSelector "self" is the
    // frozen vocabulary for "the trigger's controller performed the action".
    player: "self"
  });
  assert.equal(ability.optional, true);

  // Contract 3.9: the printed may is ONE choice.optional with the chosen
  // instructions inside its body; there is no leading choice plus linkedTo
  // consumer.
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["power-nexus.opt-in"]);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, {
    kind: "constant",
    value: "Pay four runes to score 1 point?"
  });
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "power-nexus.pay-four-runes",
    "power-nexus.score-1"
  ]);
});

test("sfd-214-221: four [A] Power are declared as a cost plan the reader already understands", () => {
  // 383.3.b / 355.10.c.1: "pay … to score" is a cost within the instruction.
  assert.equal(pay.id, "power-nexus.pay-four-runes");
  assert.equal(pay.op, "cost.pay");
  assert.equal(pay.linkedTo, undefined);
  // 135.2.e.5: :rb_rune_rainbow: is Power of any Domain; 135.2.e.5.a: as a cost
  // it may be paid by Power of any Domain, so cost.pay's object payments shape
  // records the numeric requirement 4 and no domain restriction.
  assert.deepEqual(pay.args.payments, { kind: "constant", value: { energy: 0, power: 4 } });

  // 470.1/470.2: "score 1 point" is Gaining a Point through an effect, for the
  // ability controller; the printed "pay … to …" makes it depend on the
  // payment.
  assert.equal(gainPoint.id, "power-nexus.score-1");
  assert.equal(gainPoint.op, "effect.score");
  assert.equal(gainPoint.linkedTo, "power-nexus.pay-four-runes");
  assert.deepEqual(gainPoint.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(gainPoint.targets, undefined);
  assert.equal(gainPoint.picks, undefined);
});

test("sfd-214-221: declining the optional chooses neither payment nor point gain", () => {
  const kernel = world().player("A", { score: 2 }).player("B", { score: 4 }).build();
  kernel.setAnswers({ "power-nexus.opt-in/optional": false });

  const outcome = runAbilityBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map(result => result.id), ["power-nexus.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.player("A").score, 2);
  assert.equal(kernel.player("B").score, 4);
});

test("sfd-214-221: the declared four-[A] payment is readable by the merged cost plan reader", () => {
  // The cost plan reader still models the object payments as four Power with
  // every Domain allowed (135.2.e.5 / 135.2.e.5.a); the golden below executes
  // the same accepted branch through the merged cost.pay instruction.
  const kernel = world()
    .player("A", { power: ["Calm", "Calm", "Calm", "Calm"] })
    .player("B")
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.objects[0] });
  const spec = {
    kind: "explicit",
    payments: [
      {
        kind: "power",
        amount: { kind: "constant", value: 4 },
        allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
      }
    ]
  };
  const plan = buildCostPlan(context, { id: "cost:power-nexus", cost: spec, domains: ["Calm"] });
  assert.deepEqual(plan.total.power, [
    { amount: 4, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
  assert.equal(plan.total.energy, 0);
});

test("sfd-214-221: the merged Score half really gains the printed 1 point (470.1/470.2)", () => {
  const kernel = world().player("A", { score: 1 }).player("B", { score: 3 }).build();

  const run = runInstruction(score, { amount: gainPoint.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["score"]);
  assert.equal(kernel.player("A").score, 2);
  assert.equal(kernel.player("B").score, 3);
  assert.deepEqual(run.linked.scored, [{ player: "A", amount: 1 }]);
});

test("sfd-214-221 golden: accepting the optional pays four [A] Power and scores 1 point", () => {
  // The accepted branch runs the program's own choice.optional body with the
  // merged cost.pay instruction. The accepted branch must deduct all four
  // matching Power before awarding the printed point.
  const kernel = world().player("A", { score: 2, power: ["Calm", "Calm", "Calm", "Calm"] }).player("B", { score: 4 }).build();
  kernel.setAnswers({ "power-nexus.opt-in/optional": true });

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  // The interpreter reports the choice's child results first and the opt-in
  // wrapper last; all three instructions executed.
  assert.deepEqual(
    [...outcome.results.map((entry) => entry.id)].sort(),
    ["power-nexus.opt-in", "power-nexus.pay-four-runes", "power-nexus.score-1"]
  );
  for (const entry of outcome.results) assert.equal(entry.result.status, "executed");
  // The receipt records the locked four-[A] plan and the payment action.
  const payment = outcome.results.find((entry) => entry.id === "power-nexus.pay-four-runes").result.linkedValues.payment;
  assert.deepEqual(payment.total.power, [
    { amount: 4, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
  assert.deepEqual(payment.actions.map((entry) => entry.action.type), ["pay"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["pay", "score"]);
  assert.equal(kernel.player("A").power.length, 0);
  // The printed "pay … to score" dependency: the point gain is linked to the
  // payment and both happen in the same optional branch (contract 3.9).
  assert.deepEqual(outcome.results.find((entry) => entry.id === "power-nexus.score-1").result.linkedValues.scored, [
    { player: "A", amount: 1 }
  ]);
  assert.equal(kernel.player("A").score, 3);
  assert.equal(kernel.player("B").score, 4);
});

test.todo(
  "sfd-214-221: the accepted branch must deduct four [A] Power and reject a second payment " +
    "after resources are spent; the reference test kernel currently ignores Power in its pay action, " +
    "so receipt/event evidence above is intentionally limited"
);

test("sfd-214-221 golden: the accepted branch fails closed when the player cannot pay four [A]", () => {
  // CR 203.3: an unpayable cost must throw, not silently skip the payment or
  // award the point; cost.pay raises CostPlanError from the payment plan.
  const kernel = world().player("A", { score: 2, power: ["Calm"] }).player("B").build();
  kernel.setAnswers({ "power-nexus.opt-in/optional": true });

  assert.throws(() => runAbilityBody(ability.body, kernel), (error) => error.name === "CostPlanError" && /insufficient matching Power/.test(error.message));
  // The transaction boundary belongs to the caller; the failed attempt must not
  // award the printed point in this direct execution.
  assert.equal(kernel.player("A").score, 2);
  assert.equal(kernel.player("B").score, 0);
});

test("sfd-214-221: scoring is Gaining a Point, not Scoring the Battlefield (470.1/470.3)", () => {
  const kernel = world().player("A", { score: 0 }).build();
  const before = kernel.objectsInZone("A", "board");

  const run = runInstruction(score, { amount: gainPoint.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  // The instruction carries no battlefield/control side effect: only the point
  // total changed.
  assert.deepEqual(kernel.objectsInZone("A", "board"), before);
});

test("sfd-214-221: the resolved Hold trigger spelling is a valid, matcher-understood spec", () => {
  // The stored filter carries the 053.3 `here` placeholder (asserted by the
  // structure test and named in judgeReason); this pins the spelling a future
  // battlefield anchor must resolve to: the pipeline matcher maps the `held`
  // event name onto the `hold` timing point (events/pipeline-match.ts
  // EVENT_NAMES) and reads the controller through the `self` selector.
  assert.doesNotThrow(() =>
    assertTriggerSpec({ at: "hold", filter: { event: "held", player: "self" } })
  );
  // The timing point the ability subscribes to is a declared one.
  assert.equal(getTimingPoint(ability.trigger.at).id, "hold");
});

test.todo(
  "sfd-214-221: hold 由 scoring/ 发出并进链，Battlefield 能力按控制者注册触发；here:true 被触发规格校验拒绝且 EventPattern/ObjectFilter 没有 battlefield 锚"
);
test.todo(
  "sfd-214-221: hold 触发在链上真正匹配本 Battlefield 后，可选分支的金色执行升级为端到端生产链路（cost.pay 已执行支付与得分）"
);

test("sfd-214-221: the printed here placeholder validates and translates", () => {
  assert.doesNotThrow(() =>
    assertTriggerSpec({ at: "hold", filter: { ...ability.trigger.filter, event: "held" } })
  );
  assert.deepEqual(translateTriggerFilter(ability.trigger.filter, "power-nexus", "hold"), {
    event: "held", here: true, player: "self"
  });

  const translated = translateTriggerFilter({ event: "held", player: "controller" }, "power-nexus", "hold");
  assert.deepEqual(translated, { event: "held", player: "self" });
  assert.doesNotThrow(() => assertTriggerSpec({ at: "hold", filter: translated }));
  const emission = { timingPoint: "hold", kind: "hold", player: "A", details: { battlefieldId: "bf-1" } };
  assert.equal(matchesTriggerEvent(translated, emission, "A"), true);
  // It is exactly the battlefield identity that is missing: any Battlefield's
  // Hold would match this broader filter, so the printed restriction must stay
  // in the published program instead of being narrowed here.
  assert.equal(matchesTriggerEvent(translated, { ...emission, details: { battlefieldId: "bf-2" } }, "A"), true);
});
