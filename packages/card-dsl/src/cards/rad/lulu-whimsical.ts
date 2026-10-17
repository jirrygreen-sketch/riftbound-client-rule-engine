import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lulu, Whimsical — CR v1.5 383.3.a, 421.1/449.1, 143.2.a.1, 479.2.
 * Leading "you may" is a Finalize decision (optional trigger), not a choice
 * inserted into the resolving body. Another unit excludes the source.
 * The trait layer can set the might property; continuous.might registers an
 * arithmetic effect. A resolving instruction that registers a temporary
 * trait-layer base-Might effect is still needed. Trigger target translation
 * also does not accept the relative exclude anchor.
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
    "效果；layers/engine.ts applyTrait 虽支持 set-property/set-trait，却没有 continuous.base-might 指令将本卡的目标和 " +
    "this-turn 期限注册到 trait 层。另缺 programs/filters.ts 对 exclude: source 的目标锚点翻译，不能把 another unit " +
    "放宽为包含自身；触发过滤适配也需对齐：translateTriggerFilter 产生 event: object-moved，但 events/trigger-spec.ts 的 " +
    "EVENT_PATTERN_TYPES 尚未接受该值。",
  abilities,
  sourceText: "When I move, you may have another unit's base Might become 4 this turn."
} satisfies CardProgram;
