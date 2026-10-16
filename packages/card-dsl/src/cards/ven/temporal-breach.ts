import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Temporal Breach (ven-066-166) — Spell, 2 energy + 1 Power, no printed Might,
 * domain Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-066-166，逐字）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
 *   "Banish a unit, then its owner plays it to the same location, ignoring its cost."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Hidden]（811.1 / 811.1.a / 811.1.b）：被动的 Hide 许可关键词，811.1.b 规定隐藏时支付
 *   [A]（此处 :rb_rune_rainbow:，135.2.e.5.a / 163.2.b 的任意域 Power），随后可从正面朝下的
 *   区域以 [0]（此处 :rb_energy_0:）反应式打出。卡侧只声明 keyword（契约 3.7、README 第 5
 *   节），展开由 effects/keywords/Hidden.ts 负责（static cost.hidden），卡文件不重写。
 * - "Banish a unit"：428.1 的 Banish 动作（放到其拥有者的 Banishment），由已合入的
 *   effect.banish 提交；单位在 Board（公开区域）且被明确指名，因此是 Target
 *   （355.7 / 355.9.a.1 / 355.10）。"a unit" 没有友/敌限定，过滤器只写 unit。
 * - "then its owner plays it to the same location, ignoring its cost"：
 *   420.3 / 420.3.a 的游戏效果 Play（Limited Action）；"ignoring its cost" 是
 *   356.1.b.1 把基础 Energy/Power 费用置零；"its owner" 是逐对象的运行期 PlayerId
 *   选择者；"the same location" 是放逐前的位置。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. [Hidden] 的消费方未合入（effects/keywords/Hidden.ts 文件头已登记）：cost.hidden 的
 *    Hide 动作、正面朝下区域限制与 811.1.d 的免费打出（依赖 RIFT-89）、持续 timing
 *    许可（RIFT-91）都缺实现。
 * 2. "its owner plays it to the same location, ignoring its cost" 缺三块：
 *    (a) 放逐会按 428 把对象移到 Banishment，按 124 产生新对象身份，放逐前的位置无处回读，
 *        因此 "the same location" 无法重建；
 *    (b) "its owner" 是逐对象的 owner 选择者（运行期 PlayerId），已合入的 effect.play 只接受
 *        单一 player 与单一 location；
 *    (c) "ignoring its cost" 需要 356.1.b.1 的零费 FinalizedCostPlan，而 effect.play 明确要求
 *        调用方提供已 Finalize 的计划、从不推导印刷费用，cost/ 的 ignoreAllCosts 也没有卡牌
 *        程序入口（RIFT-89）。
 * 3. 已支持部分：effect.banish 的 "Banish a unit" 由 golden 用解释器 + 参考内核真实执行
 *    （含链接回执与失效引用不复活 124 的边界）；放回与 ignore-cost 写 test.todo。
 * 依赖：RIFT-89（Hidden 费用/免费打出与费用计划接线）、RIFT-90（逐对象 owner 选择者与
 * 位置捕获）、RIFT-91（持续 timing 许可）。
 */
const abilities: Ability[] = [
  // 811.1.a：印刷的被动 Hide 关键词；展开（static cost.hidden）由 keywords/Hidden.ts 负责。
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 2 },
      // 印刷 1 点 Mind Power（domains: ["Mind"]）。
      power: { kind: "constant", value: 1 }
    },
    body: [
      {
        // "Banish a unit" — 428.1 的 Banish 动作，单位按 355.7/355.9.a.1 是目标。
        // 链接键记录实际被放逐的对象，供后续 "plays it" 引用。
        id: "temporal-breach.banish",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { target: "temporal-breach.unit" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "temporal-breach.banished" }
        },
        targets: [
          {
            id: "temporal-breach.unit",
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // "then its owner plays it to the same location, ignoring its cost" ——
        // 需要放逐前位置、逐对象 owner 选择者与 356.1.b.1 的零费计划；
        // 没有已合入原语消费它（见 judgeReason 第 2 点），本文件只按契约形状保留声明。
        id: "temporal-breach.play-back",
        op: "effect.play-back",
        linkedTo: "temporal-breach.banish",
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "temporal-breach.banish",
            key: "temporal-breach.banishedObjects"
          },
          chooser: { kind: "constant", value: "owner" },
          destination: { kind: "constant", value: "same-location" },
          ignoreCost: { kind: "constant", value: true }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-e46bda69cb88452c9e7cb8c2e3a6b27055ded66d7aa1466494cfd0295ab9e7e6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三块依赖未合入，均不近似实现：(1) [Hidden]（811.1/811.1.b）的消费方缺失：cost.hidden 的 Hide 动作、" +
    "支付 [A]（:rb_rune_rainbow:，135.2.e.5.a / 163.2.b 的任意域 Power）与从正面朝下区域以 [0] 反应式打出（811.1.d）依赖 RIFT-89，" +
    "持续 timing 许可依赖 RIFT-91（effects/keywords/Hidden.ts 文件头已登记）。(2)「its owner plays it to the same location, " +
    "ignoring its cost」缺三块：放逐按 428 移到 Banishment、按 124 产生新对象身份，放逐前的位置无处回读，故「the same location」" +
    "无法重建；「its owner」是逐对象的 owner 选择者（运行期 PlayerId），已合入的 effect.play 只接受单一 player 与单一 location；" +
    "「ignoring its cost」需要 356.1.b.1 的零费 FinalizedCostPlan，而 effect.play 只接受调用方已 Finalize 的计划、从不推导印刷费用，" +
    "cost/ 的 ignoreAllCosts 也没有卡牌程序入口（RIFT-89）。(3) 已支持部分：「Banish a unit」由已合入的 effect.banish（428.1）" +
    "真实执行，golden 覆盖链接回执与失效引用不复活（124）的边界；放回与 ignore-cost 写 test.todo。" +
    "依赖：RIFT-89（Hidden 费用/免费打出与费用计划接线）、RIFT-90（逐对象 owner 选择者与位置捕获）、RIFT-91（持续 timing 许可）。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Banish a unit, then its owner plays it to the same location, ignoring its cost."
} satisfies CardProgram;
