import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mordekaiser, Dominating — CR v1.5 383.3.a/b, 204.1.c, 423.1, 429.6.
 * Two self triggers share the kill effect. The leading optional discard is
 * the triggered ability's base cost and must be paid at Finalize. Re-probed
 * 2026-10-17:
 * - The consumption half exists: chain/engine.ts forwards
 *   trigger.registration.cost into the ChainItem (Finalize builds and pays the
 *   plan), and cost/kinds/discard.ts can pay an explicit selection.
 * - The card-facing half does not: ir/types.ts TriggeredAbility has no cost
 *   field, so programs/triggers.ts has nothing to forward (verified: both
 *   built registrations have no cost property).
 * - The discard's non-target hand pick also needs choice.filter consumption:
 *   cost/plan-values.ts choiceObjects() maps choice.options through reference()
 *   (exact ObjectRefs only) and never reads the filter, so a static hand-filter
 *   choice cannot be planned.
 * Do not insert an optional/discard resolution wrapper as a substitute.
 */
const killUnitOrGear = (id: string) => ({
  id,
  op: "effect.kill" as const,
  args: { target: { kind: "constant", value: "mordekaiser-dominating.unit-or-gear" } as const },
  targets: [
    {
      id: "mordekaiser-dominating.unit-or-gear",
      filter: { type: ["unit", "gear"], zone: "board" },
      min: 1,
      max: 1,
      selection: "one" as const
    }
  ]
});

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: true,
    body: [killUnitOrGear("mordekaiser-dominating.kill-on-play")]
  },
  {
    kind: "triggered",
    trigger: { at: "attack-declared", filter: { self: true } },
    optional: true,
    body: [killUnitOrGear("mordekaiser-dominating.kill-on-attack")]
  }
];

const program = {
  canonicalCardId: "card.hash-e9fc2b80d00083fe6d3d05f817392c9995133d2b989fa879251804de73b2df15",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 CR 383.3.b/383.3.b.1 的触发基础费用绑定：TriggeredAbility 没有 cost 字段，programs/triggers.ts 未把「discard " +
    "1」传入已有 TriggerRegistration.cost → ChainEngine Finalize（实测两张触发的生产注册都没有 cost 属性）；消费端本身已合入：" +
    "chain/engine.ts 的 append 会把 registration.cost 交给 ChainItem 的 Finalize。费用的手牌非目标选择还需让费用规划消费 PickSpec.filter 并绑定运行时引用：" +
    "cost/plan-values.ts 的 choiceObjects 只接受精确 ObjectRef，不读 filter。" +
    "cost/kinds/discard.ts 与费用计划付款已存在，不能将弃牌写成 body 效果或在测试中额外包 choice.optional 来假装已支付该费用。",
  abilities,
  sourceText: "When you play me or when I attack, you may discard 1 to kill a unit or gear."
} satisfies CardProgram;

export default program;
