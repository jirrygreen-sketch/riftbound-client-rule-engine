import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dredge Up (ven-049-166) — Spell, 2 energy, no printed Power/Might, domain Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-049-166，逐字）：
 *   "Draw 1.\n[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. "
 *   "Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - "Draw 1."：effect.draw（414.1 / 414.3，已合入原语）；抽牌者缺省为能力控制者
 *   （190.6.d 的隐含 "you"），不写死玩家 id。
 * - "[Flow] :rb_energy_2:"：829.1 / 829.1.b 的功能文本是“你可以从垃圾场以其 Flow 费用
 *   打出此牌，然后放逐它”；829.1.c 规定格式为 "Flow [Cost]"，829.1.c.1 明确该费用是
 *   替换基础费用的 alternate cost。卡侧只声明 keyword（契约 3.7、README 第 5 节），
 *   展开由 effects/keywords/Flow.ts 负责，本文件不重写该逻辑。
 *   印刷的 Flow 费用是 2 Energy；它无法写进 keyword 声明——契约 3.1 的 KeywordAbility
 *   只有 keyword / value 两个字段，契约 3.8 第 3 条要求的 expand params.cost 尚未落到
 *   已合入的 KeywordDef / KeywordAbility 接口（同 ven/defender-of-tomorrow 的登记），
 *   因此印刷费用只记录在本注释与 judgeReason 里，不伪造第二条普通费用，也不写 value
 *   （Flow 的数值不是张数或点数，829.1.c）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. Flow 展开的两个消费方尚未合入（effects/keywords/Flow.ts 的文件头已登记）：
 *    - flow.cost 需要费用管线（RIFT-261）暴露可选择的替代费用、保留 null 印刷费用并
 *      记录实际支付的是哪一个独立 Flow 实例（829.1.c.3）；
 *    - replacement.event 需要替代效果的注册/排序路径（RIFT-260），且必须区分“正常离链”
 *      与“由该法术自身指示的离开”（829.1.b.1）；
 *    - 从垃圾场打出的位置许可、链项已 finalize 状态与 continuous.timing 未合入
 *      （RIFT-89 费用计划接线）。
 *    能写出声明不等于可执行（README 第 2 节），因此保持 judge-required。
 * 2. 已支持部分："Draw 1." 由 golden 用解释器 + 参考内核真实执行；Flow 的替代费用、
 *    垃圾场打出许可与延迟放逐写 test.todo。
 * 依赖：RIFT-261（费用消费者/替代费用）、RIFT-260（替代效果注册与排序）、RIFT-89（费用计划接线）。
 */
const abilities = [
  // 829.1.c：格式为 "Flow [Cost]"；印刷费用 2 Energy 记在文件头与 judgeReason（见上）。
  { kind: "keyword", keyword: "flow" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 2 }
    },
    body: [
      {
        // "Draw 1." — 414.3 的印刷数量，抽牌者为能力控制者（190.6.d）。
        id: "dredge-up.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
] as const satisfies readonly Ability[];

export default {
  canonicalCardId:
    "card.hash-ee8db3ab5ed40e3950cf84297f9cb4b2438324dd0f733d2bd1a1332f6c24124c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Flow 的替代费用与延迟放逐没有可执行路径（effects/keywords/Flow.ts 文件头自述的依赖仍未合入）：" +
    "(1) flow.cost 需要费用管线（RIFT-261）暴露可选择的替代费用、保留 null 印刷费用，并记录实际支付的是哪一个独立 " +
    "Flow 实例（829.1.c.1 的 alternate cost、829.1.c.3 的多实例）；(2) 829.1.b.1 的延迟替代效果需要替代效果的注册与排序路径" +
    "（RIFT-260），且必须区分正常离链与“由该法术自身指示的离开”；(3) 从垃圾场打出的位置许可、链项已 finalize 状态与 " +
    "continuous.timing 亦未合入（RIFT-89 费用计划接线）。印刷的 Flow 费用是 2 Energy（829.1.c），但契约 3.1 的 KeywordAbility 只有 " +
    "keyword / value 字段，契约 3.8 第 3 条的 expand params.cost 未落到已合入接口，故该费用只记录在注释与 judgeReason，不写成第二条普通费用、也不放进 value。" +
    "已支持部分：「Draw 1.」由已合入的 effect.draw 真实执行（golden 覆盖），Flow 的替代费用与放逐、以及垃圾场打出许可写 test.todo。" +
    "按 README 第 2 节保持 judge-required（能写出声明不等于可执行）。",
  abilities,
  sourceText:
    "Draw 1.\n[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
