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
 * status: judge-required —— 两处依赖仍未可执行，均不近似实现：
 * 1. [Tank] 的关键词展开为 continuous.combat，但没有任何消费方：combat/ 的伤害指派
 *    不读取该声明，815.1.c 的「先给 Tank 指派致命伤害」因此无法执行。
 * 2. "I get +1 [M] for each buffed friendly unit at my battlefield" 的 static 能力已经有
 *    CardProgram → layers 的绑定入口，sameLocationAs:self 也会解析为来源地点；当前仍缺
 *    count amount 的图层求值，以及 static filter 对 buffed（至少 1 个 Buff）的谓词支持。
 * 依赖：continuous.combat 消费方与战斗伤害指派顺序，以及 layers 对动态 count、buffed
 * 谓词的求值。
 */
const settKingpin = {
  canonicalCardId: "card.hash-8e8505ab8acf50a1be41bbb00297263ad9415f1e111039591ccbaefedd5a2d00",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank] 的关键词展开已合入（effects/keywords/Tank.ts），但展开出的 continuous.combat " +
    "没有消费方：layers/engine.ts 不命中该 kind，combat/ 的伤害指派也不读取它" +
    "（base-combat-allocation.ts 注明未绑定任何指派优先级），815.1.c 的伤害分配顺序不可执行；" +
    "「I get +1 [M] for each buffed friendly unit at my battlefield」的 static 注册路径与 sameLocationAs:self 已合入，" +
    "但 layers 的 valueOf 目前不处理 count（会得到 0），static filter 也不接受 buffed 谓词（至少 1 个 Buff）。" +
    "依赖：continuous.combat 消费方/战斗指派，以及 layers 对动态 count、buffed 谓词的求值。",
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
