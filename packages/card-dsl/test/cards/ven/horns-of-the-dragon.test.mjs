import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/horns-of-the-dragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import combat from "../../../../engine-core/dist/effects/instructions/continuous.combat.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-9e6cf771d3c68dc759e26aa3068eb3f3f2873734ee60fe6d8df8ef5a2ac46dbe";
const SOURCE_TEXT = "[Tank] (I must be assigned combat damage first.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("ven-118-166 Horns of the Dragon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-118-166 Horns of the Dragon: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README 第 2 节: judgeReason 必须写清缺少哪个语义与依赖任务。
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815\.1\.b/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  assert.match(program.judgeReason, /RIFT-264/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-118-166 Horns of the Dragon: exactly one unvalued Tank keyword declaration", () => {
  // 契约 3.1/3.7 与 README 第 5 节: 关键词只声明身份与印刷数值; Tank（815）
  // 不带数值, 展开属于 effects/keywords/Tank.ts, 卡文件不重写分配顺序。
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "tank" });
  assert.equal(program.abilities[0].value, undefined);
});

test("ven-118-166 Horns of the Dragon: the declared keyword id matches the registered Tank KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Tank");
  assert.ok(registered, "effects/keywords/Tank.ts must be in the generated keyword registry");
  assert.equal(registered, tank);
  // 卡牌 IR 用小写 keyword id, 注册表按印刷名索引（README 第 5 节）。
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  // 815.2: 多重实例冗余 -> single stacking; 815.3: 是否拥有 Tank 是可引用特征。
  assert.equal(registered.stacking, "single");
  assert.equal(registered.valued, false);
  assert.ok(registered.ruleRefs.includes("815.1.b"));
  assert.ok(registered.ruleRefs.includes("815.1.c.2"));
  assert.ok(registered.ruleRefs.includes("815.2"));
});

test("ven-118-166 Horns of the Dragon: the Tank expansion for this identity is the lethal-first assignment requirement", () => {
  const expansion = tank.expand({ host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  // 815.1.b / 815.1.c: 同控制者下没有 Tank 的单位在此之前不是合法分配目标。
  assert.equal(ability.effect.kind, "continuous.combat");
  assert.equal(ability.effect.mode, "damage-assignment");
  assert.equal(ability.effect.priority, "first");
  assert.equal(ability.effect.damage, "lethal");
  assert.equal(ability.effect.controllerScope, "same-controller");
  assert.equal(ability.effect.appliesTo, "self");
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

test("ven-118-166 Horns of the Dragon: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-118-166 Horns of the Dragon: the merged binding expands the declared keyword into its KeywordDef ability", () => {
  // RIFT-257's expandProgram resolves a CardProgram's keyword ability through the
  // generated keyword registry (keyword -> KeywordDef.expand), so the Tank
  // declaration really produces the continuous.combat static ability here.
  const kernel = world()
    .unit("horns-of-the-dragon", { zone: "board", might: 6, keywords: [{ id: "Tank" }] })
    .build();
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const expanded = expandProgram(registry.get(CANONICAL_ID), kernel.getObject("horns-of-the-dragon"));

  assert.deepEqual(expanded.declared.map(ability => ability.keyword), ["tank"]);
  assert.equal(expanded.expanded.length, 1);
  const [ability] = expanded.expanded;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.combat");
  assert.equal(ability.effect.mode, "damage-assignment");
  assert.equal(ability.effect.priority, "first");
  assert.equal(ability.effect.damage, "lethal");
  assert.equal(ability.effect.controllerScope, "same-controller");
  assert.equal(ability.effect.appliesTo, "self");
  assert.equal(ability.effect.excludesKeyword, "Tank");
});

test("ven-118-166 Horns of the Dragon: the continuous.combat primitive reports the missing consumer instead of faking a registration", () => {
  // continuous.combat (RIFT-258/264 expansion target) deliberately negates with
  // "impossible" while the combat damage-assignment consumer is unmerged: no fake
  // registration, and the layer engine still has no branch for the kind.
  const kernel = world()
    .unit("horns-of-the-dragon", { zone: "board", might: 6 })
    .build();
  const run = runInstruction(combat, { flags: ["tank"], appliesTo: "self" }, {
    world: kernel.clone({ sourceSnapshot: kernel.getObject("horns-of-the-dragon") })
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
  assert.equal(run.world.continuousEffects.length, 0);

  const layers = createLayerEngine([kernel.getObject("horns-of-the-dragon")], [{
    effect: {
      id: "tank:no-consumer",
      layer: "ability",
      source: kernel.ref("horns-of-the-dragon"),
      filter: { objectId: "horns-of-the-dragon" },
      effect: { kind: "continuous.combat", priority: "first", damage: "lethal" }
    },
    duration: { type: "permanent" }
  }]);
  // 815.1.b is an assignment requirement, not a Might/keyword change: nothing in
  // the layer evaluation honours it.
  const evaluated = layers.evaluate(kernel.ref("horns-of-the-dragon"));
  assert.equal(evaluated.might, 6);
  assert.deepEqual(evaluated.keywords, []);
});

test.todo(
  "ven-118-166 Horns of the Dragon: assign lethal damage to Horns of the Dragon before any other unit with the " +
    "same controller that does not have [Tank] during the Combat Damage step (CR 815.1.b / 815.1.c.1 / 815.1.c.2, " +
    "467.2.c.6-c.9) — combat/base-combat-allocation.ts still binds no Tank assignment-priority requirement and " +
    "the merged continuous.combat registration has no combat consumer"
);
