import type { CardProgram } from "../../ir/index.js";

/**
 * The Academy (unl-216-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-216-219, verbatim):
 *   "When you hold here, give your next spell this turn [Repeat] equal to its
 *    base cost. (You may pay the additional cost to repeat the spell's effect.)"
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here" is a Hold Effect,
 *   put on the chain at the `hold` timing point (471.2 / 473.2.b, emitted by the
 *   Scoring Step of 315.2.b) for the Battlefield's controller (190.6.a/190.6.d,
 *   053.3 for "here").
 * - 820.1 / 820.1.a / 820.1.b / 820.1.c: [Repeat] is an Optional Additional
 *   Cost keyword on Spells and Abilities; paying it executes the spell's effect
 *   an additional time. "equal to its base cost" therefore needs the printed
 *   base cost of the spell the player plays later this turn (204.1.a base cost;
 *   206 keeps printed cost the reference for effects that read a cost).
 * - 356.1 / 356.4: the granted Repeat's cost is an additional cost component of
 *   that later spell's finalize; 820.1.c.1 makes it an Additional Cost paid
 *   during the steps of playing the spell.
 * - 391.4: "the next spell you play this turn" is a Delayed Passive Ability
 *   that is active only during the printed window (391 / 391.1; the same class
 *   CR names for Ravenborn Tome) — it is not an ability of the Battlefield and
 *   not a static effect that already exists when the trigger resolves.
 * - 479.3 / 479.3.b: granting the keyword to another object is an
 *   Ability-Altering (layer 3) effect; cards only declare keywords (cards
 *   README §5) and the expansion belongs to effects/keywords/Repeat.ts.
 *
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required, re-checked
 * at this sweep. The hold trigger filter and the grant primitive are merged,
 * but the card still cannot execute as printed:
 * 1. the recipient — "your next spell this turn" — does not exist when the
 *    trigger resolves. The frozen ObjectSelector set has no "next/later played"
 *    quantifier, an ObjectFilter cannot name a future object, and a TargetSpec
 *    must lock objects that exist at Finalize (CR 355.5), so no target can be
 *    declared here; the Duration vocabulary (permanent / end-of-turn /
 *    end-of-combat / while-source-in-zone / until) has no one-shot "next spell"
 *    window either (the same one-shot gap ogn/raging-firebrand and
 *    rad/firelights-hideout record);
 * 2. "equal to its base cost" needs that later spell's printed cost read at the
 *    moment its Repeat cost is built. The merged IR can read a linked value or
 *    an object characteristic, but the base cost of a not-yet-played spell is
 *    neither; cost.modify and ignoreAllCosts are merged, while no finalized
 *    FinalizedCostPlan path yet supplies this delayed Repeat payment.
 * 3. The grant primitive and Repeat KeywordDef are merged, and
 *    expandProgram/trigger registration/lifecycle binding handle explicitly
 *    supplied CardPrograms. The instruction's frozen `appliesTo` argument only
 *    accepts the existing `self` selector, so this delayed recipient descriptor
 *    is rejected before any layer effect can be registered. The default room
 *    does not inject this program, and Repeat's optional additional payment is
 *    still not wired into Finalize.
 * 4. The hold filter retains the source Battlefield anchor as nested
 *    filter {source: "self"}; translateTriggerFilter binds it to the registered
 *    source object. The Score wave carries only player and battlefieldId,
 *    however, so no source/object snapshot or source-to-Battlefield binding is
 *    available to match CR 053.3 "here".
 * Dependencies: a one-shot "next spell this turn" window and a base-cost read,
 * finalized-cost wiring, the scoring source/Battlefield binding for
 * "here", and default-room injection of the CardProgram.
 * Nothing is approximated; the golden tests assert the declared grant shape,
 * the merged Repeat definition and the well-formed hold filter, and record the
 * missing consumers as todos.
 */
export default {
  canonicalCardId:
    "card.hash-3c0bf04f347717e5a304a3188f6fa00eb657fea304747bef8f5c004ecf3679ab",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1)「your next spell this turn」在触发结算时还不存在：冻结 ObjectSelector 只有 self/source/target/pick/linked，" +
    "ObjectFilter 没有「尚未打出/下一张」量词，TargetSpec 必须锁定 Finalize 时已存在的对象（CR 355.5），" +
    "Duration 词表（permanent / end-of-turn / end-of-combat / while-source-in-zone / until）也没有一次性 next-spell 窗口" +
    "（同 ogn/raging-firebrand、rad/firelights-hideout 的 one-shot 缺口），因此本卡不声明任何 target。" +
    "(2)「equal to its base cost」要在该法术构建 Repeat 附加费用时读取它的印刷基础费用（204.1.a、206），" +
    "而合并 IR 只能读链接值与对象特征，读不到「尚未打出的法术的基础费用」；cost.modify 与 ignoreAllCosts 虽已合入，" +
    "但没有已合入通路把卡内描述性 cost.modify 冻结成 finalized 的 FinalizedCostPlan 供 effect.play 使用。" +
    "(3) 授予原语与 Repeat KeywordDef 已合入（continuous.grant-keyword），但该指令的冻结 appliesTo 只接受现有的 self 选择器，" +
    "本卡的 delayed recipient 描述在执行时会被拒绝，不能注册未来对象的图层效果；expandProgram、" +
    "trigger registration 与 lifecycle binder 能处理显式传入的 CardProgram，apps/game-server 在显式传入 programs 时也会 attachLifecycle，" +
    "但默认房间不注入本卡程序，而且 Repeat 的附加费用仍未接入最终费用计划（cost.additional / cost.pay）。" +
    "(4) hold 时点（CR 383.4.d、471.2、473.2.b）已由 turn/flow.ts 的 Score wave 发出；卡面过滤保留了 053.3 的完整 \"here\" 语义，" +
    "用 CardProgram 允许的嵌套 filter {source: \"self\"} 把事件对象锚定到注册源。translateTriggerFilter 能把该锚点绑定为 sourceRef，" +
    "但当前 hold emission 只有 player 与 details.battlefieldId，没有 source/object snapshot 或 source-to-battlefield 绑定供事件匹配器消费；" +
    "apps/game-server 仅在显式传入 programs 时调用 attachLifecycle，默认房间不注入本卡程序。依赖：一次性 next-spell 窗口与基础费用读取、" +
    "finalized 成本计划接线、计分载荷的 source/Battlefield 绑定，以及默认房间的 CardProgram 注入。",
  sourceText:
    "When you hold here, give your next spell this turn [Repeat] equal to its base cost. " +
    "(You may pay the additional cost to repeat the spell's effect.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "you hold here": retain the source Battlefield anchor in the
        // CardProgram filter. The nested source:self selector is translated to
        // the registered source object; the scoring event still lacks the
        // source/object snapshot needed to consume that anchor (053.3).
        filter: { event: "held", filter: { source: "self" }, player: "self" }
      },
      optional: false,
      body: [
        {
          // "give your next spell this turn [Repeat] equal to its base cost":
          // a keyword grant to a future spell (479.3.b / 391.4). No TargetSpec
          // is declared — a target must exist at Finalize (355.5) and this
          // spell is played later; the constant records the printed window and
          // cost reference ("its base cost") as data, never as executable
          // semantics. See judgeReason for the missing window, base-cost read
          // and grant consumer.
          id: "the-academy.grant-repeat",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Repeat" },
            appliesTo: {
              kind: "constant",
              value: {
                window: "next-spell-you-play-this-turn",
                cost: { source: "base-cost-of-that-spell" }
              }
            },
            duration: { kind: "constant", value: "end-of-turn" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
