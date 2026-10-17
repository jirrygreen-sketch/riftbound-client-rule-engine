import type { CardProgram } from "../../ir/index.js";

/**
 * Lux, Crownguard (ogs-014-024) — Unit, 4 energy / no printed power (Order),
 * Might 2. 印刷 power 为 null 表示没有印刷值，不是 0。
 *
 * sourceText (deck-catalog.json, ogs-014-024, verbatim):
 *   ":rb_exhaust:: [Reaction] — [Add] :rb_energy_2:. Use only to play spells.
 *   (Abilities that add resources can't be reacted to.)"
 *
 * 规则依据（CR v1.5）：
 * - 813.1.d：启动能力上的 Reaction 写作 "[Reaction][>]"；本卡印刷为
 *   ":rb_exhaust:: [Reaction] — [Add] :rb_energy_2:."，即该启动能力带 Reaction
 *   时机许可（813.1.c：对启动能力而言可在任意玩家回合的 Closed State 启动）。
 * - 430.1/430.2/430.2.a/430.3：Add 把资源加入符文池；带 Reaction 的 Add 启动能力
 *   可在需要付费时启动，Finalize 完成后立即结算、不传递优先权/Focus（这正是提醒
 *   文字"Abilities that add resources can't be reacted to."的含义）。
 * - :rb_exhaust: 是启动费用（横置自身，cost.exhaust）。
 * - "Use only to play spells" 是 054.2 的"only"使用限制：所产出的 2 点能量只能用于
 *   支付打出法术的费用；池中受限份额必须可追踪。
 * - 163.1/166.1：能量无域，加入并存放于控制者的符文池。
 *
 * 状态：judge-required。
 * 1. 缺受限资源记账：effect.resources 将能量并入符文池同一余额，没有"受限份额"
 *    表示；continuous.restrict 原语虽已合入（RIFT-259），但其 modes 只有
 *    prohibit/require/permit/limit/applied-cost，不提供"加入的资源份额只能用于
 *    支付法术费用"的记账通道，也没有读取该受限份额的费用消费方；survey
 *    （docs/plans/survey/unclassified-ogn.md 第 42 条）结论指出"池中受限
 *    份额必须独立记账，不能给所有能量套全局限制或忽略限制"。
 * 2. 启动费用的 Finalize 收费仍未接线：cost-plan 的 payment 只识别
 *    kind: "activated"/"explicit"，不含 "cost.activated" 拼写，activated 能力
 *    的 Finalize 也仍由 RIFT-257 的程序绑定负责（RIFT-261 的 cost.pay 原语未合入）。
 * 3. 数据问题（不改数据，见回复）：ogs-014-024 仍有 Demacia 标签，且写 "Use only to
 *    play spells"，同 canonicalCardId 的 ven-sp6-006 写 "Spend this Energy only to play
 *    spells"（docs/plans/survey/data-issues-recheck.md 第 31 行）。
 */
export default {
  canonicalCardId: "card.hash-6f9f9006a5d35f01fe282aeeb87157def728c3d5ae72e9d0eb39f4f0e496b14e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺受限资源记账：Use only to play spells（054.2）要求池中这 2 点能量可追踪为只能用于" +
    "支付法术费用（survey unclassified-ogn.md 第 42 条结论）。continuous.restrict 原语已合入" +
    "（RIFT-259），但其模式（prohibit/require/permit/limit/applied-cost）没有" +
    "「新增资源的受限份额」通道，费用侧也不读取受限份额；effect.resources 只并入同一余额。" +
    "另缺启动费用的 Finalize 收费：cost-plan 的 payment 不识别 " +
    "cost.activated 拼写（只接受 activated/explicit），activated 能力的 Finalize 绑定属 RIFT-257，" +
    "RIFT-261 的 cost.pay 原语未合入。" +
    "依赖：受限资源记账形态（RIFT-259 后续）、RIFT-261（cost.pay）、RIFT-257（程序绑定）。" +
    "数据问题：OGS 写 Use only to play spells，同 canonical 的 VEN 写 Spend this Energy only " +
    "to play spells（docs/plans/survey/data-issues-recheck.md）。不近似实现。",
  abilities: [
    {
      kind: "activated",
      cost: {
        kind: "cost.activated",
        payments: [{ kind: "exhaust" }]
      },
      timing: "reaction",
      restriction: {
        kind: "add-usage",
        value: { kind: "constant", value: "spell-energy-costs-only" }
      },
      body: [
        {
          id: "lux-crownguard.add-energy",
          op: "effect.resources",
          args: {
            energy: { kind: "constant", value: 2 },
            usage: { kind: "constant", value: "spell-energy-costs-only" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_energy_2:. Use only to play spells. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;
