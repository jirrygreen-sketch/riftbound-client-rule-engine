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
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required — three
 * merged gaps, none approximated:
 * 1. no merged module emits `beginning-start` into the single event pipeline
 *    for the turn player's Beginning Phase (mushroom-pouch, loose-cannon and
 *    the-arenas-greatest record the same gap), so the trigger cannot enter the
 *    chain;
 * 2. there is no merged primitive for an untargeted set damage: effect.damage
 *    reads its victims from ctx.targets(TargetSpec.id) only, and 355.10.d
 *    forbids registering "each unit here" as a TargetSpec. The primitive call
 *    below therefore carries no TargetSpec and cannot deal the damage today
 *    (the golden test executes the same fixed-amount damage with a
 *    test-side locked set to show the printed number and the per-unit
 *    handling, exactly like ogn/anivia-primal);
 * 3. no merged subscriber registers a CardProgram's triggered ability as a
 *    TriggerRegistration, and 190.6's uncontrolled-Battlefield responsibility
 *    ("each player's") has no producer.
 * Dependencies: the turn module's beginning-start emission plus RIFT-33 /
 * RIFT-120 trigger registration (contract §7.2 batch 5), and an untargeted
 * set-damage form over a "here" set anchor.
 */
export default {
  canonicalCardId:
    "card.hash-09252b56d2b61d29cf38395a75ff54e4d386d4bfa33c0754a32ef693dd912c1a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) beginning-start 时点（CR 315.2.a.1）没有被任何已合入模块为回合玩家的 Beginning Phase " +
    "emit 进唯一事件管线，触发无法进链（同 ogn/mushroom-pouch、ogn/loose-cannon、ogn/the-arenas-greatest 的缺口；" +
    "依赖 RIFT-33 / 契约 §7.2 批 5 回合接线）。(2)「deal 1 to each unit here」按 355.10.d/355.10.d.1 是程序化选定的集合、不是目标，" +
    "而已合入的 effect.damage 只从 ctx.targets(TargetSpec.id) 读取受害者（没有集合/query 形态）；" +
    "把它写成 selection \"all\" 的 TargetSpec 会错误登记「成为目标」（355.9/754），属近似实现，故本卡不写 TargetSpec，" +
    "该指令当前无法造成伤害（golden 只按同 ogn/anivia-primal 的分层做法，用测试侧锁定集合执行同一固定数额伤害）。" +
    "(3) 没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration，" +
    "190.6.b 的无控制者战场由回合玩家负责也没有生产者。依赖：回合模块的 beginning-start 发射 + 触发注册（契约 §7.2 批 5）、" +
    "以及带「here」集合锚点的无目标集合伤害形态。",
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
        // filter names no player and no battlefield payload exists yet.
        filter: { event: "beginning-start" }
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
