import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadowblade-lurker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-b2bea662f1f3693d6ae9fddc62c97b8b41a34b4c737adb3790687eef7399fe95";
const SOURCE_TEXT = "I cost :rb_energy_2: less for each card with my name in your trash.";

const [ability] = program.abilities;
const { effect } = ability;

/** A probe that evaluates the static ability's count expression in the kernel. */
const countProbe = {
  id: "shadowblade-lurker.count-probe",
  op: "condition.value",
  args: {
    value: effect.count,
    key: { kind: "constant", value: "cards" }
  }
};

/**
 * The reference kernel compares `owner` literally (its matchesFilter uses ===),
 * so the placeholder spelling "self" is bound by writing it on the test objects
 * — the same convention as ogn/rhasa-the-sunderer's golden. Production binds
 * the placeholder in chain/engine.ts's query normalization.
 */
const kernelWithTrash = (owner, count) => {
  const builder = world().player("controller").player("B");
  for (let index = 0; index < count; index++) builder.card(`card-${index}`, { zone: "trash", owner });
  const base = builder.build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("card-0") ?? base.getObject("controller") });
};

test("ven-096-166 Shadowblade Lurker: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-096-166 Shadowblade Lurker: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /356\.4\.b/);
  assert.match(program.judgeReason, /CostPlanInput\.discounts/);
});

test("ven-096-166 Shadowblade Lurker: one static Energy discount scoped to itself", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 356.4 / 356.4.b: "I cost [X] less" is a discount applied in the cost plan.
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.appliesTo, "self");
  assert.equal(effect.resource, "energy");
  // 每张同名牌减 2 Energy；356.4.e 的“最低值”与 356.6 的 0 地板。
  assert.deepEqual(effect.amount, { kind: "constant", value: -2 });
  assert.deepEqual(effect.minimum, { kind: "constant", value: 0 });
  assert.equal(effect.per, "card-with-my-name-in-your-trash");
  assert.equal(ability.condition, undefined);
});

test("ven-096-166 Shadowblade Lurker: the per-card count reads your trash (108.2.a)", () => {
  assert.equal(effect.count.kind, "count");
  assert.equal(effect.count.subject, "cards-with-my-name-in-your-trash");
  // 「你的垃圾场」= 区域 + 拥有者；「与我的名字相同」的谓词缺口见 judgeReason 第 2 点
  // （合并过滤器只做字面比较，读不到宿主当前名称），因此 filter 只记录这两项。
  assert.deepEqual(effect.count.filter, { zone: "trash", owner: "self" });
  assert.equal(effect.count.filter.name, undefined);
});

test("ven-096-166 golden: the printed count expression evaluates over the bound trash", () => {
  const empty = kernelWithTrash("self", 0);
  assert.equal(runAbilityBody([countProbe], empty).linkedValues["shadowblade-lurker.count-probe.cards"], 0);

  const two = kernelWithTrash("self", 2);
  const outcome = runAbilityBody([countProbe], two);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["shadowblade-lurker.count-probe.cards"], 2);

  // 只有“你的”垃圾场计入：另一名玩家的 trash 不满足 zone + owner 条件。
  const otherOnly = kernelWithTrash("B", 3);
  assert.equal(
    runAbilityBody([countProbe], otherOnly).linkedValues["shadowblade-lurker.count-probe.cards"],
    0
  );
});

test("ven-096-166 golden: the reduction is -2 Energy per counted card", () => {
  const kernel = kernelWithTrash("self", 3);
  const outcome = runAbilityBody(
    [
      {
        id: "shadowblade-lurker.reduction",
        op: "condition.value",
        args: {
          operator: { kind: "constant", value: "multiply" },
          operands: {
            kind: "constant",
            value: [effect.amount, effect.count]
          },
          key: { kind: "constant", value: "delta" }
        }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  // 3 张同名牌 × (-2) = -6（印刷数值，不是写死的常数）。
  assert.equal(outcome.linkedValues["shadowblade-lurker.reduction.delta"], -6);
});

test.todo(
  "ven-096-166 Shadowblade Lurker: install the static -2 per-card Energy discount on the Finalize cost " +
    "plan — cost.modify and the cost-plan discount evaluation are merged, but programs/statics.ts layerFor() " +
    "has no cost-modification mapping for continuous.cost-modification (fail-closed) and no consumer installs " +
    "the CardProgram static into CostPlanInput.discounts"
);

test.todo(
  "ven-096-166 Shadowblade Lurker: evaluate 'cards with my name' — the merged filters compare literals only " +
    "(layers/filter.ts characteristics, the reference kernel) and cannot read the host's current name (CR 382.4)"
);
