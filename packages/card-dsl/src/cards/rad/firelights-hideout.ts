import type { CardProgram } from "../../ir/index.js";

/**
 * Firelights' Hideout (rad-162-167) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-162-167):
 *   "When you conquer here, the next unit you play this turn has
 *    [Accelerate]. (You may pay :rb_energy_1: and a Power of its Domain as an
 *    additional cost to have it enter ready.)"
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b: "When you conquer here" is a Conquer
 *   Effect — a Triggered Ability that references the player who Conquered; it
 *   goes on the chain when that player has Conquered, and 383.4.c.2.c keeps it
 *   triggering even if the point gain is negated or replaced.
 * - 190.6.a / 190.6.d: "you" in a battlefield's ability is the battlefield's
 *   Controller, so the granted permission belongs to that player.
 * - 805.1 / 805.1.a / 805.1.b / 805.2: Accelerate is an Optional Additional
 *   Cost keyword present on Units; it is functionally "As you play me, you may
 *   pay [1][C] as an additional cost. If you do, I enter ready." The printed
 *   reminder text is that fixed functional text (805.1.b), so it adds no
 *   separate ability here.
 * - 359.3.e.14 / 805.2.b: the grant is a continuous layer effect on a later
 *   play, not an instruction this resolution executes.
 *
 * Status (cards/README.md §2): judge-required. Two independent card-level gaps
 * plus the engine-side trigger bridge, none approximated:
 * 1. Granting a keyword to a future unit is continuous.grant-keyword /
 *    continuous.keyword in the RIFT-9 primitive inventory: effects/instructions/
 *    has no file for that op, and no merged consumer turns a card program's
 *    ability into a layer registration (engine-core never reads card-program
 *    abilities; LayerEngine only evaluates ContinuousEffectSpecs registered by
 *    its callers). Same gap as sfd/fortified-position, sfd/gem-jammer and
 *    sfd/forecaster.
 * 2. "the next unit you play this turn" has no IR shape: the frozen
 *    ObjectSelector set is self / source / target / pick / linked, ObjectFilter
 *    has no greatest/last-created quantifier, and a TargetSpec must lock
 *    objects that already exist at Finalize (CR 355.5) while the unit is played
 *    later in the turn. The Duration vocabulary (permanent / end-of-turn /
 *    end-of-combat / while-source-in-zone / until) has no one-shot "next unit"
 *    window either (same one-shot-window gap as ogn/raging-firebrand).
 * The trigger side adds a third, engine-wide dependency: scoring/ is not
 * bridged to the chain/events pipeline, so nothing emits the conquer timing
 * point and no subscriber registers a card program's triggered ability as a
 * TriggerRegistration (190.6 battlefield-controller resolution included); the
 * filter keeps the sibling battlefield placeholder spelling (here: true /
 * player: "controller") for the 053.3 referent, which the engine trigger-spec
 * validator does not accept yet.
 * The intended body is preserved below so the missing pieces stay auditable.
 * Dependencies: RIFT-91 follow-up (keyword grant / continuous-effect
 * registration and a one-shot window) and RIFT-31/RIFT-33 conquer emission and
 * card-program trigger registration (contract §7.2 batch 5).
 */
export default {
  canonicalCardId: "card.hash-b0fa1aa611f78286913c3002834a073dcdd58ad0678ff45714b3accf84b68c72",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处卡内缺口加触发接线依赖，均不近似实现：(1) 「the next unit you play this turn has [Accelerate]」是把 Accelerate 关键词授予本回合稍后打出的单位、并带本回合期限：" +
    "continuous.grant-keyword（continuous.keyword）只在 RIFT-9 原语清单里，effects/instructions/ 没有该 op 的文件，" +
    "也没有已合入消费方把 CardProgram 的能力注册进 layers/LayerEngine（engine-core 源码不读取卡牌能力；" +
    "LayerEngine 只评估调用方注册的 ContinuousEffectSpec）——同 sfd/fortified-position、sfd/gem-jammer、sfd/forecaster 的缺口。" +
    "(2) 「the next unit you play」这个一次性窗口没有 IR 形状：ObjectSelector 只有 self/source/target/pick/linked，" +
    "ObjectFilter 没有 greatest/last-created 量词，TargetSpec 按 CR 355.5 必须在 finalize 时锁定已经存在的对象（该单位本回合稍后才打出），" +
    "Duration 只有 permanent/end-of-turn/end-of-combat/while-source-in-zone/until，没有 one-shot「next unit」期限（同 ogn/raging-firebrand 的缺口）。" +
    "触发侧另有引擎级依赖：scoring/（RIFT-76）未接入 chain/events 单管线（RIFT-120），没有任何生产者 emit conquer，" +
    "也没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration，190.6 的战场能力控制者解析缺失；" +
    "filter 的 here: true / player: \"controller\" 是同类战场卡占位（053.3 的 here 指代），引擎 trigger-spec 校验器当前不接受。" +
    "依赖：RIFT-91 后续的关键词授予/持续效果注册与 one-shot 窗口，RIFT-31/RIFT-33 的 conquer 发射与触发注册（契约 §7.2 批 5）。不近似实现。",
  sourceText:
    "When you conquer here, the next unit you play this turn has [Accelerate]. " +
    "(You may pay :rb_energy_1: and a Power of its Domain as an additional cost to have it enter ready.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d); the sibling battlefield programs keep the same
        // placeholder spelling while the trigger pipeline is unmerged.
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          // "the next unit you play this turn has [Accelerate]" — authored in
          // the layers-contract shape (keyword + end-of-turn duration + the one
          // next unit the controller plays). See judgeReason for the missing
          // keyword-grant instruction and the missing one-shot window; this is
          // deliberately NOT a `keyword` ability on this Battlefield, because
          // the Battlefield itself does not have Accelerate (805.1.a).
          id: "firelights-hideout.grant-accelerate",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Accelerate" },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: {
              kind: "constant",
              value: { target: "firelights-hideout.next-unit" }
            }
          },
          targets: [
            {
              // "the next unit you play this turn": one unit the controller
              // plays later this turn. ObjectFilter cannot express "the next
              // one" (see judgeReason), so the filter records the restricted
              // population; min 0 keeps the shape from inventing a target that
              // does not exist when the ability finalizes.
              id: "firelights-hideout.next-unit",
              filter: { type: "unit", controller: "controller" },
              min: 0,
              max: 1,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

