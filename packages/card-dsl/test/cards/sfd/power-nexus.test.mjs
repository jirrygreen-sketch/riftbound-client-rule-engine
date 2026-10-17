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
  // Both current dependencies: the battlefield-relative anchor / unknown filter
  // field and the still-unmerged cost.pay instruction (see judgeReason).
  assert.match(program.judgeReason, /hold producer is merged|hold/);
  assert.match(program.judgeReason, /here:true/);
  assert.match(program.judgeReason, /battlefield-relative/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-261/);
});

test("sfd-214-221: hold trigger whose printed may is one choice.optional body (3.9)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  // 053.3 "here" + 190.6.d "you"; sibling battlefield programs keep this
  // placeholder spelling while the hold pipeline is unmerged.
  assert.deepEqual(ability.trigger.filter, {
    event: "hold",
    here: true,
    player: "controller"
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
  assert.deepEqual(pay.args.payments, {
    kind: "constant",
    value: [
      {
        // 135.2.e.5: :rb_rune_rainbow: is Power of any Domain; 135.2.e.5.a:
        // as a cost it may be paid by Power of any Domain, i.e. all six.
        kind: "power",
        amount: { kind: "constant", value: 4 },
        allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
      }
    ]
  });

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
  // The accepted branch is still gated on the unmerged cost.pay opcode
  // (judgeReason), but the declared payment shape itself is already understood:
  // the reader accepts four Power with all six Domains allowed, which is how
  // :rb_rune_rainbow: is spelled as a cost (135.2.e.5 / 135.2.e.5.a).
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
  "sfd-214-221: hold 由 scoring/ 发出并进链，Battlefield 能力按控制者注册触发（RIFT-31/RIFT-33）"
);
test.todo(
  "sfd-214-221: 合入 cost.pay 原语后，四个 [A] 符文（135.2.e.5/135.2.e.5.a）的支付与 1 点获得在同一可选分支内真实执行（RIFT-89）"
);
