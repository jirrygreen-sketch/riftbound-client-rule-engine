import type { CardProgram } from "../../ir/index.js";

/**
 * Sett, Kingpin (ogn-240-298) - Unit, Order, Sett/Ionia/Champion (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-240-298):
 *   [Tank] (I must be assigned combat damage first.)
 *   I get +1 :rb_might: for each buffed friendly unit at my battlefield.
 *
 * 规则依据（CR v1.5）：
 * - 815.1 / 815.1.a / 815.1.b / 815.1.c / 815.1.c.1 / 815.1.c.2：Tank 是被动能力关键词，
 *   功能上等价于"在战斗伤害步骤，必须先给我分配致命伤害，之后才能给同一控制者没有 Tank 的单位
 *   分配"；815.2 多个 Tank 冗余；815.3 它是可读特征。
 * - 702 / 702.2.a / 703：Buff 是放在单位上的 counter，被 Buff 的单位即 "buffed friendly unit"；
 *   每个 Buff 提供 +1 Might。
 * - 359.3.f.1 / 359.3.f.2："my battlefield" 引用来源的信息，在指令执行时检查
 *   （用 ObjectSelector "self" + ObjectFilter 锚点 sameLocationAs 表达）。
 * - 706-711 / 143.2：持续 Might 修正是图层算术层（continuous.might）的职责。
 *
 * status: judge-required —— 两处依赖未合入，均不近似实现：
 * 1. [Tank] 没有 KeywordDef（effects/keywords/ 下无 Tank.ts），也没有 continuous.combat
 *    消费者把 Tank 要求接入战斗伤害分配（815.1.c）；仅声明关键词等于空声明。
 * 2. "I get +1 [M] for each buffed friendly unit at my battlefield" 需要：
 *    (a) 卡牌 static 持续效果进入 layers 的算术层；
 *    (b) 以计数（"buffed" = 至少 1 个 buff 的谓词，加上与我同地点的过滤器）动态求值 amount
 *        （layers 的 valueOf 目前不处理 count，会把结果当成 0）；
 *    (c) "at my battlefield" 的同地点锚点在图层过滤器中的支持。
 * 因此保持 judge-required。
 */
const settKingpin = {
  canonicalCardId: "card.hash-8e8505ab8acf50a1be41bbb00297263ad9415f1e111039591ccbaefedd5a2d00",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank] 无 KeywordDef（effects/keywords/ 无 Tank.ts），也没有把 815.1.c 的战斗伤害分配要求接进 combat 的 " +
    "continuous.combat 消费者；「I get +1 [M] for each buffed friendly unit at my battlefield」需要 " +
    "卡牌 static 效果进 layers 算术层、以 count 表达式求值 amount（layers 的 valueOf 目前不处理 count，会得到 0）、" +
    "以及「与我同地点 + buffed（至少 1 个 buff）」的图层过滤器谓词（现有 filters 只做等值匹配）。" +
    "以上任一缺失都会让效果变成 0 或空声明，故不标 executable。依赖：RIFT-91（layers-continuous / " +
    "continuous.might 与 count 求值）、Tank 关键词展开与战斗分配（815）。",
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "I get +1 :rb_might: for each buffed friendly unit at my battlefield.",
  abilities: [
    { kind: "keyword", keyword: "tank" },
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        // 703：每个 buff 提供 +1 Might；"for each buffed friendly unit" 是计数。
        amount: {
          kind: "count",
          subject: "buffed-friendly-units-at-my-battlefield",
          filter: {
            type: "unit",
            zone: "board",
            controller: "controller",
            // 359.3.f："my battlefield" = 与来源同一地点（锚点由解释器/图层过滤器解析）。
            sameLocationAs: "self",
            // 702.2.a：有 buff 的单位才算 buffed（该谓词见 judgeReason）。
            buffed: true
          }
        }
      }
    }
  ]
} satisfies CardProgram;

export default settKingpin;
