import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/hextech-gauntlets.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";

const CANONICAL_ID =
  "card.hash-955bd858659e4d3eb8edfd20347a7496c51932de05cafd32fc71d86d94f96e47";
const SOURCE_TEXT =
  "[Equip] :rb_energy_3::rb_rune_rainbow:. This ability's Energy cost is reduced " +
  "by the Might of the unit you choose. (Pay the cost: Attach this to a unit you control.)";

const [equip] = program.abilities;

function equipExpansion() {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  return definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL_ID } });
}

test("unl-188-219 Hextech Gauntlets: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-188-219 Hextech Gauntlets: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README 第 2 节：judgeReason 必须点名缺哪个语义与依赖任务。
  assert.match(program.judgeReason, /818\.1\.c\.4/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
});

test("unl-188-219 Hextech Gauntlets: the only ability is the Equip keyword with the printed 3 Energy symbols", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c：印刷费用为 3 Energy + 1 任意域 Power；冻结的 KeywordAbility 只有
  // keyword/value 字段，故 value 只记录印刷的 3 个能量符号（见文件头与 judgeReason），
  // 不写会被校验器拒绝的扩展字段。
  assert.equal(equip.value, 3);
  assert.deepEqual(Object.keys(equip).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), ["keyword", "kind", "value"]);
});

test("unl-188-219 Hextech Gauntlets: the merged Equip expansion is valid EffectIR for this card", () => {
  const expansion = equipExpansion();
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [...expansion],
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  // 818.1.b.1 / 818.1.c.2：选择的单位是 Target，且限你控制的单位。
  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.deepEqual(ability.body[0].targets, [
    {
      id: "equip-target",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-188-219 Hextech Gauntlets: the merged Equip activation cost is rejected by the cost plan", () => {
  // 费用管线对未知支付种类直接 blocked：这条真实的失败就是 judgeReason 的证据。
  const kernel = world()
    .unit("hextech-gauntlets", {
      types: ["gear"],
      might: 3,
      energy: 3,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("vi", { types: ["unit"], might: 5, owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("hextech-gauntlets") });
  const [activation] = equipExpansion();

  assert.throws(
    () => buildCostPlan(context, { id: "hextech-gauntlets:equip", cost: activation.cost }),
    error =>
      error instanceof CostPlanError &&
      error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
});

test("unl-188-219 Hextech Gauntlets: the merged Equip body attaches the Gear to the chosen unit", () => {
  // 818.1.b / 818.1.b.2：费用支付后把本 Gear 附着到所选单位（Top-Most Card）。
  // 费用本身仍被阻断（见上一条），此处只执行已合入的 attach 半段。
  const [activation] = equipExpansion();
  const [attachInstruction] = activation.body;
  const kernel = world()
    .unit("hextech-gauntlets", {
      types: ["gear"],
      might: 3,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("vi", { types: ["unit"], might: 5, owner: "A" })
    .build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("hextech-gauntlets") });
  const run = runInstruction(
    attach,
    {
      host: { kind: "constant", value: { kind: "target", id: "equip-target" } }
    },
    { world: source, targets: { "equip-target": [source.ref("vi")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.attached.count, 1);
  assert.deepEqual(source.getObject("hextech-gauntlets").attachedTo, { id: "vi", zoneEntryId: 1 });
  assert.deepEqual(source.events.map(event => event.action), ["attach"]);
  // 435.4.a：附着改变位置，但不是 Move；本原语不提交 move 动作。
  assert.equal(source.events.some(event => event.action === "move-location"), false);
  assert.equal(attachInstruction.op, "effect.attach");
});

test.todo(
  "Hextech Gauntlets: pay the printed Equip cost (3 Energy + 1 Any Domain Power [A], CR 135.2.e.5.a / 818.1.c) — " +
    "the merged keywords/Equip.ts expansion still declares payments: [{ kind: 'equip' }] and buildCostPlan blocks " +
    "with CostPlanError 'Unsupported payment kind: equip' (RIFT-89)"
);
test.todo(
  "Hextech Gauntlets: reduce the Equip Energy cost by the Might of the chosen unit (CR 818.1.c.4 / 143.2.a / 206) " +
    "through a cost.modify discount evaluated at Finalize against the locked target's effective Might (RIFT-89)"
);
test.todo(
  "Hextech Gauntlets: carry the printed Equip cost in the card program — KeywordAbility (contract 3.1) has no cost " +
    "parameter slot, so '3 Energy + 1 [A]' lives only in the file header and judgeReason (contract change request)"
);
