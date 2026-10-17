import type { CardProgram } from "../../ir/index.js";

/**
 * Kayn, Unleashed (ogn-189-298) — Unit, Chaos (Kayn / Ionia / Champion).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-189-298):
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   If I have moved twice this turn, I don't take damage.
 *
 * Modeling (CR v1.5):
 * - [Ganking] is declared as a keyword ability (810). RIFT-83 merged the
 *   KeywordDef and RIFT-258/259 merged continuous.movement, but nothing binds
 *   a card's keyword expansion into the movement system (RIFT-257) and
 *   zones/movement.ts does not read the registered permission, so the
 *   keyword's runtime effect is not executable.
 * - "If I have moved twice this turn" needs a condition over this object's
 *   Move events in the current turn. Condition IR has no history form
 *   (always/never/compare/all/any/not/expression only) and its `count`
 *   expression is a set query over current objects (ctx.query), not an event
 *   history; ResolveContext.history exists but is reachable only from
 *   instructions, not from a replacement ability's condition. A replacement
 *   condition is evaluated through evaluateCondition and the reference kernel
 *   evaluates count over the live board — the intended "twice-moved" predicate
 *   is not evaluable today (the declared compare counts objects, not events).
 * - "I don't take damage" is a damage-replacement/prevention effect (438.7,
 *   Prevent is a Delayed Replacement Effect). RIFT-260 merged the replacement
 *   binding, and a bound empty replacement body does plan to zero actions which
 *   the pipeline turns into `prevent`; what is still missing for this card is
 *   the evaluable twice-moved condition above, so the whole card is not
 *   executable. The prevention itself is not approximated.
 */
export default {
  canonicalCardId: "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两块依赖仍未可执行：(1)[Ganking]（810）的 KeywordDef（RIFT-83）与 continuous.movement（RIFT-258/259）已合入，" +
    "但没有把卡牌/关键词展开注册进移动系统的接线（RIFT-257），zones/movement.ts 也不读取该许可，810.1.b 的" +
    "战场间 Standard Move 不可执行；" +
    "(2)「If I have moved twice this turn, I don't take damage」需要按本回合自身 Move 事件计数的条件：" +
    "Condition IR 只有 always/never/compare/all/any/not/expression，count 表达式是当前对象的集合查询而非事件历史" +
    "（参考内核会对这种 compare 求值得到错误结果），ResolveContext.history 也无法从替代能力的 condition 触达。" +
    "替代管线本身（RIFT-260）已合入：绑定空 body 的计划会被 pipeline 转成 prevent；本卡缺的是可求值的 twice-moved 条件。" +
    "依赖：事件历史条件（CR 438.7 / 历史查询消费方）与 RIFT-257（Ganking 展开接线）；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "replacement",
      replaces: { event: "damage", filter: { target: "self" } },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "moves-this-turn",
          // 占位谓词：需要按本回合自身 object-moved 事件计数；见 judgeReason。
          filter: { object: "self" }
        },
        operator: "gte",
        right: { kind: "constant", value: 2 }
      },
      // Empty replacement body = the damage event is prevented (438.1/438.7).
      with: []
    }
  ],
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "If I have moved twice this turn, I don't take damage."
} satisfies CardProgram;
