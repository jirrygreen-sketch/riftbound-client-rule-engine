import type { CardProgram } from "../../ir/index.js";

/**
 * The Boss (ogn-269-298) — Legend, Body/Order, tag Sett.
 *
 * Printed text:
 *   When a buffed unit you control would die, you may pay :rb_rune_rainbow:
 *   and exhaust me to spend its buff and recall it exhausted instead. (Send it
 *   to base. This isn't a move.)
 *   When you conquer, ready me.
 *
 * Structure (contract 3.1/3.2):
 * - ability 1 is a replacement ability over the death of a buffed friendly
 *   unit (CR 380/381 define Replacement Effects; the object being replaced is
 *   the unit, so the object is part of the replacement condition and is not a
 *   target choice, CR 355.10.c); the `with` body performs the printed costs and
 *   remedy: pay [A], exhaust me, spend its Buff (CR 702.2.b: remove one Buff
 *   counter) and recall it to base (CR 457: a Recall is not a Move, 458.1: it
 *   does not trigger Move triggers, 460.1: it does not otherwise change the
 *   permanent's state, so the printed "exhausted" is applied explicitly);
 * - ability 2 is a Conquer Effect (CR 383.4.c/383.4.c.2.b): trigger on the
 *   conquer timing point when this legend's controller conquers, body is the
 *   merged effect.ready primitive with the default `"source"` selector ("ready
 *   me", 412.4/416.1).
 *
 * Status: judge-required. Ability 2 is expressible and has execution tests;
 * ability 1 is missing four merged pieces, none approximated:
 * - the IR `ReplacementAbility` has no `optional` field, while the printed text
 *   is "you may pay ... instead". The pipeline's ReplacementRegistration.optional
 *   decision is engine-internal (contract 3.8/4); encoding the "may" as a
 *   choice.optional inside `with` would replace the death even when the player
 *   declines, which is wrong, so the may-decision is recorded here instead;
 * - `cost.pay` (rainbow + exhaust) is a RIFT-9 required primitive with no
 *   merged instruction file; the exhaust must be a cost (CR 415.4/415.5: "as a
 *   cost ... must be able to be completed"), not effect.exhaust's state change;
 * - the `with` body has no ObjectSelector for the object of the replaced event.
 *   "source" is The Boss itself, and there is no target choice to make
 *   (355.10.c); the dying unit cannot be bound, so spending its Buff and
 *   recalling it stay declarative;
 * - `effect.move` explicitly blocks its recall mode: "Recall requires an action
 *   distinct from Move (CR 457-460)" and submits no substitute Move, so even
 *   with a bound reference the recall cannot execute yet.
 * The contract's ZoneId also has no Legend Zone (CR 108.3), so a Legend that
 * must exhaust itself cannot be represented as a Board object; that gap is
 * already tracked by the effect.exhaust task and is repeated in the reply's
 * contract-change request.
 */
const program = {
  canonicalCardId:
    "card.hash-867768d6facbba96eedbdea3f89369bd9565961dca92d203a6b67e05e879947f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "能力 1 是死亡替代：IR 的 ReplacementAbility 没有 optional 字段，而原文为 \"you may pay ... instead\"，引擎内部的 ReplacementRegistration.optional 才是正确的“可以”位置——若把 choice.optional 写进 with，玩家拒绝支付时死亡仍会被替代，语义错误，因此不近似。" +
    "另外还缺：cost.pay（RIFT-9 清单，未合入原语文件；按 CR 415.4/415.5 这里的横置必须是可完成的费用，不能用 effect.exhaust 的状态改变代替）；with 指令没有指向“被替代事件对象”的 ObjectSelector（source 是本传奇自身，被消灭单位按 CR 355.10.c 又不是目标选择），无法绑定该单位的 Buff / 位置；effect.move 的 recall 模式被显式阻断（Recall requires an action distinct from Move，CR 457-460）。" +
    "替代过滤还需要“buffed 单位”谓词（CR 702.2.a：身上有 Buff 计数即为 buffed），当前 EventPattern/ObjectFilter 词汇都没有该字段，replaces.filter 的 buffed: true 只是待接线的声明。" +
    "能力 2（When you conquer, ready me）仅用已合入的 effect.ready 与 conquer 时点，有真实执行测试；整卡因能力 1 保持 judge-required。" +
    "依赖：引擎批 4 的替代/事件管线、RIFT-89（cost.pay）、RIFT-9 的 recall/replacement 语义与事件对象选择符（见契约变更请求）、P2 批 6 生产接线。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-killed",
        filter: {
          type: "unit",
          // Engine PlayerSelector vocabulary (events/trigger-spec.ts): "self"
          // means the ability controller, i.e. "a unit you control".
          controller: "self",
          // "buffed" (CR 702.2.a: a unit with a Buff counter) has no merged
          // predicate field in either EventPattern/ObjectFilter vocabulary; it
          // is recorded here for the replacement pipeline work named in
          // judgeReason and is never treated as true by accident.
          buffed: true
        }
      },
      with: [
        {
          id: "the-boss.pay",
          op: "cost.pay",
          args: {
            // "pay :rb_rune_rainbow: and exhaust me": the exhaust is a cost
            // (CR 415.4/415.5), binding the source legend implicitly; the
            // finalized payment plan is owned by the cost pipeline (RIFT-89).
            power: { kind: "constant", value: ["rainbow"] },
            payments: { kind: "constant", value: [{ kind: "exhaust" }] }
          }
        },
        {
          id: "the-boss.spend-buff",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "spend" },
            // "its buff" = the replaced event's unit. There is no selector for
            // that object yet, so this id is intentionally NOT backed by a
            // TargetSpec: the unit is not a target (CR 355.10.c).
            target: { kind: "constant", value: "the-boss.dying-unit" }
          },
          linkedTo: "the-boss.pay"
        },
        {
          id: "the-boss.recall",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "the-boss.dying-unit" } },
            to: { kind: "constant", value: "controller-base" },
            mode: { kind: "constant", value: "recall" }
          },
          linkedTo: "the-boss.spend-buff"
        },
        {
          id: "the-boss.exhaust-recalled",
          op: "effect.exhaust",
          args: {
            // "recall it exhausted": Recalls do not change statuses (CR 460.1),
            // so the exhausted state is applied explicitly after the recall.
            pick: { kind: "constant", value: "the-boss.dying-unit" }
          },
          linkedTo: "the-boss.recall"
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "When you conquer": the Conquer Effect of anything that references
        // the player Conquering (CR 383.4.c.2.b). PlayerSelector "self" means
        // "the trigger controller performed the action" in the frozen
        // TriggerSpec vocabulary (events/trigger-spec.ts); this legend's
        // controller is the conqueror. "controller" is not a valid
        // PlayerSelector and is not used here.
        filter: { event: "conquer", player: "self" }
      },
      optional: false,
      body: [{ id: "the-boss.ready", op: "effect.ready", args: {} }]
    }
  ],
  sourceText:
    "When a buffed unit you control would die, you may pay :rb_rune_rainbow: and exhaust me to spend its buff and recall it exhausted instead. (Send it to base. This isn't a move.)\n" +
    "When you conquer, ready me."
} satisfies CardProgram;

export default program;
