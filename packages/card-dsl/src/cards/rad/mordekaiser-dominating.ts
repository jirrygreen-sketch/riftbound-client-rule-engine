import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mordekaiser, Dominating (rad-137-167) — Unit, Order,
 * 9 energy / 2 power / 8 Might，标签 Noxus/Mordekaiser/Champion。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-137-167):
 *   "When you play me or when I attack, you may discard 1 to kill a unit or gear."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：card-played 时点（420.4.a）；"when I attack"：attack-declared
 *   时点（323.2 取得 Attacker 身份）。同一段文字的 "or" 是两个触发条件，按契约 3.1
 *   拆成两个 triggered 能力（同一 body 的重复引用是数据，不是流程）。
 * - "you may discard 1 to kill a unit or gear"："you may" 位于效果开头（383.3.a），
 *   紧随其后的 "discard 1 to ..." 是 383.3.b 的指令内费用——它被当作该触发能力的
 *   base cost，必须在 Finalize 支付（204.1.c/204.3.a），而不是结算时的选择。因此这里用
 *   triggered.optional = true（效果首段 "you may" 的 Finalize 决定），而不是 body 里的
 *   choice.optional；费用与效果之间的先后由 Finalize 管线承担。
 * - "discard 1"：423.1 的 Discard 动作；卡片选择的私密性由 423.1.a 的 chooser-only
 *   决定（355.10.a 手牌不是公开区域）。"to kill a unit or gear" 是效果侧：429.3/429.6
 *   的 Kill 指令，"a unit or gear" 用 TargetSpec（355.10 的选目标）。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - 383.3.b 的 base-cost-within-instructions：契约 3.1 的 triggered 能力没有 cost
 *   字段，卡牌程序无法声明"Finalize 前必须弃 1 张作为该触发能力的基础费用"；
 *   把它写成 body 首条 effect.discard 会把 Finalize 费用降级成结算效果
 *   （355.10.c.1 的代价必须先行），属语义偏离而非近似实现，因此保留 "discard 1" 于
 *   body 之前不写。下面的 body 只保留效果侧 kill，并在 judgeReason 记明缺什么。
 * - cost.discard 未合入（RIFT-9 的 cost.* 一族），chain 的 base cost 也不能由卡牌
 *   程序提供。
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
    "缺 383.3.b/204.1.c 的\"指令内费用作为触发能力基础费用\"：383.3.b 规定效果开头（紧跟" +
    "首段 \"you may\"）的 \"discard 1\" 必须在 Finalize 作为该触发能力的 base cost 支付，" +
    "而契约 3.1 的 triggered 能力没有 cost 字段，cost.discard 也未合入（RIFT-89 的 cost.*" +
    "一族），卡牌程序无法声明该费用；把它写成 body 首条 effect.discard 会把 Finalize 费用" +
    "降级为结算效果（355.10.c.1 的代价必须先付），属语义偏离，因此不写入。" +
    "effect.kill 与两个触发时点已合入，黄金测试按其声明形状隔离执行 kill 效果。" +
    "依赖：RIFT-89（费用计划/cost.discard）、批 4（触发管线接线）。",
  abilities,
  sourceText: "When you play me or when I attack, you may discard 1 to kill a unit or gear."
} satisfies CardProgram;

export default program;
