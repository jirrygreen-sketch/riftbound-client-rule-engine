import type { CardProgram } from "../../ir/index.js";

/**
 * Crowd Favorite (unl-102-219) — Unit, Body, Noxus; energy 3, Might 3.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-102-219, verbatim):
 *   [Hunt] (When I conquer or hold, gain 1 XP.)
 *   Spend 2 XP: [Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 823.1 / 823.1.b / 823.1.c.1: Hunt is a Triggered Ability keyword, both a
 *   Conquer and a Hold effect, functionally short for "When I Conquer or Hold,
 *   my controller gains X XP". 823.1.c.2: the omitted X is presumed 1, so the
 *   declaration carries no `value` (README §5: omit value when none printed).
 *   The whole clause is the keyword definition, so this file only names it.
 * - 145.1 / 145.2: "Spend 2 XP: [Buff] me." is an Activated Ability — costs
 *   before the ":", effect after it; units' activated abilities are performed on
 *   their controller's Main Phase, and no [Reaction] is printed, so the timing is
 *   "action".
 * - 728 / 730.2: spending XP is a cost; the frozen CostSpec supports it as the
 *   nonstandard payment kind "xp" (cost/plan-values.ts readCost, cost/payment.ts
 *   prepareCostPayment -> { type: "spend-xp" }).
 * - 427.1 / 702.2.a / 702.3: "[Buff] me" places one Buff counter on this unit.
 *   "[Buff]" is not a keyword of the 804–833 glossary (Buffs are counters, rule
 *   702), so it is modelled with the merged effect.buff primitive instead of a
 *   keyword declaration. 702.3.a: a unit that already has a Buff is not buffed
 *   again — effect.buff reports that no-op itself.
 * - 053.1 / 053.2 and the contract 3.6 anchor: "me" is the ability host, spelled
 *   { object: "self" } in the target filter (sett-brawler spelling), never a
 *   runtime ObjectRef.
 *
 * Status: judge-required (re-reviewed for RIFT-329). The Hunt half still cannot
 * execute end to end, but the missing piece is no longer the KeywordDef:
 * effects/keywords/Hunt.ts is merged (823.1.c.1 expansion into a conquer and a
 * hold trigger with effect.xp, 823.1.c.2 default 1, 823.2 summing) and
 * programs/keywords.ts expands it. Registration still fails: the expansion
 * spells its trigger event "conquer"/"hold", while the closed EventPattern
 * vocabulary (events/trigger-spec.ts EVENT_PATTERN_TYPES, enforced by
 * assertTriggerSpec in EventPipeline.registerTrigger) only accepts
 * "conquered"/"held"/"scored"; registerProgramTriggers therefore throws before
 * any subscription exists. Even with the accepted spelling, the scoring wave
 * (turn/flow.ts:102) carries only the scoring player and
 * `details.battlefieldId`, so the expansion's `{ source: "self" }` object filter
 * has no object to bind and the here/“I conquered” attribution is missing.
 * The activated half (2 XP -> effect.buff) uses only merged cost/payment and
 * effect.buff code and is executed for real by the golden test.
 */
export default {
  canonicalCardId: "card.hash-204eccc6166c5de77fb944367f972c5488c896a4054343aae4b3c15ca9b01b0f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Hunt] 的展开已合入（effects/keywords/Hunt.ts：823.1.c.1 的 conquer/hold 两个 effect.xp 触发，823.1.c.2 省略值按 1、823.2 相加，RIFT-265），" +
    "programs/keywords.ts 也会展开声明；但注册这步就走不通：展开体写的事件名是 \"conquer\"/\"hold\"，" +
    "而封闭 EventPattern 词汇（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES，EventPipeline.registerTrigger 经 assertTriggerSpec 强制）只接受 \"conquered\"/\"held\"/\"scored\"，" +
    "registerProgramTriggers 会在订阅建立前抛错。即便换成合法拼写，计分波（turn/flow.ts:102）也只带计分玩家与 details.battlefieldId，" +
    "展开体的 { source: \"self\" } 对象过滤器没有可绑定的对象，190.6 的「我征服」归属仍然缺失。" +
    "启动能力一半（Spend 2 XP → [Buff] me）只用已合入的费用管线（xp 付费种类，728/730.2）与 effect.buff（427.1/702.2.a/702.3），" +
    "golden 用真实费用计划与解释器执行。依赖：Hunt 展开的事件拼写与 EventPattern/计分载荷的来源单位绑定（RIFT-265 后续 + RIFT-257 后续，823.1.c.1）。",
  abilities: [
    { kind: "keyword", keyword: "hunt" },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [{ kind: "xp", amount: { kind: "constant", value: 2 } }]
      },
      timing: "action",
      body: [
        {
          id: "crowd-favorite.buff-self",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "crowd-favorite.self" }
          },
          targets: [
            {
              id: "crowd-favorite.self",
              filter: { object: "self", type: "unit" },
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
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "Spend 2 XP: [Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)"
} satisfies CardProgram;
