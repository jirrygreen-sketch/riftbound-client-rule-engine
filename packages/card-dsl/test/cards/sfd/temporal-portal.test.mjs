import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/temporal-portal.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { buildCostPlan, payCostPlan } = await import(new URL("cost/index.js", ENGINE));

const CARD_ID = "card.hash-bb98faffa9506df8c98b1086bec2cbd71a7dd9f4c677d8e31dc335ebfa6e61d5";
const EXPECTED_SOURCE =
  ":rb_rune_rainbow:, :rb_exhaust:: Give the next spell you play this turn [Repeat] " +
  "equal to its cost. (You may pay the additional cost to repeat the spell's effect.)";

const [ability] = program.abilities;
const [grantRepeat] = ability.body;

function fixture() {
  const kernel = world()
    .object("temporal-portal", {
      name: "Temporal Portal",
      cardId: CARD_ID,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null
    })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("temporal-portal") });
}

test("sfd-078-221 Temporal Portal: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Repeat/);
  assert.match(program.judgeReason, /next-spell|一次性/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /equal to its cost|印刷费用/);
});

test("sfd-078-221 Temporal Portal: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-078-221 Temporal Portal: one action-speed activated ability with the printed rainbow + exhaust cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 151.2：Gear 启动式能力在控制者 Main Phase 执行。
  assert.equal(ability.timing, "action");
  // 415.4/415.5：印刷的 :rb_exhaust: 是「横置自身」费用。
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust", object: "self" }]);
  // :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5.a / 163.2.b）；六域封闭集合无法表达，
  // 以描述性 ["rainbow"] 记录，不是某个具体域。
  assert.deepEqual(ability.cost.power, { kind: "constant", value: ["rainbow"] });
  assert.equal(ability.cost.power.value.includes("Mind"), false);
});

test("sfd-078-221 Temporal Portal: the body grants Repeat to the next spell at a cost equal to its own", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grantRepeat.id, "temporal-portal.grant-repeat");
  // 820.1.b/820.1.c：给下一个法术授予一个 Repeat 实例，费用来自该法术自己的印刷文本。
  assert.equal(grantRepeat.op, "continuous.grant-keyword");
  assert.deepEqual(grantRepeat.args.keyword, { kind: "constant", value: "Repeat" });
  assert.deepEqual(grantRepeat.args.amount, { kind: "constant", value: "equal-to-its-cost" });
  assert.deepEqual(grantRepeat.args.appliesTo, { kind: "constant", value: "next-spell-you-play" });
  assert.deepEqual(grantRepeat.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grantRepeat.targets, undefined);
  assert.equal(grantRepeat.linkedTo, undefined);
});

test("sfd-078-221 Temporal Portal: the exhaust half of the printed cost is really payable", () => {
  // 415.4/415.5：印刷的横置费用由已合入的费用管线真实收缴（本卡印刷费用的可执行半段）。
  // 费用计划使用卡牌自己声明的 payments 条目；[A] 的 Power 部分无法进入六域封闭的费用计划。
  const kernel = fixture();
  const plan = buildCostPlan(kernel, {
    id: "temporal-portal:activate",
    cost: { kind: "activated", payments: ability.cost.payments }
  });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map((action) => action.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.getObject("temporal-portal").exhausted, true);
});

test("sfd-078-221 Temporal Portal: the merged Repeat definition only carries a self-hosted instance", () => {
  // 820.1.c.2：Repeat 的定义与展开是按来源自带的实例写的；「授予未来法术」不属于它。
  const definition = keywordDefinitionsById.get("Repeat");
  assert.ok(definition, "effects/keywords/Repeat.ts must be registered");
  assert.equal(definition.stacking, "separate");
  assert.deepEqual(definition.expand({ host: { canonicalCardId: CARD_ID } }).map((expansion) => expansion.kind), [
    "static"
  ]);
});

test.todo(
  "sfd-078-221 Temporal Portal: granting a Repeat instance to the NEXT spell played this turn (CR 820.1.b/820.1.c) needs " +
    "a merged keyword-grant primitive plus the one-shot \"next spell\" duration (RIFT-89 cost plan, RIFT-91 layers); " +
    "the declared continuous.grant-keyword instruction has no registered consumer and Duration has no next-spell lifetime"
);
test.todo(
  "sfd-078-221 Temporal Portal: \"equal to its cost\" needs the future spell's own printed cost read at Finalize (CR 206) " +
    "to build the optional additional-cost component (RIFT-89); no expression can read a not-yet-played object's printed cost"
);
test.todo(
  "sfd-078-221 Temporal Portal: the printed :rb_rune_rainbow: cost is Universal Power [A] (CR 135.2.e.5.a / 163.2.b); the " +
    "closed six-domain Domain set cannot carry it, so only a descriptive [\"rainbow\"] marker is recorded"
);
