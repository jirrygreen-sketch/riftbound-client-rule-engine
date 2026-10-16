import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/nasus-ascended.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

test("nasus-ascended: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-2df5544ffea6f698095320fc6fa4ee6de200fc1053c9c5737ca847fc57e18b35"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
      "[Empower] :rb_energy_8: (:rb_energy_8:: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] When I conquer, you score 1 point."
  );
});

test("nasus-ascended: judgeReason names the missing keyword expansions and layers", () => {
  assert.match(program.judgeReason, /empower/i);
  assert.match(program.judgeReason, /empowered/i);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /RIFT-84/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("nasus-ascended: Deflect 2 and Empower 8 are declared as keywords, not expanded", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "deflect", value: 2 });
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "empower", value: 8 });
});

test("nasus-ascended: the merged keyword binding expands [Deflect 2] and rejects the missing Empower", () => {
  // RIFT-84's Deflect KeywordDef is merged and sums its printed value into one
  // static target.tax ability (809.1.b.2/809.2); RIFT-264's batch has no Empower
  // definition, so RIFT-257's expansion fails closed for that keyword.
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  // 快照不带印刷关键词：只让 CardProgram 的声明参与展开，避免同一 [Deflect 2]
  // 被 declared + printed 各算一次（807.2/809.2 的求和针对真实实例）。
  const kernel = world()
    .unit("nasus", { zone: "board" })
    .build();
  const blocked = world()
    .unit("nasus", { zone: "board" })
    .build();
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);

  // 只声明 Deflect：展开为 target.tax（卡牌侧不重写 809.1.c 的附加费用）。
  const deflectOnly = { ...program, abilities: program.abilities.filter(ability => ability.keyword !== "empower") };
  const local = new ProgramRegistry([{ ...deflectOnly, status: "executable", judgeReason: undefined }]);
  const expanded = expandProgram(local.get(program.canonicalCardId), kernel.getObject("nasus"));
  assert.deepEqual(
    expanded.expanded.filter(ability => ability.kind === "static").map(ability => ability.effect),
    [{ kind: "target.tax", value: { kind: "constant", value: 2 } }]
  );

  assert.throws(
    () => expandProgram(registry.get(program.canonicalCardId), blocked.getObject("nasus")),
    error => error.code === "judge-required" && /Keyword empower has no executable KeywordDef/.test(error.message)
  );
});

test("nasus-ascended: the merged target tax still has no card-side consumer", () => {
  // 809.1.c/809.1.d：Deflect 是强制附加费用，由 target-plan 的 tax 通道追加；
  // RIFT-90 已合入 TargetTaxAdapter，但没有任何已合入路径把卡牌的 target.tax 静态
  // 效果接进去（RIFT-257 的 static binder 缺省是 noopStaticBinder）。这一层缺口
  // 不是层引擎能补的，因此卡牌保持 judge-required。
  const kernel = world().unit("nasus", { zone: "board", might: null }).build();
  const layers = createLayerEngine([kernel.getObject("nasus")], [{
    effect: {
      id: "deflect:no-consumer",
      layer: "ability",
      source: kernel.ref("nasus"),
      filter: { objectId: "nasus" },
      effect: { kind: "target.tax", value: 2 }
    },
    duration: { type: "permanent" }
  }]);
  const evaluated = layers.evaluate(kernel.ref("nasus"));
  // target.tax 不是图层能力：命中该注册行也不会改变 Might 或关键词。
  assert.equal(evaluated.might, kernel.getObject("nasus").might);
  assert.deepEqual(evaluated.keywords, []);
});

test("nasus-ascended: the Empowered dependent ability is a self-scoped conquer trigger", () => {
  const ability = program.abilities[2];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  // 383.4.c.2.c：征服得分被替代时触发仍然发生，所以不把得分成功写成触发条件。
  assert.equal(ability.trigger.once, undefined);
});

test("nasus-ascended: the body scores exactly 1 with a single unlinked instruction", () => {
  const ability = program.abilities[2];
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "nasus-ascended.score");
  assert.equal(instruction.op, "effect.score");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("nasus-ascended: the conquer body really scores 1 for the ability controller", () => {
  const ability = program.abilities[2];
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(outcome.linkedValues["nasus-ascended.score.scored"], [
    { player: "A", amount: 1 }
  ]);
});

test("nasus-ascended: the same body does not score for a non-controller", () => {
  const ability = program.abilities[2];
  const kernel = world().player("A").player("B").build();
  // 把控制者换成 B 后，"you score" 的隐含指向随之改变（190.6.d），
  // 仍然只有能力控制者得点。
  Object.defineProperty(kernel, "controller", { value: "B" });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").score, 1);
  assert.equal(kernel.player("A").score, 0);
});

test.todo(
  "nasus-ascended: [Deflect 2]'s merged target.tax expansion needs the card-side static binding " +
    "into the TargetPlan tax adapter so an opposing spell that chooses this unit appends 2 Power of " +
    "any Domain (809.1.c/809.1.c.1/809.1.d; RIFT-257 static binder + RIFT-90 tax adapter)"
);
test.todo(
  "nasus-ascended: [Empower] 8 activation (827.1.c.1 cost.activated + effect.empower, " +
    "'play only if not Empowered' 827.1.c.5) and the Empowered-state gate on the dependent " +
    "ability (828.1.c) need the Empower/Empowered KeywordDefs (RIFT-264 batch has none) plus the " +
    "Empowered predicate in Condition/ObjectSnapshot (RIFT-87)"
);
