import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sandshifter (sfd-158-221) — Unit, 5 energy + 2 Order power, Might 6, tag Shurima.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-158-221):
 *   When you play me, kill an enemy unit with 3 :rb_might: or less.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is a Play Effect (383.4.a, 383.4.a.1): the card-played
 *   timing point filtered to this card.
 * - "kill an enemy unit with 3 :rb_might: or less" names one specific game
 *   object in a public zone, so it is a Target (355.7, 355.9.a, 355.10.a);
 *   355.9.b gives "a unit with Might 4 or greater" as its own example of a
 *   Might-threshold targeting restriction, and 2047 notes that a unit with 3
 *   or less Might stops being a legal target when it stops being a unit. The
 *   ceiling is re-checked at Finalize and Resolve (359.3.e.2).
 * - effect.kill submits the merged kill action (429.1) and the engine owns
 *   kill attribution (429.5) and the object-killed timing point.
 *
 * Status: judge-required — the target's Might ceiling still has no safe
 * Finalize/Resolve target-query representation, and nothing is approximated.
 * Current source review (2026-10-17, after RIFT-359 merged):
 * - RIFT-359 added event/result predicates only (played-from-zone,
 *   event-printed-characteristic, result); it did not add an effective-Might
 *   threshold to ObjectFilter. The supported matcher fields are object/card
 *   identity, type, zone, location, controller/owner, states, tags, and
 *   equality-only characteristics, so `characteristics: { might: 3 }` still
 *   matches exactly 3 rather than "3 or less".
 * - `mightLte` is still not a supported ObjectFilter field: the production
 *   translator rejects it, while the low-level matchers do not consume unknown
 *   keys. Dropping the field would make every enemy unit a legal target, and
 *   moving the check to an instruction condition would happen only after the
 *   target was already finalized, so neither form implements the printed
 *   target restriction (355.9.b / 143.2.a).
 * Dependencies: a still-unmerged effective-Might threshold predicate wired into
 * ObjectFilter/TargetPlan at Finalize and Resolve. The `effect.kill` body
 * (429.1) is already merged and remains covered by the locked-target goldens.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "sandshifter.kill-weak-enemy",
        op: "effect.kill",
        args: {
          target: { kind: "constant", value: "sandshifter.weak-enemy-unit" }
        },
        targets: [
          {
            id: "sandshifter.weak-enemy-unit",
            // Descriptive ceiling only: 355.9.b / 143.2.a. TargetPlan has no
            // effective-Might threshold predicate yet (see judgeReason).
            filter: { type: "unit", zone: "board", controller: "opponent", mightLte: 3 },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-6c5e86a11835553c21b709846a47353de46fcea93be21041ecaf6f4a50b1ecd7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍缺「有效 Might 上限」目标过滤（355.9.b、143.2.a）：TargetPlan 在 Finalize/Resolve 只消费已支持的 ObjectFilter 字段，" +
    "characteristics 仅等值匹配（{ might: 3 } 只命中恰好 3）；RIFT-359 已合入的是事件/回执谓词（played-from-zone、" +
    "event-printed-characteristic、result），并没有给 ObjectFilter 增加 Might 阈值，故该谓词仍是活缺口。" +
    "mightLte 不是支持字段：programs/filters.ts 会拒绝它，底层匹配器又不会消费未知键；删掉该键会让所有敌方单位都成为合法目标，" +
    "把 lte 改成 instruction condition 也只能在目标已 Finalize 后检查，不能实现 355.9.b 的目标限制。" +
    "effect.kill 本体（429.1/429.6）已合入，golden 用锁定目标真实执行 kill；整卡因目标查询阈值保持 judge-required，不近似实现。" +
    "依赖：仍未合入的「有效 Might 阈值谓词接入 ObjectFilter/TargetPlan」。",
  abilities,
  sourceText: "When you play me, kill an enemy unit with 3 :rb_might: or less."
} satisfies CardProgram;

export default program;
