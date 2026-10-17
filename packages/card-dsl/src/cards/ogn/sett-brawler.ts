import type { CardProgram } from "../../ir/index.js";

/**
 * Sett, Brawler (ogn-164-298) — Unit, Body.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-164-298):
 *   When I'm played and when I conquer, buff me. (If I don't have a buff, I get
 *   a +1 :rb_might: buff.)
 *   Spend my buff: Give me +4 :rb_might: this turn.
 *
 * Modeling (CR v1.5):
 * - "When I'm played" is the Play Effect trigger (383.4.a), i.e. the
 *   card-played timing point filtered to this card; "when I conquer" is the
 *   conquer trigger (471.1 / 473.2.a). Both use the merged effect.buff
 *   primitive, whose target spec is anchored to the ability host with the
 *   ObjectSelector "self" (contract 3.6); "buff me" only places the single
 *   Buff counter of 702.2.a/702.3, nothing else.
 * - "Spend my buff: Give me +4 :rb_might: this turn." is an activated ability
 *   (381) whose cost spends one Buff (702.2.b, the "spend-buff" nonstandard
 *   cost kind of the merged cost plan). The effect is a temporary Might
 *   modification executed by the merged continuous.might primitive (RIFT-258):
 *   it registers one arithmetic-layer effect through ctx.addContinuous with
 *   the end-of-turn duration (317.1.a / 468.7.c), and "me" is the ability
 *   source, so the instruction carries `appliesTo: "self"` instead of a
 *   target choice (the ability makes no choice; 355.7). The +4 grant is never
 *   approximated with Buff counters: CR 703 gives a Buff its own +1 Might,
 *   and that derivation is a layers-engine obligation, not an effect the
 *   card's data may encode.
 *
 * Status: judge-required — the two buff triggers cannot run as printed:
 * 1. programs/filters.ts translateTriggerFilter converts the nested
 *    `filter: { source: "self" }` spelling into the top-level
 *    `pattern.object` binding, so the merged matcher and assertTriggerSpec
 *    now accept it (the previously cited RIFT-21/RIFT-257 gaps are merged);
 * 2. the remaining gap is the trigger body: registerProgramTriggers runs
 *    translateInstructionTargets, and translateObjectFilter rejects the
 *    TargetSpec `filter: { object: "self" }` spelling with
 *    "Unsupported filter field object", so the buff bodies cannot be
 *    registered for "When I'm played" / "when I conquer".
 * The activated +4 Might half, the spend-buff cost and the buff-trigger bodies
 * all execute on merged paths and are covered by real execution tests; the
 * 703 Buff -> +1 Might derivation stays an engine-side gap (layers/engine.ts
 * only moves the Buff counter).
 */
export default {
  canonicalCardId: "card.hash-7f8a999072e7b65566be686c006f6ade129a206d08922b9e25ebe2d9167d26ae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发半段仍不可执行：触发过滤的嵌套写法 filter: { source: \"self\" } 已由已合入的 programs/filters.ts " +
    "translateTriggerFilter 转换为顶层 pattern.object 绑定，不再被 assertTriggerSpec 拒绝（旧理由中引用的 " +
    "RIFT-21/RIFT-257 均已合入，视为过时）；当前真实缺口是触发体 TargetSpec 的 filter: { object: \"self\", type: \"unit\" } " +
    "在 registerProgramTriggers → translateInstructionTargets → translateObjectFilter 被拒绝" +
    "（Unsupported filter field object），「When I'm played / when I conquer」的触发体无法注册；" +
    "static binder 的 staticFilter 虽支持 object:\"self\"，但只作用于 static 能力，不作用于触发体目标；" +
    "effect.buff 的 target 也只接受 TargetSpec id，无宿主选择器形态（契约变更请求）。" +
    "+4 Might 半段（continuous.might + appliesTo self，RIFT-258）、spend-buff 费用与 effect.buff 触发体本体均有真实执行测试；" +
    "CR 703 的「Buff 提供 +1 Might」派生不在已合入图层引擎（layers/engine.ts 只增减 buffs 计数），保持引擎侧缺口。" +
    "整卡在触发体目标绑定前保持 judge-required，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "sett.buff-on-played",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "sett.self" }
          },
          targets: [
            {
              id: "sett.self",
              filter: { object: "self", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "sett.buff-on-conquer",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "sett.self" }
          },
          targets: [
            {
              id: "sett.self",
              filter: { object: "self", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [
          {
            kind: "spend-buff",
            object: "self",
            amount: { kind: "constant", value: 1 }
          }
        ]
      },
      timing: "action",
      body: [
        {
          id: "sett.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 4 },
            duration: { kind: "constant", value: "this-turn" },
            // "me" is the ability source, not a chosen target (355.7), so the
            // primitive's appliesTo "self" resolves the modification to the
            // host snapshot; no TargetSpec is authored.
            appliesTo: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I'm played and when I conquer, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.)\n" +
    "Spend my buff: Give me +4 :rb_might: this turn."
} satisfies CardProgram;
