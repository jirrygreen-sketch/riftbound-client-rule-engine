import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shepherds-heirloom.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";

const CANONICAL_ID =
  "card.hash-8853921c65fab3eb2f8dc4d5caa2150e248d389203320f385589382ababadec0";
const SOURCE_TEXT =
  "When you play this, gain 1 XP.\n" +
  "[Equip] — Spend 1 XP (Pay the cost: Attach this to a unit you control.)";

const [onPlay, equip] = program.abilities;
const [gainXp] = onPlay.body;

test("unl-158-219 Shepherd's Heirloom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-158-219 Shepherd's Heirloom: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /818\.1\.c\.[34]/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /818\.1\.c\.3/);
  assert.match(program.judgeReason, /费用参数槽|最终绑定/);
});

test("unl-158-219 Shepherd's Heirloom: 'When you play this' subscribes to card-played for this card", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(onPlay.optional, false);
});

test("unl-158-219 Shepherd's Heirloom: the play effect gains exactly 1 XP for the controller", () => {
  assert.deepEqual(onPlay.body.map(instruction => instruction.id), ["shepherds-heirloom.gain-xp"]);
  assert.equal(gainXp.op, "effect.xp");
  // 730.1："gain 1 XP"；获得者缺省即能力控制者（190.6.d）。
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(gainXp.args.player, undefined);
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
});

test("unl-158-219 Shepherd's Heirloom: the Equip keyword is declared with the printed 1 cost and no Power domain", () => {
  // 818.1.a：Equip 出现在带 Equipment 标签的 Gear 上（本卡 tags 含 Equipment）。
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  // 印刷费用是 "Spend 1 XP"，没有 Power 部分：不写 costDomain（见 judgeReason 与契约变更请求）。
  assert.equal(equip.costDomain, undefined);
});

test("unl-158-219 Shepherd's Heirloom: gaining 1 XP executes through the chain adapter", () => {
  const kernel = world().build();
  const outcome = resolveChainBody([gainXp], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["gain-xp"]);
});

test("unl-158-219 Shepherd's Heirloom: a replaced XP gain reports the actual addition (CR 359.2.c)", () => {
  const kernel = world().build();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "prevented" : null));
  const run = runInstruction(xp, { amount: gainXp.args.amount }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(kernel.player("A").xp, 0);
});

test("unl-158-219 Shepherd's Heirloom: the Equip expansion for this declaration is valid EffectIR and targets a unit you control", () => {
  // 818.1.b.1 / 818.1.c.2：展开功能上等于「[费用]: Attach this to a unit you control.」。
  // 本测试只固定展开本身的有效性与目标形状，不断言费用管线当前是否已支持该费用种类
  // （那类断言会在依赖合入后失败；缺口用 test.todo 记录）。
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const expansion = definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL_ID } });
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [...expansion],
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.body.map(step => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
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

test("unl-158-219 Shepherd's Heirloom: an XP cost is payable by the merged cost plan (730.2 / 357.2)", () => {
  // 730.2 / 357.2：XP 是可支付的非标准费用；这条探针固定住管线已有的能力。
  const kernel = world()
    .player("A", { xp: 1 })
    .unit("shepherds-heirloom", {
      types: ["gear"],
      might: 2,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("shepherds-heirloom") });
  const plan = buildCostPlan(context, {
    id: "shepherds-heirloom:xp-cost-probe",
    cost: { kind: "activated", payments: [{ kind: "xp", amount: { kind: "constant", value: 1 } }] }
  });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.xp, 1);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "spend-xp"]);
  assert.equal(context.player("A").xp, 0);
});

test.todo(
  "Shepherd's Heirloom: pay the printed 'Spend 1 XP' Equip cost (CR 818.1.c.3) — needs the Equip activation cost " +
    "to be carried from the printed text into the Finalize cost plan and payable as XP"
);
test.todo(
  "Shepherd's Heirloom: carry the printed Equip cost kind/amount in the card program — KeywordAbility (contract 3.1) " +
    "has no cost parameter slot, so the XP unit of 'value: 1' is only documented in the file header and judgeReason"
);
