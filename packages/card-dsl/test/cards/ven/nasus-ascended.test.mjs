import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/nasus-ascended.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";

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

test("nasus-ascended: judgeReason names the missing printed costs, target tax and conquer bindings", () => {
  assert.match(program.judgeReason, /empower/i);
  assert.match(program.judgeReason, /empowered/i);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /target\/tax\/collect\.ts/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("nasus-ascended: Deflect 2 and Empower 8 are declared as keywords, not expanded", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "deflect", value: 2 });
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "empower", value: 8 });
});

test("nasus-ascended: the merged keyword binding expands the declared [Deflect 2]", () => {
  // The merged Deflect KeywordDef sums its printed value into one static
  // target.tax ability (809.1.b.2/809.2); expandProgram resolves the card's
  // declaration through the generated keyword registry.
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  // 快照不带印刷关键词：只让 CardProgram 的声明参与展开，避免同一 [Deflect 2]
  // 被 declared + printed 各算一次（807.2/809.2 的求和针对真实实例）。
  const kernel = world()
    .unit("nasus", { zone: "board" })
    .build();

  // Empower now expands too; inspect the actual complete declaration.
  const expanded = expandProgram(program, kernel.getObject("nasus"));
  assert.deepEqual(
    expanded.expanded.filter(ability => ability.kind === "static").map(ability => ability.effect),
    [{ kind: "target.tax", value: { kind: "constant", value: 2 } }]
  );
});

test("nasus-ascended: the Empowered dependent ability is a self-scoped conquer trigger", () => {
  const ability = program.abilities[2];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquered",
    filter: { source: "self" }
  });
  assert.deepEqual(ability.trigger.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
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
  const bound = kernel.clone({ controller: "B" });
  const outcome = resolveChainBody(ability.body, bound);
  assert.equal(outcome.status, "executed");
  assert.equal(bound.player("B").score, 1);
  assert.equal(bound.player("A").score, 0);
});

test.todo(
  "nasus-ascended: [Deflect 2]'s merged target.tax expansion needs the card-side static binding " +
    "into the TargetPlan tax adapter so an opposing spell that chooses this unit appends 2 Power of " +
    "any Domain (809.1.c/809.1.c.1/809.1.d; static kind mapping and chain tax consumption)"
);
test.todo(
  "nasus-ascended: [Empower] 8 activation (827.1.c.1 cost.activated + effect.empower, " +
    "'play only if not Empowered' 827.1.c.5) and the Empowered-state gate on the dependent " +
    "ability (828.1.c) need the printed params.cost binding and ObjectSnapshot empowered contract; the KeywordDef is merged"
);

test("nasus-ascended golden: the conquer gate observes the live Empowered state", () => {
  const base = world().unit("nasus", { cardId: program.canonicalCardId }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("nasus") });
  const gate = program.abilities[2].trigger.condition;
  assert.equal(kernel.test(gate), false);
  const activation = expandProgram(program, kernel.source).expanded.find(ability => ability.kind === "activated");
  assert.equal(resolveChainBody(activation.body, kernel).status, "executed");
  assert.equal(kernel.test(gate), true);
  assert.equal(kernel.getObject("nasus").empowered, 1);
  assert.equal(kernel.perform({ type: "disempower", object: kernel.ref("nasus") }).status, "done");
  assert.equal(kernel.test(gate), false);
});
