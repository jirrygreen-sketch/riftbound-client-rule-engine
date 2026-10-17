import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lulu, Whimsical — CR v1.5 383.3.a, 421.1/449.1, 143.2.a.1, 479.2.
 * Leading "you may" is a Finalize decision (optional trigger), not a choice
 * inserted into the resolving body. Re-probed 2026-10-17:
 * - The trait layer can set the might property (layers/engine.ts applyTrait)
 *   and continuous.might registers an arithmetic add/set effect, but no
 *   registered instruction writes a this-turn trait-layer base-Might value:
 *   effects/instructions/registry.generated.js has no continuous.base-might
 *   (instructionDefinitionsById.has("continuous.base-might") === false), and
 *   continuous.might's schema rejects a layer argument.
 * - programs/filters.ts translateObjectFilter still throws "Unsupported filter
 *   field exclude"; RIFT-357's relative anchors live in the interpreter selector
 *   path (effects/interpreter/selectors.ts consumes exclude/sameLocationAs), but
 *   the production target translation does not pass them through.
 * - Trigger filter adaptation is still misaligned: translateTriggerFilter
 *   produces { event: "object-moved" }, while events/trigger-spec.ts
 *   EVENT_PATTERN_TYPES has no object-moved entry, so
 *   pipeline.registerTrigger throws a TriggerSpecValidationError.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: true,
    body: [
      {
        id: "lulu.set-base-might",
        op: "continuous.base-might",
        args: {
          amount: { kind: "constant", value: 4 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "lulu.another-unit" }
        },
        targets: [
          {
            id: "lulu.another-unit",
            filter: { type: "unit", zone: "board", exclude: "source" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-4417983f70fa69947305b0884a1562186a0299bf7532c22d71f44111a3d79438",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺结算时注册本回合 Trait-Altering Base Might 设值的指令（CR 143.2.a.1/479.2）：continuous.might 只建立 arithmetic " +
    "效果，effect 指令注册表没有 continuous.base-might（实测 instructionDefinitionsById.has(\"continuous.base-might\") === false），" +
    "continuous.might 的 argsSchema 也不接受 layer，layers/engine.ts applyTrait 的 set-property/set-trait 因此没有卡牌入口。" +
    "另缺 programs/filters.ts 对 exclude: source 的目标锚点翻译（实测抛 “Unsupported filter field exclude”）：" +
    "effects/interpreter/selectors.ts 的 queryObjects 已能消费该相对锚点，但生产目标翻译未转发，不能把 another unit 放宽为包含自身。" +
    "触发过滤适配也需对齐：translateTriggerFilter 产生 event: object-moved，但 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES " +
    "尚未接受该值，pipeline.registerTrigger 实测抛 TriggerSpecValidationError。",
  abilities,
  sourceText: "When I move, you may have another unit's base Might become 4 this turn."
} satisfies CardProgram;
