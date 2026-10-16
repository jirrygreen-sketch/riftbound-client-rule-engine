import type { CardProgram } from "../../ir/index.js";

/**
 * Pirate's Haven (ogn-143-298) — Gear, 3 Energy, Body.
 *
 * "When you ready a friendly unit, give it +1 :rb_might: this turn."
 *
 * CR v1.5 anchors:
 * - 383 / 383.2: "When …" is a triggered ability whose Condition names the
 *   event; readied objects correspond to the "object-readied" timing point
 *   (416.1, 412.4). "You" is the ability controller (190.6.d).
 * - 416.1.c: a Ready object that is instructed to become Ready again produces
 *   nothing, so the trigger only sees real Exhausted→Ready transitions.
 * - "give it +1 [M] this turn": the referent of "it" is the unit readied by
 *   the triggering event. Contract 3.6's ObjectSelector only offers self /
 *   source / target / pick / linked; there is no event-payload object
 *   selector (RIFT-21 binding is not merged), so the body cannot name the
 *   triggering unit without inventing semantics.
 * - "+1 [M] this turn" is a temporary continuous Might modification (703
 *   covers Buff counters instead). The continuous.might instruction and layers
 *   consumer are merged; only the event-object binding remains unavailable.
 *
 * The structure below keeps the trigger and uses the merged continuous.might
 * instruction; the TargetSpec remains a structural stand-in for the triggering
 * unit until the event-object selector is available.
 */
const piratesHaven = {
  canonicalCardId: "card.hash-0dd1405dd6c76acb2f2f4eaf062ac11f4c35f9cf7548386d976200c9b22d2547",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 指令与图层注册路径已合入，但「it」必须绑定 object-readied 触发事件中的被重置单位，" +
    "契约 3.6 的 ObjectSelector 没有事件对象选择器（依赖 RIFT-21 触发 payload 绑定/契约补充）；" +
    "触发能力的 CardProgram 绑定还依赖 RIFT-257。ready 时点与 Might 子效果已有执行证据，整卡不可执行；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-readied",
        filter: {
          event: "object-readied",
          object: { type: "unit" },
          player: "self"
        }
      },
      optional: false,
      body: [
        {
          id: "pirates-haven.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "pirates-haven.readied-unit" }
          },
          targets: [
            {
              // Stand-in for the triggering readied unit: the static IR has no
              // event-object selector (contract 3.6 / RIFT-21).
              id: "pirates-haven.readied-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you ready a friendly unit, give it +1 :rb_might: this turn."
} satisfies CardProgram;

export default piratesHaven;
