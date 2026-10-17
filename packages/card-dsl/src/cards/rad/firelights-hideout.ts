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
 * Status (cards/README.md §2): judge-required. Re-checked against the merged
 * ops; two card-level gaps plus the battlefield-host binding remain, none
 * approximated:
 * 1. The keyword grant itself is executable: continuous.grant-keyword (RIFT-258)
 *    registers an ability-layer effect, and the merged layers engine applies it
 *    (the golden drives the declared grant through the real interpreter and
 *    LayerEngine and observes the granted [Accelerate]). What is still missing
 *    is the registration path that would install that grant on a unit played
 *    later in the turn: the one-shot next-unit window is still missing, and the
 *    conquer trigger still needs its battlefield-host binding.
 * 2. "the next unit you play this turn" has no IR shape: the frozen
 *    ObjectSelector set is self / source / target / pick / linked, ObjectFilter
 *    has no greatest/last-created quantifier, and a TargetSpec must lock
 *    objects that already exist at Finalize (CR 355.5) while the unit is played
 *    later in the turn. The Duration vocabulary (permanent / end-of-turn /
 *    end-of-combat / while-source-in-zone / until) has no one-shot "next unit"
 *    window either (same one-shot-window gap as ogn/raging-firebrand).
 * The trigger side: the conquer timing point and CardProgram TriggerRegistration
 * are merged; 190.6 battlefield-controller resolution and the source battlefield
 * identity binding are still missing.
 * The intended body is preserved below so the missing pieces stay auditable.
 * Dependencies: the source battlefield identity binding and the one-shot
 * "next unit" window.
 */
export default {
  canonicalCardId: "card.hash-b0fa1aa611f78286913c3002834a073dcdd58ad0678ff45714b3accf84b68c72",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处卡内缺口加注册接线依赖，均不近似实现：" +
    "(1) 「the next unit you play this turn has [Accelerate]」的关键词授予本身已可执行——continuous.grant-keyword " +
    "注册 ability 图层效果，merged LayerEngine 会把 [Accelerate] 加到目标单位上（golden 用真实解释器 + 图层引擎执行）；" +
    "仍缺的是本回合稍后第一个合资格单位的 one-shot 窗口与延迟安装消费方，不能在 Finalize 时提前锁定该单位。" +
    "(2) 「the next unit you play」这个一次性窗口没有 IR 形状：ObjectSelector 只有 self/source/target/pick/linked，" +
    "ObjectFilter 没有 greatest/last-created 量词，TargetSpec 按 CR 355.5 必须在 finalize 时锁定已经存在的对象（该单位本回合稍后才打出），" +
    "Duration 只有 permanent/end-of-turn/end-of-combat/while-source-in-zone/until，没有 one-shot「next unit」期限（同 ogn/raging-firebrand 的缺口）。" +
    "触发侧：conquer 时点与 CardProgram TriggerRegistration 已合入，但 190.6 的战场能力控制者解析" +
    "以及 details.battlefieldId 与本战场宿主的绑定仍缺——注册路径实测拒绝 details 声明" +
    "（programs/filters.ts 的 translateTriggerFilter 抛 ProgramBindingError「Unsupported filter field details」），" +
    "且即便透传，details 也是与 turn/flow.ts:102 发射的真实 battlefieldId 做字面比较，" +
    "「self」占位永远不会匹配；one-shot「next unit」窗口也未合入。不近似实现。",
  sourceText:
    "When you conquer here, the next unit you play this turn has [Accelerate]. " +
    "(You may pay :rb_energy_1: and a Power of its Domain as an additional cost to have it enter ready.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d); the remaining placeholder is the source battlefield
        // identity binding described in judgeReason.
        filter: { event: "conquer", player: "self", details: { battlefieldId: "self" } }
      },
      optional: false,
      body: [
        {
          // "the next unit you play this turn has [Accelerate]" — the merged
          // continuous.grant-keyword shape (RIFT-258): applied to the ability
          // source by appliesTo, so the golden must lock the later-played unit
          // as the target. The one-shot "next unit" window and the
          // card-program registration are still missing (see judgeReason); this
          // is deliberately NOT a `keyword` ability on this Battlefield, because
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

