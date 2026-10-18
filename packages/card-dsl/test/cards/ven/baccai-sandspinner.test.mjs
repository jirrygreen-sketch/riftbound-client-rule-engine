// Golden test for Baccai Sandspinner (ven-001-166).
//
// Execution evidence for the supported slice (the real printed cost plan, the
// Empowered-gated Deflect 1 / Assault 2 grant with the Disempower boundary) lives
// in the RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// The assertions below additionally pin the 2026-10-18 measured gates: the printed
// Empower cost has no carrier, the cost-modification bind fails closed, the relative
// controller selector never matches on the production matcher and granted keywords
// are not re-expanded.
import assert from "node:assert/strict";
import test from "node:test";

import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/baccai-sandspinner.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID =
  "card.hash-43ef38def4a837781a4013a179db99f1eb1e312f85de8d9c3053f7168a1652f5";
const SOURCE_TEXT =
  "[Empower] :rb_energy_5:. This ability costs :rb_energy_3: less if you control 4 or fewer runes. " +
  "(Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Deflect] and [Assault 2]. (Opponents must pay :rb_rune_rainbow: to choose me " +
  "with a spell or ability. +2 :rb_might: while I'm an attacker.)";

const [empower, costReduction, grantedKeywords] = program.abilities;

/**
 * 参考内核的 filter 比较是字面值比较，而 IR 里的 "self" / "opponent" 是契约 3.6 的符号
 * 选择符；执行用例把这一处符号绑定到真实玩家 id（与 ven/protective-sands 的既有约定一致），
 * 卡程序本身保持符号写法。下方 measured-gate 用例单独证明生产匹配器不做这层归一化。
 */
function substitutePlayers(value, playerId, opponentId) {
  if (Array.isArray(value)) return value.map(item => substitutePlayers(item, playerId, opponentId));
  if (value === null || typeof value !== "object") {
    if (value === "self") return playerId;
    if (value === "opponent") return opponentId;
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substitutePlayers(item, playerId, opponentId)])
  );
}

/** 133.5.a.1 / 431.1：被 channel 的符文留在控制者的符文区。 */
function runeZoneWorld(player, runesTotal, channeled) {
  const kernel = world()
    .rune(Array.from({ length: runesTotal }, (_, index) => `${player}-rune-${index + 1}`), { owner: player })
    .build();
  if (channeled > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player, amount: channeled }).status, "done");
  }
  return kernel;
}

function evaluateCondition(condition, kernel) {
  const body = [
    {
      id: "gate",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: condition } }
    }
  ];
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  return outcome.results[0].result.linkedValues.value;
}

test("ven-001-166 Baccai Sandspinner: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-001-166 Baccai Sandspinner: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // judgeReason 必须点名真正的缺口，而不是泛泛的「未实现」。
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /Unsupported cost kind: empower/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /Chain Finalize/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /selectorMatches/);
  assert.ok(!/RIFT-89|RIFT-90|RIFT-91/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-001-166: Empower 5 is declared with the printed cost and not expanded", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 5 });
  assert.equal(empower.params, undefined);
});

test("ven-001-166: the 'costs 3 less' clause rewrites that Empower activation only under 4-or-fewer runes", () => {
  // 827.1.c.3 / 206.1：该文本改写的是这条 Empower 起动费用，不是独立效果。
  assert.equal(costReduction.kind, "static");
  assert.equal(costReduction.effect.kind, "continuous.cost-modification");
  assert.equal(costReduction.effect.resource, "energy");
  assert.equal(costReduction.effect.appliesTo, "empower-activation-cost");
  assert.deepEqual(costReduction.effect.amount, { kind: "constant", value: -3 });
  // 356.6：Energy 费用不能被减到 0 以下。
  assert.equal(costReduction.effect.minimum, 0);
  assert.deepEqual(costReduction.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "runes",
      filter: { type: "rune", controller: "self", zone: "rune-zone" }
    },
    operator: "lte",
    right: { kind: "constant", value: 4 }
  });
});

test("ven-001-166: the Empowered dependent ability grants Deflect 1 and Assault 2 to self", () => {
  // 828.1.b.1：等价于「持有 Empowered 时本牌获得 '[Text]'」。
  assert.equal(grantedKeywords.kind, "static");
  assert.deepEqual(grantedKeywords.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [
      { id: "deflect", value: 1 },
      { id: "assault", value: 2 }
    ]
  });
  // 809.1.b.3 的省略值按 1、807.1.b 的印刷值 2 各自保留；卡内不重写展开。
  assert.deepEqual(grantedKeywords.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ven-001-166 review evidence: the grant primitive is merged", () => {
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
});

test("ven-001-166 golden: the [Empowered] grant shape really registers Deflect 1 and Assault 2 through layers", () => {
  const kernel = world()
    .unit("baccai-sandspinner", { types: ["unit"], zone: "board", owner: "A", controller: "A", might: 6 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("baccai-sandspinner") });
  const body = [{
    id: "baccai-sandspinner.grant-keywords",
    op: "continuous.grant-keyword",
    args: {
      keywords: { kind: "constant", value: grantedKeywords.effect.keywords },
      appliesTo: { kind: "constant", value: "self" }
    }
  }];
  const outcome = runAbilityBody(body, context);

  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  const registrations = context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  }));
  const layers = createLayerEngine(context.objects, registrations);
  const evaluated = layers.evaluate(context.ref("baccai-sandspinner"));
  assert.deepEqual(
    evaluated.keywords.map(keyword => [keyword.id, keyword.value]),
    [["deflect", 1], ["assault", 2]]
  );
  // 807.1.c：Assault 2 只在「我是攻击者时 +2 [M]」；未指定 combatRole 时不该加 Might。
  assert.equal(evaluated.might, 6);
});

test("ven-001-166 golden: the '4 or fewer runes' condition really evaluates on the rune zone (133.5.a.1)", () => {
  const condition = substitutePlayers(costReduction.condition, "A", "B");

  const four = runeZoneWorld("A", 4, 4);
  assert.equal(evaluateCondition(condition, four), true);
  assert.equal(four.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 4);

  const five = runeZoneWorld("A", 5, 5);
  assert.equal(evaluateCondition(condition, five), false);
  assert.equal(five.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 5);

  // 符文仍在符文牌库时不算「控制」：431.1 的 channel 才是进入符文区的动作。
  const unchanneled = runeZoneWorld("A", 4, 0);
  assert.equal(evaluateCondition(condition, unchanneled), true);
  assert.equal(unchanneled.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 0);
});

test("baccai-sandspinner: the merged Empower definition expands through the real program adapter", () => {
  const kernel = world().unit("keyword-host", {
    cardId: program.canonicalCardId, energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("keyword-host"));
  assert.equal(expanded.length, 1);
  const [activation] = expanded;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  // The missing printed-cost bridge must never turn this into a free activation.
  assert.deepEqual(activation.cost, { kind: "empower" });
  assert.deepEqual(activation.restriction, { kind: "empower", condition: {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  } });
  assert.equal(activation.body[0].id, `empower:${program.canonicalCardId}`);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.deepEqual(activation.body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.equal(program.status, "judge-required");
});

test("baccai-sandspinner: the source gate evaluates the actual empowered state", () => {
  const kernel = world().unit("gate-host", { energy: null, power: null }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("gate-host") });
  const body = [{ id: "gate", op: "condition.predicate", args: {
    condition: { kind: "constant", value: grantedKeywords.condition }
  } }];
  const evaluate = () => {
    const outcome = runAbilityBody(body, context);
    assert.equal(outcome.status, "executed");
    return outcome.results[0].result.linkedValues.value;
  };
  assert.equal(evaluate(), false);
  assert.equal(context.perform({ type: "empower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), true);
  assert.equal(context.perform({ type: "disempower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), false);
  assert.deepEqual(context.events.map(event => event.action), ["empower", "disempower"]);
});

test("baccai-sandspinner evidence: the printed Empower 5 cannot be paid through the production cost plan", () => {
  // 827.1.c.1：expandProgram has no params.cost carrier, so the activated
  // ability ships { kind: "empower" }, which the real planner rejects.
  const kernel = world().player("A", { energy: 9 })
    .unit("spinner", { controller: "A", energy: null, power: null }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("spinner") });
  assert.throws(
    () => buildCostPlan(context, { id: "empower-cost", cost: { kind: "empower" } }),
    (error) => error instanceof Error && /Unsupported cost kind: empower/.test(error.message)
  );
  // The energy the card prints is 5, and the card declares exactly that (827.1.c.1).
  assert.equal(empower.value, 5);
});

test("baccai-sandspinner evidence: the conditional -3 Energy rewrite fails closed at bind time", () => {
  // 827.1.c.3 / 206.1: the clause rewrites the Empower activation cost, but the
  // production static binder refuses both the appliesTo target and the layer.
  const { engine, kernel } = fixture({
    cards: [{ id: "spinner", cardId: CARD_ID, types: ["unit"], might: 6, energy: null, power: null }]
  });
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(costReduction, kernel.getObject("spinner")),
    (error) => error instanceof Error
      && /Unsupported static appliesTo/.test(error.message)
      && /empower-activation-cost/.test(error.message)
  );
});

test("baccai-sandspinner evidence: no layer selector can express runes you control", () => {
  // 133.5.a.1 / 431.1: the condition counts runes in its controller's Rune Zone.
  // layers/filter.ts resolves controller selectors against the object's own
  // controller, so "self" degenerates to "any controller" (an opponent's rune
  // matches too) while a concrete player id is only meaningful for one seat; the
  // authored relative spelling therefore cannot be evaluated by the layer path.
  const runeOf = (controller, owner) => ({
    ref: { id: `rune-${controller}`, zoneEntryId: 1 }, cardId: null, name: "rune", types: ["rune"],
    tags: [], keywords: [], owner, controller, zone: "rune-zone", location: null, combatRole: null,
    might: null, energy: null, power: null, exhausted: false, damage: 0, stunned: false, buffs: 0,
    attachedTo: null, faceDown: false, isToken: false
  });
  // "self" is not anchored to the ability controller: the opponent's rune matches too.
  assert.equal(matchesObjectFilter({ type: "rune", controller: "self", zone: "rune-zone" }, runeOf("A", "A")), true);
  assert.equal(matchesObjectFilter({ type: "rune", controller: "self", zone: "rune-zone" }, runeOf("B", "B")), true);
  // Only a concrete player id restricts the set, and it cannot follow the controller.
  assert.equal(matchesObjectFilter({ type: "rune", controller: "A", zone: "rune-zone" }, runeOf("A", "A")), true);
  assert.equal(matchesObjectFilter({ type: "rune", controller: "A", zone: "rune-zone" }, runeOf("B", "B")), false);
});

test("baccai-sandspinner evidence: the granted Assault 2 does not add Might on the real layer engine", () => {
  // 807.1.c: "while I am an attacker, I have +2 [M]". A granted keyword entry
  // reaches the layer snapshot, but the Assault expansion condition reads
  // "designation", which the default interpreter cannot evaluate, so Might stays put.
  const { engine, kernel } = fixture({
    cards: [{ id: "spinner", cardId: CARD_ID, types: ["unit"], might: 6, energy: null, power: null, combatRole: "attacker" }]
  });
  engine.commit({ type: "move-zone", object: kernel.ref("spinner"), to: "base" });
  const binder = createEngineStaticBinder(engine);
  binder.bindStatic(grantedKeywords, kernel.getObject("spinner"));
  engine.commit({ type: "empower", object: kernel.ref("spinner") });
  const snapshot = engine.layers.snapshot(kernel.ref("spinner"));
  assert.deepEqual(snapshot.keywords.map(keyword => [keyword.id, keyword.value]), [
    ["deflect", 1],
    ["assault", 2]
  ]);
  assert.equal(snapshot.might, 6);
});

test("baccai-sandspinner evidence: the Deflect expansion has no production layer and no Power tax", () => {
  // 809.1.c: opponents must pay one unrestricted Power. Deflect expands to
  // target.tax, which the static binder rejects ("no layer mapping"); the chain
  // Finalize target tax still charges Energy (chain/engine.ts).
  const { engine, kernel } = fixture({
    cards: [{ id: "target", cardId: CARD_ID, types: ["unit"], might: 6, energy: null, power: null }]
  });
  engine.commit({ type: "move-zone", object: kernel.ref("target"), to: "base" });
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic({ kind: "static", effect: { kind: "target.tax", value: { kind: "constant", value: 1 } } }, kernel.getObject("target")),
    (error) => error instanceof Error && /no layer mapping/.test(error.message)
  );
});

test.todo(
  "ven-001-166 Baccai Sandspinner: carry the printed Empower 5 cost and its conditional -3 Energy " +
    "discount into activation Finalize (827.1.c.1/c.3) - KeywordAbility has no params.cost and the " +
    "static binder rejects appliesTo \"empower-activation-cost\""
);
test.todo(
  "ven-001-166 Baccai Sandspinner: re-expand the granted Assault 2 into the attacker Might bonus and " +
    "route layered Deflect into a Power target tax in Chain Finalize (807.1.c / 809.1.c / 828.1.c)"
);

