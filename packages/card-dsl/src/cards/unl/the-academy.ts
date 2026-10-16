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
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required. The hold
 * trigger and the keyword grant are each expressible, but the card cannot
 * execute as printed:
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
 *    neither, and no merged instruction installs a cost-modifying continuous
 *    effect (cost.modify is not a merged primitive; RIFT-89 owns cost.*);
 * 3. but nothing grants it: no merged `continuous.grant-keyword`
 *    instruction exists and no merged path turns a CardProgram's ability into a
 *    ContinuousEffectSpec for layers/ (registerContinuousEffect has no caller),
 *    so even a fully bound grant would never be installed. Repeat's own
 *    expansion (effects/keywords/Repeat.ts) documents that its additional-cost
 *    payment is not yet wired into Finalize (cost.additional / cost.pay);
 * 4. no merged subscriber registers a CardProgram's triggered ability as a
 *    TriggerRegistration and nothing emits `hold` for the scoring flow, so the
 *    trigger cannot enter the chain (190.6 controller resolution included).
 * Dependencies: a one-shot "next spell this turn" window and a base-cost read,
 * plus RIFT-89 (cost plan / additional-cost wiring) and RIFT-91
 * (layers-continuous) with RIFT-33 / contract §7.2 batch 5 trigger
 * registration. Nothing is approximated; the golden test asserts the declared
 * grant shape and the merged Repeat definition it refers to, and records the
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
    "而合并 IR 只能读链接值与对象特征，读不到「尚未打出的法术的基础费用」，也没有已合入指令把费用改写安装成持续效果" +
    "（cost.modify 不是已合入原语；RIFT-89 负责 cost.*）。" +
    "(3) 即使绑定完成也无人授予：[Repeat] 属关键词，卡牌 README §5 要求只声明、不要手写展开；" +
    "effects/instructions/ 没有 continuous.grant-keyword 原语，也没有已合入路径把 CardProgram 的能力注册成 layers 的 ContinuousEffectSpec" +
    "（registerContinuousEffect 无调用方），且 Repeat 自身的 KeywordDef 文档说明其附加费用尚未接入 Finalize（cost.additional / cost.pay 待办）。" +
    "(4) hold 时点（CR 383.4.d、471.2、473.2.b）没有已合入生产者把它 emit 进唯一事件管线，也没有订阅方把 CardProgram 的 triggered ability " +
    "注册成 TriggerRegistration（190.6 控制者解析包含在内）。" +
    "依赖：一次性 next-spell 窗口与基础费用读取、RIFT-89（费用计划/附加费用接线）、RIFT-91（layers-continuous）、RIFT-33（契约 §7.2 批 5）。",
  sourceText:
    "When you hold here, give your next spell this turn [Repeat] equal to its base cost. " +
    "(You may pay the additional cost to repeat the spell's effect.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "you hold here": the hold happens at this Battlefield and is
        // performed by its controller (053.3, 190.6.d). Sibling battlefield
        // programs keep this placeholder spelling while the trigger pipeline
        // is unmerged.
        filter: { event: "hold", here: true, player: "controller" }
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
