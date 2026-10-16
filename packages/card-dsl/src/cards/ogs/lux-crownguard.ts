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
 *    表示；survey（docs/plans/survey/unclassified-ogn.md 第 42 条）结论指出"池中受限
 *    份额必须独立记账，不能给所有能量套全局限制或忽略限制"，并指向尚未合入的
 *    continuous.restrict。
 * 2. 启动费用的 Finalize 收费（cost.activated / cost.exhaust）尚未合入：
 *    sfd/assembly-rig.ts 的同类费用也是 data-only，其 TODO 同样标注费用支付依赖
 *    RIFT-89~91。
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
    "支付法术费用（survey unclassified-ogn.md 第 42 条结论：受限份额必须独立记账，不能给" +
    "所有能量套全局限制或忽略限制），effect.resources 只并入同一余额，continuous.restrict " +
    "未合入；另缺 cost.activated / cost.exhaust 的 Finalize 收费（横置自身费用），" +
    "sfd/assembly-rig.ts 的同类费用同为 data-only 并标注依赖 RIFT-89~91。" +
    "依赖：RIFT-91（layers-continuous / continuous.restrict）、RIFT-89（cost 批次）。" +
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
