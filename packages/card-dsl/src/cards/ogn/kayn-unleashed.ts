import type { CardProgram } from "../../ir/index.js";

/**
 * Kayn, Unleashed (ogn-189-298) — Unit, Chaos (Kayn / Ionia / Champion).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-189-298):
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   If I have moved twice this turn, I don't take damage.
 *
 * Modeling (CR v1.5):
 * - [Ganking] is declared as a keyword ability (810). Its merged expansion is
 *   a static continuous.movement permission (battlefield-to-battlefield
 *   Standard Move) that the movement system does not consume yet, so the
 *   keyword's runtime effect is not executable.
 * - "If I have moved twice this turn" needs a condition over this object's
 *   Move events in the current turn. Condition IR has no history form
 *   (always/never/compare/all/any/not/expression only) and its `count`
 *   expression is a set query over current objects (ctx.query), not an event
 *   history; ResolveContext.history exists but is reachable only from
 *   instructions, not from a replacement ability's condition. The compare /
 *   count shape below records the intended predicate and is explicitly not
 *   executable.
 * - "I don't take damage" is a damage-replacement/prevention effect (438.7,
 *   Prevent is a Delayed Replacement Effect); the replacement pipeline has no
 *   merged consumer that turns an empty replacement body into a prevention,
 *   so it is not approximated.
 */
export default {
  canonicalCardId: "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两块依赖未合入：(1)[Ganking] 展开的 continuous.movement 许可没有消费者（移动系统尚未接入，RIFT-83/RIFT-91）；" +
    "(2)「If I have moved twice this turn, I don't take damage」需要按本回合自身 Move 事件计数的条件与伤害" +
    " Prevent/替代消费端：Condition IR 只有 always/never/compare/all/any/not/expression，count 表达式是当前对象的" +
    "集合查询而非事件历史，ResolveContext.history 也无法从替代能力的 condition 触达（CR 438.7）。" +
    "依赖：RIFT-83（kw-ganking-vision）、RIFT-91（layers-continuous）、RIFT-90（事件/目标适配）；不近似实现。",
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
