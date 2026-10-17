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
 * Status: judge-required. Re-checked 2026-10-17 against merged source:
 * the activated half is fully executable — the real cost plan spends exactly
 * 2 XP and effect.buff places one Buff on the host (golden verified). The Hunt
 * half still cannot subscribe: Hunt.ts expands to the timing points
 * "conquer"/"hold", while the closed EVENT_PATTERN_TYPES vocabulary used by
 * events/trigger-spec.ts is "conquered"/"held", so registerProgramTriggers
 * throws invalid-event-type through the production adapter (probed). Even with
 * the spelling fixed, turn/flow.ts emits { timingPoint, player, details } with
 * details.battlefieldId and no object, so the expansion's source:"self" filter
 * has no conquering/holding unit to match (CR 823.1.c.1).
 */
export default {
  canonicalCardId: "card.hash-204eccc6166c5de77fb944367f972c5488c896a4054343aae4b3c15ca9b01b0f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 Hunt 触发注册与计分单位归属接线（2026-10-17 复核，均不近似实现）：" +
    "(1) 事件拼写不一致（CR 823.1.c.1/823.2）：Hunt.ts 的 KeywordDef 展开为 conquer/hold，" +
    "而封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）只接受 conquered/held/scored；" +
    "实测经 createProgramBinding().registerProgramTriggers 注册时抛 TriggerSpecValidationError（invalid-event-type），订阅无法建立；" +
    "(2) 计分载荷没有单位身份（CR 823.1.c.1）：即使拼写对齐，turn/flow.ts 的计分波只发出 " +
    "{ timingPoint, player, details: { battlefieldId } }，没有 source:\"self\" 过滤器所需的征服/坚守单位对象，无法确定谁应获得 Hunt XP。" +
    "已合入并可执行：Spend 2 XP 启动能力（费用计划真实支付 XP）与 effect.buff（golden 覆盖放置与已 Buff 的跳过）。",
  abilities: [
    // 823.1.c.1 / 823.1.c.2：Hunt 是 Triggered Ability 关键词，缺省 X=1；
    // 展开与订阅接线缺口见 judgeReason（不重写关键词逻辑）。
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
