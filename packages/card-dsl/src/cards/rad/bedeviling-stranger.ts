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
 * 1. "If there are 4 or more units there" 需要在已选战场绑定后做位置限定的计数，
 *    当前条件/计数路径不能读取 LocationTargetSpec 绑定；把条件写成任意战场会改变卡牌语义。
 * 2. 「there」需要把敌方单位的目标位置绑定到已选战场；TargetSpec.location 只接受具体
 *    LocationFilter，sameLocationAs 只接受对象选择器，当前合同没有可执行的地点绑定写法。
 * 3. Hidden 的 cost.hidden 展开（KeywordDef 已合入）没有消费方：Hide 动作、
 *    facedown 区域与「下回合以 [Reaction] 从 facedown 打出」都未接入
 *    （time-point-producers.md 记 card-hidden 待后续）。
 * 下面保留有依据的部分：先用 condition.value 消费 LocationTargetSpec 并绑定所选战场，
 * 再由 choice.optional 包住 effect.zone（把该战场上的敌方单位移回其拥有者手牌）。
 * 「there」的收窄仍不能在目标合同中绑定到 LocationTargetSpec：TargetSpec.location
 * 只接受具体 LocationFilter，sameLocationAs 又只接受对象选择器，因此这里只保留
 * 「战场上的敌方单位」这一可验证部分。读取该绑定的 ≥4 计数门控与 Hidden 的完整
 * 生命周期也仍未合入，由 golden 测试与 judgeReason 显式记录。
 */
export default {
  canonicalCardId: "card.hash-4122e96a3266bd012c251c2b82b1406e2deb7ff40f367359244639e4e4538ae4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 「If there are 4 or more units there」的前置门控需要在已选战场绑定后读取该地点的计数，" +
    "当前条件/计数路径不能消费 LocationTargetSpec 绑定；(2) enemy target 的「there」需要把 TargetSpec.location 绑定到所选战场，" +
    "但 validation 只接受具体 LocationFilter，sameLocationAs 只接受对象选择器，不能退化成任意战场；(3) Hidden 的 cost.hidden 展开（KeywordDef 已合入）" +
    "没有消费方：Hide 动作、facedown 区域与「下回合以 [Reaction] 且忽略基础费用打出」均未接入；" +
    "已按已合入原语写出的部分：condition.value 绑定「choose a battlefield」，choice.optional 包住 effect.zone（把敌方单位移回其拥有者手牌），" +
    "目标过滤保留「战场上的敌方单位」这一可执行子集，并有地点绑定与返回手牌的执行证据；上述三项运行期缺口仍是 judged 部分。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          // 355.5：the battlefield is chosen before the optional return. A
          // condition.value is the merged location-binding bridge used by
          // other cards; it has no printed condition of its own.
          id: "bedeviling-stranger.choose-battlefield",
          op: "condition.value",
          locations: [
            {
              id: "bedeviling-stranger.chosen-battlefield",
              type: "battlefield",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            value: {
              kind: "location",
              value: { kind: "target-location", target: "bedeviling-stranger.chosen-battlefield" }
            },
            key: { kind: "constant", value: "chosen-battlefield" }
          }
        },
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
                      // 「there」的所选战场锚点尚不能由 TargetSpec 合同消费；
                      // 这里只保留「战场上的敌方单位」这一可验证子集。
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
