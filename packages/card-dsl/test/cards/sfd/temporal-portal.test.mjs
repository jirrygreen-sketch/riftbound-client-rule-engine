// RIFT-662: execution evidence for the supported cost path lives in
// ../templates/activated-activated-continuous-grant-key-662.test.mjs; this
// file keeps the README §4.1 layer 1/2 checks and the gap evidence.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/temporal-portal.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { runInstruction } = await import(new URL("effects/testing/index.js", ENGINE));
const grantKeyword = (await import(new URL("effects/instructions/continuous.grant-keyword.js", ENGINE))).default;
const { buildCostPlan, payCostPlan } = await import(new URL("cost/index.js", ENGINE));

const CARD_ID = "card.hash-bb98faffa9506df8c98b1086bec2cbd71a7dd9f4c677d8e31dc335ebfa6e61d5";
const ALL_SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
const EXPECTED_SOURCE =
  ":rb_rune_rainbow:, :rb_exhaust:: Give the next spell you play this turn [Repeat] " +
  "equal to its cost. (You may pay the additional cost to repeat the spell's effect.)";

const [ability] = program.abilities;
const [grantRepeat] = ability.body;

function fixture() {
  const kernel = world()
    .player("A", { power: ["Fury"] })
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
  // The refreshed reason keeps the four measured gaps (rejected printed
  // shape, missing one-shot next-spell window, missing dynamic Repeat cost
  // consumer, and the test kernel not removing Power); the marker assertions
  // target those measured facts.
  assert.match(program.judgeReason, /amount/);
  assert.match(program.judgeReason, /one-shot next-spell|下一个法术/);
  assert.match(program.judgeReason, /820\.1\.c\.1/);
  assert.match(program.judgeReason, /player\.power/);
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
  // :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5.a / 163.2.b）；费用管线
  // 用六域 allowedDomains 表达该要求。
  assert.deepEqual(ability.cost.payments, [
    { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ALL_SIX_DOMAINS },
    { kind: "exhaust", object: "self" }
  ]);
});

test("sfd-078-221 Temporal Portal: the body grants Repeat to the next spell at a cost equal to its own", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grantRepeat.id, "temporal-portal.grant-repeat");
  // 820.1.c：授予对象与费用都是「那张未来法术」自身，不是固定数值；IR 只能用
  // 描述性标记表达，直到 one-shot 窗口与动态费用读取落地（见 judgeReason）。
  assert.equal(grantRepeat.op, "continuous.grant-keyword");
  assert.deepEqual(grantRepeat.args, {
    keyword: { kind: "constant", value: "Repeat" },
    amount: { kind: "constant", value: "equal-to-its-cost" },
    appliesTo: { kind: "constant", value: "next-spell-you-play" },
    duration: { kind: "constant", value: "end-of-turn" }
  });
  assert.equal(grantRepeat.targets, undefined);
  assert.equal(grantRepeat.linkedTo, undefined);
});

test("sfd-078-221 Temporal Portal: the real cost pipeline selects Universal Power and pays Exhaust", () => {
  // 135.2.e.5.a / 415.4 / 415.5：每个任意域 Power 都能支付 [A]，并同时横置来源。
  for (const domain of ALL_SIX_DOMAINS) {
    const built = world()
      .player("A", { power: [domain] })
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
    const kernel = built.clone({ sourceSnapshot: built.getObject("temporal-portal") });
    const plan = buildCostPlan(kernel, { id: "temporal-portal:activate", cost: ability.cost });
    assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ALL_SIX_DOMAINS }], domain);
    const receipt = payCostPlan(kernel, plan);
    assert.equal(receipt.paid, true, domain);
    assert.deepEqual(receipt.actions.map((action) => action.action.type), ["pay", "exhaust"], domain);
    assert.equal(kernel.getObject("temporal-portal").exhausted, true, domain);
  }
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

test("sfd-078-221 Temporal Portal: the merged grant-keyword primitive really grants a fixed keyword to the source", () => {
  // 说明缺口只在「未来法术 / 动态费用」这一形态，而不是授予本身：同一原语对
  // keyword + 非负整数 value 的调用真实注册 ability 图层效果。
  const kernel = world().unit("portal", { types: ["gear"], might: null }).build();
  const bound = kernel.clone({ source: kernel.ref("portal"), sourceSnapshot: kernel.getObject("portal") });
  const run = runInstruction(grantKeyword, {
    keyword: { kind: "constant", value: "Shield" },
    value: { kind: "constant", value: 2 },
    duration: { kind: "constant", value: "end-of-turn" }
  }, { world: bound });

  assert.equal(run.result.status, "executed");
  // One ability-layer grant is registered for the source (Shield 2 does not
  // exist on the Gear yet, so no arithmetic companion is emitted).
  assert.equal(bound.continuousEffects.length, 1);
  assert.deepEqual(bound.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(bound.continuousEffects[0].effect.layer, "ability");
  assert.equal(bound.continuousEffects[0].effect.effect.kind, "continuous.grant-keyword");
  assert.equal(bound.continuousEffects[0].effect.effect.keyword, "Shield");
  assert.equal(bound.continuousEffects[0].effect.effect.keywordValue, 2);
});

test("sfd-078-221 Temporal Portal: the resweep grant keeps the printed dynamic-cost marker", () => {
  // Resweep (2026-10): the merged primitive accepts selectors and
  // appliesTo:"self", but neither the one-shot next-spell window nor the
  // equal-to-its-cost remains a descriptive IR marker while the engine rejects
  // it at the primitive boundary because no dynamic-cost consumer exists.
  const rejected = grantKeyword.argsSchema.safeParse({
    keyword: { kind: "constant", value: "Repeat" },
    amount: { kind: "constant", value: "equal-to-its-cost" },
    appliesTo: { kind: "constant", value: "next-spell-you-play" },
    duration: { kind: "constant", value: "end-of-turn" }
  });
  assert.equal(rejected.success, false, "the grant contract has no amount argument");
  assert.match(String(rejected.error), /Invalid continuous.grant-keyword argument: amount/);
  assert.deepEqual(Object.keys(grantRepeat.args).sort(), ["amount", "appliesTo", "duration", "keyword"]);
});

test.todo(
  "sfd-078-221 Temporal Portal: granting Repeat to the next spell needs a one-shot next-spell window and a binding " +
    "from that pending spell to the granted instance"
);

test.todo(
  "sfd-078-221 Temporal Portal: equal-to-its-cost needs the future spell's printed cost at Finalize to build the optional " +
    "Repeat payment"
);
