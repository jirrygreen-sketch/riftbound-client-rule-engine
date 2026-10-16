import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/heimerdinger-inventor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;

test("Heimerdinger, Inventor program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Heimerdinger, Inventor identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-b7190a8e16c22b4109edaa4eb5b9e4966b3c5224711d5cc7760f15b5a996bef4"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /479\.3/);
  assert.match(program.judgeReason, /RIFT-258\/259/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /動態|动态/);
  assert.equal(
    program.sourceText,
    "I have all :rb_exhaust: abilities of all friendly legends, units, and gear."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: static ability-altering grant bound to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.grant-abilities");
  assert.equal(ability.effect.appliesTo, "self");
  // 135.2.e.2 / 415.5：被授予的是「以横置为费用」的启动能力。
  assert.equal(ability.effect.cost, "exhaust");
  // 355.10.d："all friendly legends, units, and gear" 是按特征选择的集合，不是目标。
  assert.deepEqual(ability.effect.filter, {
    zone: "board",
    type: ["legend", "unit", "gear"],
    controller: "self"
  });
  assert.equal(ability.condition, undefined);
});

test("golden: the granted-source filter selects friendly legends/units/gear on the board", () => {
  // 参考内核按值比较 controller；生产选择管线把 "self" 绑定为能力控制者（layers/filter.ts
  // 的 selectorMatches）。这里用具体玩家值验证同一集合语义。
  const kernel = world()
    .unit("friendly-unit", { controller: "A", owner: "A" })
    .unit("friendly-gear", { types: ["gear"], controller: "A", owner: "A" })
    .unit("friendly-legend", { types: ["legend"], controller: "A", owner: "A" })
    .unit("friendly-spell-on-chain", { types: ["spell"], zone: "chain", controller: "A", owner: "A" })
    .unit("enemy-unit", { controller: "B", owner: "B" })
    .build();

  const claimed = kernel
    .query({ zone: "board" })
    .filter(object =>
      matchesObjectFilter(
        { zone: "board", type: ["legend", "unit", "gear"], controller: "A" },
        object
      )
    )
    .map(object => object.ref.id);

  assert.deepEqual(claimed.sort(), ["friendly-gear", "friendly-legend", "friendly-unit"]);
  // 不在 board 上的牌不予考虑（365.1：永久物的被动能力通常只在场上生效）。
  assert.equal(claimed.includes("friendly-spell-on-chain"), false);
  // 对手的对象不在 "friendly" 集合里。
  assert.equal(claimed.includes("enemy-unit"), false);
});

test.todo(
  "Heimerdinger, Inventor: the ability-altering (479.3) grant layer that copies each referenced object's " +
    "exhaust-cost activated abilities onto this unit, with a dependency closure over the runtime source set " +
    "(RIFT-258/259 ability layer; RIFT-257 static ability binding; ability-templates.md section 4)"
);
