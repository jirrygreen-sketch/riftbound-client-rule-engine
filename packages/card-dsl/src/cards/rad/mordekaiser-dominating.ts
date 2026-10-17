import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mordekaiser, Dominating — CR v1.5 383.3.a/b, 204.1.c, 423.1, 429.6.
 * Two self triggers share the kill effect. The leading optional discard is
 * the triggered ability's base cost and must be paid at Finalize. Discard
 * cost kinds and TriggerRegistration.cost already exist, but TriggeredAbility
 * has no cost field and programs/triggers.ts does not bind it. Do not insert
 * an optional/discard resolution wrapper as a substitute.
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
    "1」传入已有 TriggerRegistration.cost → ChainEngine Finalize；费用的手牌非目标选择还需动态 picks（RIFT-358）。" +
    "cost/kinds/discard.ts 与费用计划付款已存在，不能将弃牌写成 body 效果或在测试中额外包 choice.optional 来假装已支付该费用。",
  abilities,
  sourceText: "When you play me or when I attack, you may discard 1 to kill a unit or gear."
} satisfies CardProgram;

export default program;
