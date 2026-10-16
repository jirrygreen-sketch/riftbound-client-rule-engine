import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-order-disciple.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import mill from "../../../../engine-core/dist/effects/instructions/effect.mill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-52a663e5dda4322708485527cce1866c32eed631d3d1ad01e401569b5f72e267";
const SOURCE_TEXT =
  "When I move, you may [Burn 1] to give me +1 :rb_might: this turn. (To Burn 1, put the top card " +
  "of your Main Deck into your trash.)";

const [ability] = program.abilities;
const [optional] = ability.body;
const [payBurn, mightModify] = optional.args.body.value;
const OPTIONAL_ID = "shadow-order-disciple.may-burn-and-grant/optional";

const discipleWorld = () => {
  const base = world()
    .player("A")
    .deck(["burn-top", "next-card"])
    .unit("disciple", {
      might: 2,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  return base.clone({
    controller: "A",
    sourceSnapshot: base.getObject("disciple")
  });
};

test("ven-095-166 Shadow Order Disciple: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-095-166 Shadow Order Disciple: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /burn/);
  assert.match(program.judgeReason, /might-modify|Might 修正|Might/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-095-166: 'When I move' subscribes to the object-moved movement timing point (421.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 403.1 / 契约 3.9：“you may [Burn 1] to …” 的首段是触发能力自身的可选执行。
  assert.equal(ability.optional, true);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
});

test("ven-095-166: the Burn 1 is a Finalize cost and the Might rider a temporary modification", () => {
  assert.deepEqual(optional.args.body.value.map((instruction) => [instruction.id, instruction.op]), [
    ["shadow-order-disciple.pay-burn-1", "cost.pay"],
    ["shadow-order-disciple.give-plus-1-might", "effect.might-modify"]
  ]);
  // 740.4.a.2 / 441.1：效果首段的 [Burn 1] 是在 Finalization 支付的费用；
  // cost/plan-values.ts 的非标准费用种类没有 burn（RIFT-89），形状如实记录。
  assert.deepEqual(payBurn.args.payments, {
    kind: "constant",
    value: [{ kind: "burn", amount: 1 }]
  });
  assert.equal(payBurn.targets, undefined);

  // 479.4.e.1 的临时 Might 修正（“this turn” 到期）；op 未注册（见 judgeReason 第 2 条）。
  assert.equal(mightModify.linkedTo, "shadow-order-disciple.pay-burn-1");
  assert.deepEqual(mightModify.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightModify.args.duration, { kind: "constant", value: "this-turn" });
  // “me” 是能力宿主：契约 3.6 的符号选择器，不是 TargetSpec（355.10.d/g）。
  assert.deepEqual(mightModify.args.object, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(mightModify.targets, undefined);
});

test("ven-095-166 golden: the Burn 1 action semantics move the top Main Deck card to the trash (441.1)", () => {
  // The declared Burn is a cost (unmergeable kind), but the printed reminder is
  // the fixed functional text of the Burn action (441.2); effect.mill is the
  // merged primitive for exactly that action, so the golden executes it on the
  // card's own controller and asserts the real zone change.
  const kernel = discipleWorld();
  const run = runInstruction(mill, { amount: 1 }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map((object) => object.id), ["burn-top"]);
  assert.deepEqual(kernel.zone("A", "deck").map((object) => object.id), ["next-card"]);
  assert.deepEqual(run.linked.burned, [{ id: "burn-top", zoneEntryId: 1 }]);
  assert.equal(run.linked.burnedCount, 1);
});

test("ven-095-166 golden: declining the may-body burns nothing and grants nothing", () => {
  const kernel = discipleWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["shadow-order-disciple.may-burn-and-grant", "negated", "skipped"]]
  );
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.equal(kernel.zone("A", "deck").length, 2);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "ven-095-166 Shadow Order Disciple: pay the printed [Burn 1] inside the may-body at Finalize (740.4.a.2, 441.1) — " +
    "cost/plan-values.ts supports no burn payment kind and cost.pay has no merged instruction file (RIFT-89)"
);

test.todo(
  "ven-095-166 Shadow Order Disciple: 'give me +1 :rb_might: this turn' needs a registered temporary Might modification " +
    "(479.4.e.1 with the 315.4 / 317.2.c end-of-turn expiry) — no continuous.might instruction exists (RIFT-91)"
);

test.todo(
  "ven-095-166 Shadow Order Disciple: the object-moved trigger runs end to end — needs a CardProgram → " +
    "TriggerRegistration subscriber so card triggers enter the chain (RIFT-120 chain/events pipeline)"
);
