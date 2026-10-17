import type { CardProgram } from "../../ir/index.js";

/**
 * Frozen Fortress (unl-212-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-212-219, verbatim):
 *   "At the start of each player's Beginning Phase, deal 1 to each unit here.
 *    (This happens before scoring.)"
 *
 * CR v1.5 anchors:
 * - 315.2 / 315.2.a.1: the Beginning Phase's Beginning Step is when "at the
 *   start of Beginning Phase game effects take place"; the closed timing point
 *   `beginning-start` (ruleRefs 315.2.a.1) is that moment, and the printed
 *   reminder "(This happens before scoring.)" is 315.2.b's Scoring Step running
 *   afterwards.
 * - 190.6.a / 190.6.b: a Battlefield's abilities are controlled by its
 *   controller; while it is uncontrolled the turn player takes responsibility
 *   for them. The text names each player rather than "you", so the ability is
 *   not gated on the Battlefield's controller (contrast 190.6.d).
 * - 418.1.c / 418.1.d: the damage is marked on each unit and the 1 point is
 *   dealt to every one of them; 418.1.e.1's "only positive damage is dealt"
 *   does not bite here because the printed amount is the constant 1.
 * - 355.10.d / 355.10.d.1: "each unit here" is programmatically selected by
 *   characteristics — the players never choose — so the set is NOT a target
 *   and must not be registered as a TargetSpec (355.9's target-lock and 754's
 *   targeting triggers would fire wrongly).
 * - 053.3: "here" is this Battlefield.
 *
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required — the
 * merged dependencies remove the old emission and registration claims; two
 * real gaps remain:
 * 1. programs/triggers.ts can shape the card filter, but the pipeline event
 *    enum is closed to action/state events (events/trigger-spec.ts
 *    EVENT_PATTERN_TYPES): it has no phase timing points, so a "{}" filter
 *    cannot be registered and "beginning-start" is rejected by
 *    TriggerSpecValidationError. Phase-owned triggers still need an engine
 *    follow-up to register against the emitted timing point.
 * 2. effect.damage still reads its victims from ctx.targets(TargetSpec.id)
 *    only, and 355.10.d forbids registering "each unit here" as a TargetSpec
 *    — the primitive call below therefore carries no TargetSpec and cannot
 *    deal the damage today (the golden test executes the same fixed-amount
 *    damage with a test-side locked set to show the printed number and the
 *    per-unit handling, exactly like ogn/anivia-primal).
 * Dependencies: (1) phase-owned trigger registration (pipeline event enum /
 * turn timing points), (2) an untargeted set-damage form over a "here" set
 * anchor (effect.damage set/query shape, engine follow-up).
 */
export default {
  canonicalCardId:
    "card.hash-09252b56d2b61d29cf38395a75ff54e4d386d4bfa33c0754a32ef693dd912c1a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "beginning-start 时点（CR 315.2.a.1）已由合并的 turn/flow.ts 为每个玩家的 Beginning Phase emit；" +
    "programs/triggers.ts 已把 CardProgram 的 triggered ability 变成 TriggerRegistration（旧理由里的发射/注册缺口已过时）。" +
    "但管线 trigger.filter 的事件枚举仍是封闭的动作/状态事件集（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES），" +
    "不含 phase 时点：写成 { event: \"beginning-start\" } 会被 translateTriggerFilter 原样保留，然后被 pipeline.registerTrigger 拒绝；" +
    "管线当前只能按事件枚举匹配 trigger.filter，空 ObjectFilter 只对所有事件放行，并不能表达「本时点」；" +
    "因此把 trigger.filter 写成 {} 虽能通过 TriggerSpec 校验，仍不是正确的 phase-owned trigger 形态。" +
    "剩余缺口之一：phase-owned trigger 的管线注册/过滤语义（事件枚举 / phase 时点，引擎后续）。" +
    "剩余缺口之二：「deal 1 to each unit here」按 355.10.d/355.10.d.1 是程序化选定的集合、不是目标，" +
    "而已合入的 effect.damage 只从 ctx.targets(TargetSpec.id) 读取受害者（没有集合/query 形态）；" +
    "把它写成 selection \"all\" 的 TargetSpec 会错误登记「成为目标」（355.9/754），属近似实现，故本卡不写 TargetSpec，" +
    "该指令当前无法造成伤害（golden 只按同 ogn/anivia-primal 的分层做法，用测试侧锁定集合执行同一固定数额伤害）。" +
    "依赖：phase-owned trigger 的管线注册；带「here」集合锚点的无目标集合伤害形态（effect.damage 的集合/query 形态，引擎后续）。",
  sourceText:
    "At the start of each player's Beginning Phase, deal 1 to each unit here. (This happens before scoring.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        // "each player's Beginning Phase": every player's, not only the
        // Battlefield controller's (190.6.b covers the uncontrolled case).
        // The turn player/phase ownership is the timing producer's job; the
        // pipeline trigger filter has no phase discriminant (judgeReason gap
        // 1), so this filter intentionally names no closed event type.
        filter: {}
      },
      optional: false,
      body: [
        {
          // "deal 1 to each unit here": fixed printed amount 1, one Deal
          // action per unit (418.1.c/418.1.d). The set is not a target
          // (355.10.d), so there is NO TargetSpec: the primitive has no set
          // form yet and the value below is a documented placeholder for the
          // missing anchor (see judgeReason). Nothing fabricates references.
          id: "frozen-fortress.damage-units-here",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 1 },
            target: { kind: "literal", value: "frozen-fortress.units-here" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
