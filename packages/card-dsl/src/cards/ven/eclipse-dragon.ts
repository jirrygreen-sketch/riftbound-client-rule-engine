import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Eclipse Dragon (ven-016-166) — Unit, Fury, tags Dragon / Mount Targon.
 * energy 8, power: none printed, Might 8.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-016-166，逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have
 *   me enter ready.)
 *   When I move, if you control 4 or fewer runes, draw 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - 805.1 / 805.1.a / 805.1.b / 805.1.b.1：[Accelerate] 是出现在单位上的可选附加费用
 *   关键词，费用固定为 1 Energy + 1 Power（本卡为 Fury）；805.5 规定它同时是单位的可引用
 *   特征。卡文件只声明关键词，展开归 effects/keywords/Accelerate.ts（契约 3.7、README 第 5 节）。
 * - 405.3.a：[Accelerate] 的费用只能在打出该单位的步骤中支付；805.3 说明它在场上没有功能。
 * - 383.4.e 之外的移动触发："When I move" 指本永久物成功完成 Move（449.1/449.2 用起点与
 *   终点定义），对应封闭时点 object-moved（421.1、449.1、449.2；458.1 的 Recall 不算 Move），
 *   filter 用内层 source: "self" 指称本卡。
 * - 383.2.a / 383.2.a.1："if you control 4 or fewer runes" 紧跟触发条件出现，因此属 Trigger
 *   Condition（CR 中 Sona, Harmonious / Loose Cannon 的两个反例正是这条界线的说明），
 *   写在 trigger.condition 上。
 * - 133.5.a.1 / 431.1："you control 4 or fewer runes" = 控制者符文区（zone "rune-zone"）
 *   中的 rune 数量 <= 4。
 * - 414.1 / 414.3："draw 1" 对应 effect.draw，抽牌者缺省为能力控制者（190.6.d），
 *   牌库顺序与 Burn Out（414.4）归内核。
 *
 * status = judge-required（三处依赖均不近似实现）：
 * 1. [Accelerate] 的展开文件已合入（effects/keywords/Accelerate.ts），但它的费用计划消费方
 *    （Finalize 的 optionalAdditional 接线）属 RIFT-89，尚未合入。
 * 2. object-moved 触发缺可判定载荷：events/action-adapter.ts 为 move-location 生成的事件不填
 *    toZone/toKind，events/pipeline-match.ts 也不读取卡程序里的内层 filter 锚点；同时没有已合入
 *    订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-120）。
 * 3. 没有已合入路径把「移动后位置」等载荷交给卡牌注册层（RIFT-120 后续），因此“When I move”
 *    目前只能记录结构。
 * 依赖：RIFT-89（Accelerate 费用计划接线）、RIFT-120（移动时点载荷与卡牌触发注册）。
 * 已支持部分：触发条件里的符文数量比较（133.5.a.1/431.1）与 effect.draw 本体由 golden 用
 * 真实解释器 + 参考内核执行。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "accelerate"
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } },
      // 383.2.a.1：紧跟触发条件的 "if you control 4 or fewer runes" 属触发条件。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "runes",
          filter: { type: "rune", controller: "self", zone: "rune-zone" }
        },
        operator: "lte",
        right: { kind: "constant", value: 4 }
      }
    },
    optional: false,
    body: [
      {
        id: "eclipse-dragon.draw-1",
        // 414.1/414.3：抽 1；抽牌者缺省为能力控制者（190.6.d），牌库顺序与 Burn Out 归内核。
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-1a78fcad592f4e6d0e197bc02ef40776f6c9174cfecb04adf5557fd446492ab9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1)[Accelerate] 的展开文件（effects/keywords/Accelerate.ts，805.1.b 的 1 Energy + 1 Fury Power）" +
    "已合入，但其费用计划消费方（Finalize 的 optionalAdditional 接线）属 RIFT-89，尚未合入，" +
    "所以 805.2/805.2.a 的「只在打出步骤支付」没有被收取路径；" +
    "(2) object-moved 触发缺可判定载荷——events/action-adapter.ts 为 move-location 生成的事件不填 toZone/toKind，" +
    "events/pipeline-match.ts 也不读取卡程序里的内层 filter 锚点（source: \"self\"），且没有订阅方把 CardProgram 的 " +
    "triggered ability 注册成 TriggerRegistration（RIFT-120）；" +
    "(3) 上述移动时点的载荷与卡牌注册接线未落地前，「When I move」只能记录结构，不能宣称可执行。" +
    "已支持部分：触发条件里的符文数量比较（383.2.a.1 / 133.5.a.1 / 431.1）与 effect.draw 本体（414.1/414.3）" +
    "由 golden 用真实解释器 + 参考内核执行。依赖：RIFT-89、RIFT-120。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "When I move, if you control 4 or fewer runes, draw 1."
} satisfies CardProgram;
