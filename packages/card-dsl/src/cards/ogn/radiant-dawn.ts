import type { CardProgram } from "../../ir/index.js";

/**
 * Radiant Dawn (ogn-261-298) — Legend, Calm/Order, tag Leona.
 *
 * Printed text:
 *   When you stun one or more enemy units, buff a friendly unit. (If it
 *   doesn't have a buff, it gets a +1 :rb_might: buff.)
 *
 * Structure (contract 3.1/3.2):
 * - triggered ability on the unit-stunned timing point (CR 424.1/424.1.a.1,
 *   RIFT-119 merged the effect.stun primitive); the event filter asks for a
 *   stunned unit controlled by the opponent;
 * - "buff a friendly unit" is a mandatory target choice (CR 355.5, 355.10) and
 *   uses the merged effect.buff primitive in its "buff" mode (CR 702.2.a:
 *   place one Buff counter; 702.3.a: a unit that already has a Buff is not Buffed
 *   again — the primitive reports that no-op as negated/skipped).
 *
 * Status: judge-required. Two trigger semantics are not expressible:
 * - "you stun": CR 412.4/412.5 attribute the Stun game action to the player
 *   responsible for it. The stun GameAction carries no player (contract 3.6:
 *   { type: "stun", object }), so the emitted event's player falls back to the
 *   stunned unit's controller (events/action-adapter.ts), i.e. the opponent;
 *   an ability of the stunning player cannot be filtered honestly yet;
 * - "one or more enemy units": the frozen timing point is emitted once per
 *   stunned unit and trigger.state has no batch grouping, so a single Stun
 *   action hitting several enemy units would trigger once per unit instead of
 *   once for the batch. `once` scopes (per-turn/per-combat/...) cannot express
 *   "per batch" either.
 * Additionally, no merged consumer binds a CardProgram's triggered abilities
 * into TriggerRegistrations (RIFT-257), and the event pipeline still needs a
 * host testTrigger adapter for any trigger carrying a condition.
 * The buff body itself is merged and has real execution tests.
 */
const program = {
  canonicalCardId:
    "card.hash-5d02f70104295cfce7c17c88cd891af0271f665b937919cca5601f8273c83284",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发条件「When you stun one or more enemy units」缺三项：(1) CR 412.4/412.5 的“由你执行 Stun”责任归因——stun GameAction 不带 player（契约 3.6：{ type: \"stun\", object }），" +
    "动作管线发出的 unit-stunned 事件 player 回落到被 Stun 单位的控制者（对手），无法诚实地过滤“你 Stun 的”敌方单位；" +
    "(2) “one or more” 批次语义——同一次 Stun 命中多个敌方单位只应触发一次，但时点逐单位发出、trigger.state 无批次分组，once 作用域也无 per-batch；" +
    "(3) 没有任何已合入消费方把 CardProgram 的 triggered 能力登记成 TriggerRegistration（RIFT-257），且带 condition 的触发仍要求 host.testTrigger 适配器。" +
    "effect.buff 部分已合入（RIFT-119）并有执行测试；整卡保持 judge-required，依赖 Stun 责任归因/批次语义（引擎批 4 的 trigger.state）与 RIFT-257 生产接线。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "unit-stunned",
        // The merged event vocabulary has no "unit-stunned" EventPattern name
        // (validateTriggerSpec rejects it), so the filter is authored as the
        // bare ObjectFilter the matcher applies to the event payload object:
        // the stunned unit must be an enemy unit (355.9.b).
        filter: { type: "unit", zone: "board", controller: "opponent" }
      },
      optional: false,
      body: [
        {
          id: "radiant-dawn.buff",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "friendly-unit" }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "controller", zone: "board" },
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
    "When you stun one or more enemy units, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
} satisfies CardProgram;

export default program;
