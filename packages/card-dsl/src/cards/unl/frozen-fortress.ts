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
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required —
 * re-measured 2026-10-18, one gap remains:
 * 1. effect.damage still reads its victims from ctx.targets(TargetSpec.id)
 *    only, and 355.10.d forbids registering "each unit here" as a TargetSpec —
 *    the primitive call below therefore carries no TargetSpec: probed through
 *    the production chain adapter it reports ignored/mistargeted and deals 0
 *    damage (the golden test executes the same fixed-amount damage with a
 *    test-side locked set to show the printed number and the per-unit handling,
 *    exactly like ogn/anivia-primal).
 * The trigger half is now merged and faithful: registration through
 * createProgramBinding().registerProgramTriggers succeeds, and because the
 * Registration's `at` already selects the phase, the empty event filter fires
 * exactly on `beginning-start` emissions and never on other phase timings
 * (probed for both players' Beginning Phases, which is what "each player's
 * Beginning Phase" asks for). The earlier claim that the closed
 * EVENT_PATTERN_TYPES vocabulary blocked this card was wrong: the vocabulary
 * applies to the event NAME inside the filter, and this card deliberately names
 * no event.
 * Dependencies: an untargeted set-damage form over a "here" set anchor
 * (effect.damage set/query shape, engine follow-up).
 */
export default {
  canonicalCardId:
    "card.hash-09252b56d2b61d29cf38395a75ff54e4d386d4bfa33c0754a32ef693dd912c1a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "剩余缺口（CR 355.10.d/355.10.d.1、053.3，2026-10-18 复核）：「deal 1 to each unit here」是程序化选定的集合、不是目标，" +
    "而已合入的 effect.damage 只从 ctx.targets(TargetSpec.id) 读取受害者（没有集合/query 形态）；" +
    "把它写成 selection \"all\" 的 TargetSpec 会错误登记「成为目标」（355.9/754），属近似实现，故本卡不写 TargetSpec，" +
    "实测经生产链适配器执行本卡 body 得到 ignored/mistargeted、0 伤害（golden 只按同 ogn/anivia-primal 的分层做法，" +
    "用测试侧锁定集合执行同一固定数额伤害）。" +
    "触发半段已合入且忠实：createProgramBinding().registerProgramTriggers 能注册本卡，Registration 的 at 已经选定 phase，" +
    "空事件过滤器因此只在 beginning-start 上触发、不会在其他 phase 时点触发（实测双方玩家的 Beginning Phase 都触发，正合「each player's」）。" +
    "早先「封闭 EVENT_PATTERN_TYPES 挡住本卡」的说法不成立：该词汇约束的是 filter 里的事件名，而本卡有意不写事件名。" +
    "依赖：带「here」集合锚点的无目标集合伤害形态（effect.damage 的集合/query 形态，引擎后续）。",
  sourceText:
    "At the start of each player's Beginning Phase, deal 1 to each unit here. (This happens before scoring.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        // "each player's Beginning Phase": every player's, not only the
        // Battlefield controller's (190.6.b covers the uncontrolled case).
        // The Registration's `at` already selects the phase timing, so the
        // filter deliberately names no closed event type; probed, this fires on
        // every Beginning Phase and on no other phase timing.
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
