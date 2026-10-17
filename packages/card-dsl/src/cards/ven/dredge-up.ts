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
 *   只有 keyword / value 两个字段。KeywordDef.expand 的 params.cost 已支持，Flow.expand
 *   也会读取它，但 expandProgram 只传 value / host，没有从卡声明传递印刷费用的接线；
 *   因此印刷费用只记录在本注释与 judgeReason 里，不伪造第二条普通费用，也不写 value
 *   （Flow 的数值不是张数或点数，829.1.c）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 通用费用规划与替代绑定已合入，缺口是 Flow 专用接线：
 *    - buildCostPlan 已支持 flow 备选费用与 baseChoices，但 flow.cost 声明未接到 Finalize，
 *      印刷费用参数未传入展开，实际支付的独立 Flow 实例无回执（829.1.c.1/.c.3）；
 *    - programs/statics.ts 已接入 bindReplacement，但替代匹配器 ACTION_KINDS 不含
 *      object-leaves-chain，flow-cost-selected 仍是字符串常量，没有绑定实付实例、
 *      已 finalize 状态或 leavingInstruction（829.1.b.1）；
 *    - 从垃圾场打出的许可未接入打出流程。
 *    能写出声明不等于可执行（README 第 2 节），因此保持 judge-required。
 * 2. 已支持部分："Draw 1." 由 golden 用解释器 + 参考内核真实执行；Flow 的替代费用、
 *    垃圾场打出许可与延迟放逐写 test.todo。
 * 依赖：Flow 费用参数传递、flow.cost→Finalize、实付实例回执、垃圾场许可和离链匹配。
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
    "Flow 的通用能力已支持：KeywordDef.expand.params.cost、buildCostPlan 的 flow/baseChoices 与 " +
    "programs/statics.ts → bindReplacement 均已合入。仍缺 Flow 专用接线：" +
    "(1) 印刷 Flow 费用是 2 Energy（829.1.c），KeywordAbility 只有 keyword / value 字段，expandProgram 只传 value / host，" +
    "没有把费用传给已支持的 params.cost；flow.cost 静态声明未接入 Finalize 的备选费用输入，也没有实付实例回执" +
    "（829.1.c.1 的 alternate cost、829.1.c.3 的多实例）。费用保留在注释与 judgeReason，不写成第二条普通费用或 value。" +
    "(2) 829.1.b.1 的离链替代：匹配器 ACTION_KINDS 不含 object-leaves-chain，flow-cost-selected 仍是字符串常量，" +
    "没有绑定已 finalize、实付 Flow 实例或 leavingInstruction，不能区分正常离链与“由该法术自身指示的离开”；" +
    "(3) 从垃圾场打出的许可尚未接入打出流程。" +
    "已支持部分：「Draw 1.」由已合入的 effect.draw 真实执行（golden 覆盖），Flow 的替代费用与放逐、以及垃圾场打出许可写 test.todo。" +
    "按 README 第 2 节保持 judge-required（能写出声明不等于可执行）。",
  abilities,
  sourceText:
    "Draw 1.\n[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
