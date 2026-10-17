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
 * 1. their self-scoped filter uses the nested `filter: { source: "self" }`
 *    spelling the merged matcher does not evaluate: events/pipeline-match.ts
 *    reads only the top-level object/source/target/player pattern keys and
 *    the engine's assertTriggerSpec rejects the nested key (unknown-field),
 *    so "When I'm played" / "when I conquer" could not be scoped to this
 *    card (RIFT-21 payload-filter binding);
 * 2. no merged subscriber turns a CardProgram's triggered ability into a live
 *    TriggerRegistration (card-program binding RIFT-257).
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
    "触发半段仍不可执行：两条 buff 触发的 self 过滤沿用嵌套写法 filter: { source: \"self\" }，" +
    "assertTriggerSpec 以 unknown-field 拒绝该键、events/pipeline-match.ts 也只读顶层 object/source/target/player，" +
    "匹配器会忽略它，因此「When I'm played / when I conquer」无法只对本牌触发（RIFT-21 payload 过滤接线）；" +
    "卡牌 triggered ability 注册成实时触发同样依赖 RIFT-257（card-program 绑定）。" +
    "+4 Might 半段本轮已改为可执行形状（continuous.might + appliesTo self，RIFT-258）并有真实执行测试" +
    "（arithmetic 层注册、回合末到期、spend-buff 费用与 effect.buff 触发体均已执行）；" +
    "CR 703 的「Buff 提供 +1 Might」派生不在已合入图层引擎（layers/engine.ts 只增减 buffs 计数），保持引擎侧缺口。" +
    "整卡在触发绑定前保持 judge-required，不近似实现。",
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
