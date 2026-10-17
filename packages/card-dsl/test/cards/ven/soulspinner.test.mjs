import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/soulspinner.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import ambush from "../../../../engine-core/dist/effects/keywords/Ambush.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-b3976fdbbb870e1d3f2e8cd4a8c353a35d653828284910792b79b5d6e6982f12";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("ven-123-166 Soulspinner: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-123-166 Soulspinner: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1\.b/);
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /continuous\.timing/);
  assert.match(program.judgeReason, /822\.3/);
  assert.ok(!/canAct 只读|只读 phase/.test(program.judgeReason));
  assert.ok(!/RIFT-258\/259|RIFT-257/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-123-166 Soulspinner: exactly one unvalued Ambush keyword declaration", () => {
  // 契约 3.1/3.7 与 README 第 5 节: Ambush（822.1）无数值, 只声明关键词身份;
  // 展开属于 effects/keywords/Ambush.ts, 卡文件不重写打出位置或 Reaction 许可。
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "ambush" });
  assert.equal(program.abilities[0].value, undefined);
});

test("ven-123-166 Soulspinner: the declared keyword id matches the registered Ambush KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Ambush");
  assert.ok(registered, "effects/keywords/Ambush.ts must be in the generated keyword registry");
  assert.equal(registered, ambush);
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  // 822.2: 多重实例冗余。
  assert.equal(registered.stacking, "single");
  assert.ok(registered.ruleRefs.includes("822.1.b"));
  assert.ok(registered.ruleRefs.includes("822.1.c"));
});

test("ven-123-166 Soulspinner: the Ambush expansion for this identity is the friendly-battlefield permission plus conditional Reaction", () => {
  const expansion = ambush.expand({ host: HOST });
  assert.equal(expansion.length, 2);
  const [locationPermission, timing] = expansion;
  // 822.1.b / 822.1.c: 可被打到「我有单位的战场」。
  assert.equal(locationPermission.kind, "static");
  assert.equal(locationPermission.effect.kind, "play-location-permission");
  assert.equal(locationPermission.effect.duration, "while-in-hand");
  assert.equal(locationPermission.effect.value.kind, "constant");
  const permitted = locationPermission.effect.value.value;
  assert.equal(permitted.zone, "battlefield");
  // 「a battlefield where you have units」= 被本方单位占据的战场（822.1.b）。
  assert.equal(permitted.battlefield.occupied, true);
  assert.equal(permitted.battlefield.controller, "controller");
  assert.equal(permitted.appliesTo, "self");
  // 822.1.b: 在被打到该战场的过程中具有 [Reaction]（条件许可, 不是全局 Reaction）。
  assert.equal(timing.kind, "static");
  assert.equal(timing.effect.kind, "continuous.timing");
  // Reaction 的 Closed State / Showdown 许可（813.1.c）, 且只在 Ambush 的战场范围内。
  assert.ok(timing.effect.grants.includes("closed-state"));
  assert.deepEqual(timing.effect.location, permitted);
  // 展开结果本身必须是合法 EffectIR（契约 3.7）。
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("ven-123-166 Soulspinner: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "ven-123-166 Soulspinner: play Soulspinner to a battlefield where its controller has units " +
    "(CR 822.1.b / 822.1.c, re-checked before Finalize per 822.3) — the play-location-permission consumer is missing; " +
    "only effects/keywords/Ambush.ts declares it and the Finalize location check does not read it"
);

test.todo(
  "ven-123-166 Soulspinner: Soulspinner has [Reaction] while being played to that battlefield (CR 822.1.b) — " +
    "chain.canAct now consumes continuous.timing grants from the layer registry (merged); the remaining " +
    "blocker is the occupied-battlefield condition of the play-location-permission, which no Finalize " +
    "consumer evaluates (CR 822.3)"
);
