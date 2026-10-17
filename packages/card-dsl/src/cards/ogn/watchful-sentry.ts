import type { CardProgram } from "../../ir/index.js";

/**
 * Watchful Sentry (ogn-096-298) — Unit, 2 energy, 1 Might, Mind, Freljord.
 *
 * Printed text: "[Deathknell] — Draw 1. (When I die, get the effect.)"
 *
 * Structure (contract 3.7): the keyword ability declares [Deathknell]; the
 * printed [Effect] ("Draw 1.") is hosted by an explicit triggered ability on
 * the object-killed timing point, which is exactly what Deathknell is
 * functionally short for (808.1.c, 808.1.d: the trigger is the permanent being
 * killed and sent to the Trash). 808.1.d.2/.d.3 (trigger to the chain before
 * the zone change, last-known information recorded first) belong to the chain
 * and event pipeline.
 *
 * Status: judge-required. Deathknell's keyword expansion still references the
 * `trigger.leave` opcode, whose execution and last-known-information handling
 * are not implemented in the instruction/runtime path. The explicit Draw 1
 * trigger body uses the merged effect.draw primitive and is executed by the
 * golden test; no approximate Deathknell expansion is written here.
 */
export default {
  canonicalCardId: "card.hash-101c2b7846a23a872f4b23e49a531cd63f2f748e72c5e2c986d4967bcd8d19e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Deathknell]（808）的展开不可执行：effects/keywords/Deathknell.ts 的触发体只引用 trigger.leave，而该 op 的" +
    "执行与 last-known-information 处理尚未接入运行时；" +
    "808.1.d.1（死亡被替代则移出链）/808.1.d.2/.d.3（进链前记录 last-known）同样依赖该触发管线。" +
    "依赖：trigger.leave 原语及其死亡替代与 last-known-information 处理。Draw 1 本体只用已合入的 effect.draw。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      trigger: { at: "object-killed", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "watchful-sentry.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "[Deathknell] — Draw 1. (When I die, get the effect.)"
} satisfies CardProgram;
