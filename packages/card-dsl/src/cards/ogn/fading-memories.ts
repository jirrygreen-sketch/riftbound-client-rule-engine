import type { CardProgram } from "../../ir/index.js";

/**
 * Fading Memories (ogn-180-298) — Spell, 4 energy + 1 Chaos Power, Chaos.
 *
 * Printed text:
 *   Give a unit at a battlefield or a gear [Temporary]. (Kill it at the start
 *   of its controller's Beginning Phase, before scoring.)
 *
 * Structure (contract 3.1 / 3.2 / 3.9, Core Rules v1.5):
 * - The choice is between two shapes of object: "a unit at a battlefield OR a
 *   gear". The printed sentence is one choice over one object, so the program
 *   uses one TargetSpec whose filter admits both alternatives ("or"), not a
 *   mode choice (contract 3.9 reserves choice.mode for bulleted modes).
 * - "a unit at a battlefield OR a gear" is a disjunction of two shapes with
 *   different Location restrictions (355.10.b restricts only the unit
 *   alternative; Gear lives in a Base by default, 149.2). The merged
 *   ObjectFilter vocabulary is a conjunction of single field values
 *   (events/trigger-spec.ts ObjectFilter, layers/filter.ts), so the
 *   alternatives are recorded descriptively below and the gap is listed in
 *   judgeReason instead of being narrowed to one shape.
 * - The granted [Temporary] is a keyword, so per cards README section 5 the
 *   card only declares it; granting/removal, the expiry trigger and the layer
 *   consumption stay in the engine keyword file (contract 3.7).
 * - The granted keyword has no duration of its own: 816 is a static
 *   characteristic on the permanent ("whether or not a permanent has
 *   Temporary, is a characteristic", 816.3), so the declaration below carries
 *   no end-of-turn duration — the kill happens at the controller's Beginning
 *   Phase (816.1.b), not when an effect expires.
 *
 * Status: judge-required — no merged path can perform the grant:
 * - there is no merged "grant keyword to an object" primitive: the keyword
 *   registry has no Temporary definition (it is listed as unmerged in
 *   ability-templates.md kw-temporary, blocked for 2 cards), and the
 *   continuous-effect consumers for a duration-bounded keyword grant are the
 *   RIFT-91 layers work;
 * - Temporary's own rule text (816.1.b) is a triggered kill at the start of
 *   the controller's Beginning Phase, before scoring (816.1.c). The merged
 *   timing points include "beginning-start", but there is no merged primitive
 *   or keyword expansion that registers that delayed trigger, and doing it by
 *   hand in the card would re-implement the keyword (README section 5).
 * The structure below records the choice; execution stays TODO until the
 * Temporary keyword and the continuous/trigger plumbing land.
 */
const fadingMemories = {
  canonicalCardId: "card.hash-14d6255fe1976a488bb687562e989583b5f23cc0d020651042bf3573f790809b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Temporary] 关键词的可执行展开与原语：keywords/ 无 Temporary 定义（ability-templates.md kw-temporary 未实现），" +
    "没有已合入的「向对象授予带期限关键词」原语，也缺 RIFT-91 的图层/持续效果消费方；" +
    "Temporary 本体（CR 816.1.b/816.1.c：控制者 Beginning Phase 开始、计分前消灭它）需要在 beginning-start 注册延迟触发，同样无已合入路径，" +
    "卡内手写会重复关键词展开（README 第 5 节禁止）。目标选择形状已按 355.10.b 记录；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "fading-memories.grant-temporary",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Temporary" }
          },
          targets: [
            {
              id: "fading-memories.unit-or-gear",
              // 「战场上的单位 或 装备」：两个形状的析取，见 judgeReason；
              // 过滤器不能只写 location 而把 Base 上的装备排除掉。
              filter: { zone: "board", type: ["unit", "gear"] },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Give a unit at a battlefield or a gear [Temporary]. (Kill it at the start " +
    "of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default fadingMemories;
