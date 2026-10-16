import type { CardProgram } from "../../ir/index.js";

/**
 * Bedeviling Stranger (rad-107-167) — Unit, 2 Energy, Might 2, Chaos.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-107-167，逐字）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *    :rb_energy_0:.)
 *    When you play me, choose a battlefield. If there are 4 or more units
 *    there, you may return an enemy unit there to its owner's hand."
 *
 * 规则依据（CR v1.5）：
 * - 811：Hidden 的 Hide 权限与「下回合起以 [Reaction] 且忽略基础费用打出」（811.1.b /
 *   811.1.d）；卡牌只声明关键字（契约 3.1 / README 第 5 节），展开归
 *   effects/keywords/Hidden.ts（static cost.hidden）。
 * - 383.4.a.1 / 383.4.a.2："When you play me" 是 Play Effect，在单位进场后进链；
 *   时点 card-played，filter 指向本卡。
 * - 355.5："choose a battlefield" 是结算前必须做出的地点选择；"return an enemy unit
 *   there" 的敌方单位是选目标（355.7；355.10.b 的例子说明 "a unit at a battlefield"
 *   的目标是单位而不是战场）。
 * - 355.10.c："choose a battlefield" 的战场仅作为目标限制/地点选择出现，本身不是目标。
 * - "you may return …" 是结算时的可选决定 → 契约 §3.9 的 choice.optional，把被选择的
 *   指令包在 body 里（不写成 choice + linkedTo）。
 * - 区域迁移经封闭 GameAction return-to-hand（契约 3.6），由 effect.zone 提交。
 *
 * status = judge-required（README 第 2 节）。三处缺口，均不近似实现：
 * 1. "choose a battlefield" 没有已合入的地点选择形式：PickSpec 的 options 是静态 Value
 *    列表，IR 里没有「当前合法战场集合」的动态地点选择器（调研 ability-templates.md 的
 *    target.location 一族未合入），因此 "there" 无法绑定到被选战场。
 * 2. "If there are 4 or more units there" 这个前置门控需要一个引用「被选战场」的计数
 *    条件；在 (1) 落地前该战场引用不存在，把条件写成任意战场会改变卡牌语义。
 * 3. Hidden 的 cost.hidden 展开没有消费方（RIFT-84）：Hide 动作、facedown 区域与
 *    「下回合以 [Reaction] 从 facedown 打出」都未接入（同 ogn/consult-the-past 声明）。
 * 下面保留有依据的部分：choice.optional 包住的 effect.zone（把战场上的敌方单位移回其拥有者手牌），
 * 目标过滤器写成「战场上的敌方单位」；「there」的收窄与 ≥4 门控是上述 judged 部分，
 * 由 golden 测试与 judgeReason 显式记录。
 */
export default {
  canonicalCardId: "card.hash-4122e96a3266bd012c251c2b82b1406e2deb7ff40f367359244639e4e4538ae4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 「choose a battlefield」缺少动态地点选择器——PickSpec.options 只能是静态 Value 列表，" +
    "IR 里没有「当前合法战场集合」的地点选择（target.location 一族未合入），所以 " +
    "「there」无法绑定到被选战场；(2) 「If there are 4 or more units there」的前置门控需要引用被选战场的计数条件，" +
    "在 (1) 落地前该引用不存在，写成任意战场会改变卡牌语义；(3) Hidden 的 cost.hidden 展开无消费方（RIFT-84）：" +
    "Hide 动作、facedown 区域与「下回合以 [Reaction] 且忽略基础费用打出」均未合入。" +
    "已按已合入原语写出的部分：choice.optional 包住 effect.zone（把敌方单位移回其拥有者手牌），" +
    "目标过滤为「战场上的敌方单位」，「there」的收窄是 judged 部分。依赖：RIFT-84（kw-deflect-hidden）、" +
    "target.location 一族与战斗场地选择。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "bedeviling-stranger.may-return",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Return an enemy unit there to its owner's hand?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "bedeviling-stranger.return-enemy",
                  op: "effect.zone",
                  args: {
                    target: {
                      kind: "constant",
                      value: "bedeviling-stranger.enemy-unit-there"
                    },
                    to: { kind: "constant", value: "hand" },
                    amount: { kind: "constant", value: 1 }
                  },
                  targets: [
                    {
                      id: "bedeviling-stranger.enemy-unit-there",
                      // 「there」= 被选战场；该收窄依赖 judged 的地点选择（见
                      // judgeReason 第 (1)(2) 点），因此这里只能写到「战场上的
                      // 敌方单位」这一层，不把任意战场当成被选战场。
                      filter: {
                        type: "unit",
                        controller: "opponent",
                        zone: "board",
                        location: { type: "battlefield" }
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, choose a battlefield. If there are 4 or more units there, you may return an enemy unit there to its owner's hand."
} satisfies CardProgram;
