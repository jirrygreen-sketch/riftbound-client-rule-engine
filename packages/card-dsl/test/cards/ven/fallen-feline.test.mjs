import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/fallen-feline.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /play-spell/);
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
  // legal names. No naming primitive is merged (asserted below).
  assert.equal(nameInstruction.op, "choice.name");
  assert.deepEqual(nameInstruction.args.kind, { kind: "constant", value: "spell" });
  assert.deepEqual(nameInstruction.args.linkKey, { kind: "constant", value: "namedCard" });
  assert.equal(instructionDefinitionsById.get("choice.name"), undefined);
});

test("ven-132-166 Fallen Feline: the play ban is a static restriction gated on being at a battlefield", () => {
  assert.equal(playRestriction.kind, "static");
  assert.equal(playRestriction.effect.kind, "continuous.restrict");
  // 合并原语（RIFT-259）没有 cannot-play 这个 mode：未知 mode 会以 negated/impossible
  // 失败关闭，所以程序写成已支持的 prohibit + action "play-spell"（缺口见 judgeReason）。
  assert.equal(playRestriction.effect.mode, "prohibit");
  assert.equal(playRestriction.effect.action, "play-spell");
  assert.equal(playRestriction.effect.appliesTo, "opponent");
  assert.deepEqual(playRestriction.effect.subject, {
    kind: "constant",
    value: { type: "spell" }
  });
  // The banned name comes from the naming instruction's linked value; recorded
  // descriptively because neither side of the link has a merged consumer.
  assert.deepEqual(playRestriction.effect.namedFrom, {
    instructionId: "fallen-feline.name-a-spell",
    key: "namedCard"
  });
  // “While I'm at a battlefield”: the ability's own condition.
  assert.equal(playRestriction.condition.kind, "compare");
  assert.equal(playRestriction.condition.operator, "ne");
  assert.deepEqual(playRestriction.condition.left, {
    kind: "object-property",
    object: "self",
    property: "location"
  });
  assert.deepEqual(playRestriction.condition.right, { kind: "constant", value: null });
});

test("ven-132-166 Fallen Feline: review evidence — continuous.restrict is merged", () => {
  // 复核证据：原 judgeReason 说“没有卡牌侧 continuous.restrict 的注册入口”，
  // 该 op 与 layers/rules 的查询都已合入（缺的是 canAct 消费方与命名谓词）。
  assert.equal(instructionDefinitionsById.has("continuous.restrict"), true);
  assert.equal(typeof restrictions, "function");

  // 用本卡声明的 mode/action 驱动真实原语一次，再断言 layers/rules 查询能看到它；
  // 唯一的替换是把 appliesTo 的 "opponent" 换成参考内核能理解的具体玩家（生产链的
  // chain/engine.ts 才负责把相对选择符解析成玩家 id，见 judgeReason）。
  const kernel = world()
    .unit("fallen-feline", { types: ["unit"], zone: "board", owner: "A", controller: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fallen-feline") });
  const run = runInstruction(restrict, {
    mode: { kind: "constant", value: playRestriction.effect.mode },
    action: { kind: "constant", value: playRestriction.effect.action },
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

test("ven-132-166 golden: running the naming body fails loudly instead of silently doing nothing", () => {
  const base = world().player("controller").unit("fallen-feline", { controller: "controller" }).build();
  const kernel = base.clone({ controller: "controller", sourceSnapshot: base.getObject("fallen-feline") });
  assert.throws(() => runAbilityBody(nameSpell.body, kernel), /Unregistered instruction opcode: choice\.name/);
});

test.todo(
  "ven-132-166 Fallen Feline: 'name a spell' needs a naming choice primitive (collected name as " +
    "a linked value; 759-762) — no choice.name / effect.name-card op is merged"
);

test.todo(
  "ven-132-166 Fallen Feline: 'opponents can't play spells with that name' needs a " +
    "name predicate read from the naming instruction's linked value plus a chain-side consumer of " +
    "the registered restriction (chain/engine.ts canAct only checks priority/showdown/turn state)"
);
