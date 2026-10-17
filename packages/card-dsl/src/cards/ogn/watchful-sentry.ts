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
 * Status: judge-required. effects/keywords/Deathknell.ts exists but its
 * expansion body only references the `trigger.leave` opcode, which has no
 * merged InstructionDef (verified: effects/instructions/registry.generated.ts
 * contains no trigger.* entry), so the keyword expansion is not executable; no
 * merged layer registers a CardProgram's keyword/triggered abilities into the
 * pipeline either (RIFT-257; events/pipeline.registerTrigger is only called by
 * trusted kernel adapters). The Draw 1 body itself uses the merged effect.draw
 * primitive and is executed by the golden test. No approximate expansion is
 * written here.
 */
export default {
  canonicalCardId: "card.hash-101c2b7846a23a872f4b23e49a531cd63f2f748e72c5e2c986d4967bcd8d19e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Deathknell]（808）的展开不可执行：effects/keywords/Deathknell.ts 的触发体只引用 trigger.leave，而该 op 没有已合入的 " +
    "InstructionDef（实测 effects/instructions/registry.generated.ts 无 trigger.* 条目），且没有已合入的图层把卡牌程序的" +
    "关键字/触发能力注册进 EventPipeline（RIFT-257；registerTrigger 目前只被可信内核适配器调用）；" +
    "808.1.d.1（死亡被替代则移出链）/808.1.d.2/.d.3（进链前记录 last-known）同样依赖该触发管线。" +
    "依赖：trigger.leave 原语与 RIFT-257 卡牌程序绑定。Draw 1 本体只用已合入的 effect.draw。不近似实现。",
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
