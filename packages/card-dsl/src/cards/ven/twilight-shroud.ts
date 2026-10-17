import type { CardProgram } from "../../ir/index.js";

/**
 * Twilight Shroud（ven-031-166）— Spell，1 能量、无印刷力量，领域 Calm，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-031-166，逐字）：
 *   "Give a friendly unit +1 :rb_might: this turn. It can't be chosen by enemy spells and abilities this turn.\n[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 「Give a friendly unit +1 Might this turn」是带 end-of-turn 期限的临时 Might 修改
 *   （317.2.c 于回合结束清理时到期；143.2.a 规定 “Might” 指当前有效 Might），属 layers 的
 *   arithmetic 层持续效果（契约 3.4/3.6 的 continuous.might）；不是 Buff 计数
 *   （702/703：Buff 是 counter，与 Might 值修正不是一回事），effect.buff 文件头亦如此声明。
 *   「a friendly unit」由玩家在 Finalize 选择（355.5.a 的同类示例），是目标（355.7/355.9.b：
 *   “friendly” 是该单位的控制者限制）。
 * - 「It can't be chosen by enemy spells and abilities this turn」是 355.9.b 明文列举的目标
 *   限制（规则原文的第二个例子正是这句话：这类单位即使满足其它限制，也不是敌方法术/能力的
 *   合法目标）；它是持续期限为 “this turn” 的目标合法性限制（054.1 的“禁止优于许可”），
 *   由持续限制/目标系统消费，不是一条独立结算指令。
 * - 「[Flow] :rb_energy_2:」同 Brittle Steel 的判定：829.1.b 的功能文本、829.1.b.1 的延迟
 *   放逐替代、829.1.c.1 的替代费用；印刷 Flow 费用为 2 能量（无 Power）。
 *
 * status = judge-required（整卡仍有两处缺口，均不近似实现）：
 * - continuous.might 与 continuous.restrict 已合入，目标选择通过同一个 TargetSpec 绑定；
 *   golden 直接执行并验证 arithmetic/ability 图层登记。限制查询已能读取 continuous.restrict，
 *   但“敌方法术/能力”这一更细的动作与施法者关系仍由后续目标消费方解释。
 * - 印刷 Flow 费用送不进展开（契约 3.8.3 的 params.cost 未落地），Flow 的替代费用与放逐消费链仍未闭合。
 * 依赖：Flow 的 params.cost/替代费用消费链；目标限制的 enemy spell/ability 消费语义。
 */
export default {
  canonicalCardId: "card.hash-e54ee1b49e982f2d0d89cb2a1ada3688523cfee6c53db33c9aa872c7802ea0df",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「It can't be chosen by enemy spells and abilities this turn」（355.9.b）虽然已用" +
    "continuous.restrict 登记并可由 layers/rules/query.ts 读取，但目标消费方仍需把 restriction 与敌方法术/能力的施法者关系接入；" +
    "(2) 印刷 Flow 费用（829.1.c：2 能量）送不进展开——契约 3.8.3 的 params.cost 未落地，Flow 的替代费用与放逐消费链仍未闭合。" +
    "continuous.might、目标选择和 end-of-turn 图层登记均已合入并有 golden 执行证据；不近似实现。",
  abilities: [
    // 829.1.a：Flow 在法术上；卡只声明关键词（展开见 judgeReason 第 3 条）。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      // 印刷基础费用：1 能量；catalog power 为 null（无印刷力量），不改写为 0。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Give a friendly unit +1 Might this turn」：待接线的临时 Might 修改（见 judgeReason 第 1 条）。
          id: "twilight-shroud.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "twilight-shroud.friendly-unit" }
            }
          },
          targets: [
            {
              id: "twilight-shroud.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「It can't be chosen by enemy spells and abilities this turn」：对同一单位的持续目标限制
          // （355.9.b），用同一 TargetSpec 表达 “it”（359.3.e.14）；当前缺口在限制消费语义。
          id: "twilight-shroud.cannot-be-chosen",
          op: "continuous.restrict",
          linkedTo: "twilight-shroud.grant-might",
          args: {
            restriction: { kind: "constant", value: "cannot-be-chosen-by-enemy-spells-and-abilities" },
            action: { kind: "constant", value: "target" },
            target: { kind: "constant", value: "twilight-shroud.friendly-unit" },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "twilight-shroud.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Give a friendly unit +1 :rb_might: this turn. It can't be chosen by enemy spells and abilities this turn.\n" +
    "[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
