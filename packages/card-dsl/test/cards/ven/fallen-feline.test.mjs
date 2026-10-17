import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/fallen-feline.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-e308123735feeaeba45468a3883162bc0278fffe1ef3374615c10a8647de047c";
const SOURCE_TEXT =
  "When you play me, name a spell.\n" +
  "While I'm at a battlefield, opponents can't play spells with that name.";

const [nameSpell, playRestriction] = program.abilities;
const [nameInstruction] = nameSpell.body;

test("ven-132-166 Fallen Feline: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-132-166 Fallen Feline: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /choice\.name/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /762\.1/);
  assert.match(program.judgeReason, /appliesTo:opponent/);
  assert.match(program.judgeReason, /namedFrom/);
  assert.match(program.judgeReason, /condition:false/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-132-166 Fallen Feline: 'When you play me' is a mandatory card-played self trigger", () => {
  assert.equal(nameSpell.kind, "triggered");
  assert.equal(nameSpell.trigger.at, "card-played");
  assert.deepEqual(nameSpell.trigger.filter, { self: true });
  assert.equal(nameSpell.optional, false);
  assert.equal(nameSpell.body.length, 1);
});

test("ven-132-166 Fallen Feline: the naming instruction keeps the printed link for the ban", () => {
  assert.equal(nameInstruction.id, "fallen-feline.name-a-spell");
  // 759/760: the effect instructs the player to name a card; 762 restricts the
  // legal names. The naming primitive remains a real dependency of this card.
  assert.equal(nameInstruction.op, "choice.name");
  assert.deepEqual(nameInstruction.args.kind, { kind: "constant", value: "spell" });
  assert.deepEqual(nameInstruction.args.linkKey, { kind: "constant", value: "namedCard" });
});

test("ven-132-166 Fallen Feline: the play ban is a static restriction gated on being at a battlefield", () => {
  assert.equal(playRestriction.kind, "static");
  assert.equal(playRestriction.effect.kind, "continuous.restrict");
  // 合并原语（RIFT-259）没有 cannot-play 这个 mode：未知 mode 会以 negated/impossible
  // 失败关闭，所以程序写成已支持的 prohibit + action "play-spell"（缺口见 judgeReason）。
  assert.equal(playRestriction.effect.mode, "prohibit");
  assert.deepEqual(playRestriction.effect.actions, ["play-spell"]);
  assert.equal(playRestriction.effect.appliesTo, "opponent");
  assert.deepEqual(playRestriction.effect.filter, { type: "spell" });
  // The naming result still needs a persistent host binding and namedFrom consumer.
  assert.deepEqual(playRestriction.effect.namedFrom, {
    instructionId: "fallen-feline.name-a-spell",
    key: "namedCard"
  });
  // “While I'm at a battlefield”: the ability's own condition.
  assert.equal(playRestriction.condition.kind, "compare");
  assert.equal(playRestriction.condition.operator, "gte");
  // Base also has a non-null location: explicitly require the battlefield type.
  assert.deepEqual(playRestriction.condition.left, {
    kind: "count",
    subject: "host-at-battlefield",
    filter: { object: "self", zone: "board", location: "battlefield" }
  });
  assert.deepEqual(playRestriction.condition.right, { kind: "constant", value: 1 });
});

test("ven-132-166 Fallen Feline: review evidence — continuous.restrict is merged", () => {
  // 复核证据：原 judgeReason 说“没有卡牌侧 continuous.restrict 的注册入口”，
  // 原语、查询与链消费已合入；整卡仍缺命名持久绑定与 opponent 静态过滤。
  assert.equal(instructionDefinitionsById.has("continuous.restrict"), true);
  assert.equal(typeof restrictions, "function");

  // 用本卡声明的 mode/action 驱动真实原语一次，再断言 layers/rules 查询能看到它；
  // 这里只验证原语与查询；静态 binder 的 opponent 解析仍是整卡缺口。
  const kernel = world()
    .unit("fallen-feline", { types: ["unit"], zone: "board", owner: "A", controller: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fallen-feline") });
  const run = runInstruction(restrict, {
    mode: { kind: "constant", value: playRestriction.effect.mode },
    action: { kind: "constant", value: playRestriction.effect.actions },
    appliesTo: { kind: "constant", value: { controller: "B" } },
    duration: { kind: "constant", value: "while-source-here" }
  }, { world: context });

  assert.equal(run.result.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  const registry = new ContinuousEffectRegistry();
  for (const [index, entry] of context.continuousEffects.entries()) {
    registry.register(entry.effect, entry.duration, index + 1);
  }
  const found = restrictions(registry, "play-spell", undefined, undefined, "A");
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].actions, ["play-spell"]);
});

test.todo(
  "ven-132-166 Fallen Feline: 'name a spell' needs a naming choice primitive (collected name as " +
    "a linked value; 759-762) — no choice.name / effect.name-card op is merged"
);

test.todo(
  "ven-132-166 Fallen Feline: 'opponents can't play spells with that name' needs a " +
    "persistent host-bound naming result, a namedFrom predicate, static appliesTo:opponent binding, " +
    "and battlefield-condition consumption by the rule query"
);

/**
 * 复核（2026-10-17）执行证据：四处缺口用真实解释器 / 静态 binder / 规则查询复现。
 */
test("ven-132-166 Fallen Feline evidence: the naming instruction is not a registered opcode", () => {
  const kernel = world()
    .unit("fallen-feline", { types: ["unit"], zone: "board", owner: "A", controller: "A" })
    .build();
  // 759/760：命名动作必须由解释器执行；当前未注册，失败关闭而不是伪造命名结果。
  assert.throws(
    () => runAbilityBody([nameInstruction], kernel.clone({ sourceSnapshot: kernel.getObject("fallen-feline") })),
    /Unregistered instruction opcode: choice\.name/,
  );
});

test("ven-132-166 Fallen Feline evidence: static appliesTo:opponent cannot bind and the rule query ignores the battlefield condition", () => {
  const f = fixture({ cards: [{ id: "fallen-feline", cardId: CANONICAL_ID, types: ["unit"], might: 3, energy: 2, power: ["Order"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("fallen-feline"), to: "base" });
  const binder = createEngineStaticBinder(f.engine);
  // programs/statics.ts 的相对玩家限制过滤：opponent 没有绑定，绑定期失败关闭。
  assert.throws(
    () => binder.bindStatic(playRestriction, f.kernel.getObject("fallen-feline")),
    /Unsupported static appliesTo "opponent"/,
  );

  // layers/rules/query.ts 的 restrictions() 不消费静态条件：注册一个 condition:false 的限制，
  // 查询仍然返回命中；战场门控因此无法阻止 Base 上的宿主生效。
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "fallen-feline.probe",
    layer: "ability",
    source: f.kernel.ref("fallen-feline"),
    filter: { type: "spell" },
    effect: {
      kind: "restriction",
      mode: "prohibit",
      actions: ["play-spell"],
      appliesTo: "opponent",
      namedFrom: playRestriction.effect.namedFrom,
      condition: () => false
    }
  }, { type: "permanent" }, 1);
  const found = restrictions(registry, "play-spell", undefined, undefined, "A");
  assert.equal(found.length, 1);
  // namedFrom 原样保留但无消费方（查询结果字段只暴露 source/filter/名字）。
  assert.deepEqual(found[0].filter, { type: "spell" });
  assert.equal("namedFrom" in found[0], false);
});


test("ven-132-166 Fallen Feline: the real condition distinguishes a battlefield from Base", () => {
  const f = fixture({ cards: [{ id: "feline", types: ["unit"], might: 3, energy: 2, power: ["Order"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("feline"), to: "base" });
  const probe = () => {
    f.engine.advance();
    f.engine.execute(f.draft("location-probe", {
      id: `location:${f.engine.trace.length}`,
      source: f.kernel.getObject("feline"),
      body: [{
        id: "fallen-feline.location",
        op: "condition.predicate",
        args: { condition: { kind: "constant", value: playRestriction.condition } }
      }]
    }));
    resolveAll(f.engine);
    return f.kernel.linked("fallen-feline.location.value");
  };
  assert.equal(probe(), false);
  f.engine.commit({ type: "move-location", object: f.kernel.ref("feline"), to: { type: "battlefield", id: "battlefield-1" } });
  assert.equal(probe(), true);
  f.engine.commit({ type: "move-location", object: f.kernel.ref("feline"), to: { type: "base", player: "A" } });
  assert.equal(probe(), false);
});

test("ven-132-166 Fallen Feline: Chain Execute consumes a real registered play-spell restriction", () => {
  const f = fixture({ cards: [{ id: "spell", types: ["spell"], energy: 1, power: [] }] });
  const context = f.kernel.clone({ sourceSnapshot: f.kernel.getObject("source") });
  const run = runInstruction(restrict, {
    mode: { kind: "constant", value: playRestriction.effect.mode },
    action: { kind: "constant", value: playRestriction.effect.actions },
    appliesTo: { kind: "constant", value: { type: "spell", controller: "A" } },
    duration: { kind: "constant", value: "while-source-here" }
  }, { world: context });
  assert.equal(run.result.status, "executed");
  for (const entry of context.continuousEffects) f.engine.layers.addContinuous(entry.effect, entry.duration);
  assert.throws(() => f.engine.execute(f.card("spell", { body: [] })), /restricted/);
  assert.equal(f.kernel.getObject("spell").zone, "hand");
  assert.equal(f.kernel.player("A").energy, 20);
});
