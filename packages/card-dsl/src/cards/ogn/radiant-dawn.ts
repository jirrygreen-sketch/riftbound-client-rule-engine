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
 *   responsible for it. The unit-stunned payload only carries
 *   actionId/batchId/playerId/sourceId/unitId/controllerId, and `playerId` is the
 *   stunned unit's controller (the opponent), so an ability of the stunning
 *   player cannot be filtered honestly yet;
 * - "one or more enemy units": the frozen timing point is emitted once per
 *   stunned unit and trigger.state has no batch grouping, so a single Stun
 *   action hitting several enemy units would trigger once per unit instead of
 *   once for the batch. `once` scopes (per-turn/per-combat/...) cannot express
 *   "per batch" either.
 * The buff body itself is merged and has real execution tests.
 */
const program = {
  canonicalCardId:
    "card.hash-5d02f70104295cfce7c17c88cd891af0271f665b937919cca5601f8273c83284",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发条件「When you stun one or more enemy units」缺两项引擎语义：(1) CR 412.4/412.5 的“由你执行 Stun”责任归因——unit-stunned 时点逐单位发出、载荷只有 actionId/batchId/playerId/sourceId/unitId/controllerId，其中 playerId 是被 Stun 单位的控制者，" +
    "无法诚实地过滤“你 Stun 的”敌方单位；(2) “one or more” 批次语义——同一次 Stun 命中多个敌方单位只应触发一次，但冻结时点逐单位发出、trigger.state 无批次分组，once 作用域也无 per-batch。" +
    "effect.buff 部分已合入（RIFT-119 仅合入 effect.stun 原语本体），有执行测试；整卡保持 judge-required，依赖引擎批 4 的 trigger.state 责任与批次语义及 P2 批 6 生产接线。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "unit-stunned",
        filter: {
          event: "unit-stunned",
          // Payload filter in the pipeline-effective position: the stunned
          // `object` (the unit that became Stunned) must be an enemy unit.
          object: { type: "unit", zone: "board", controller: "opponent" }
        }
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
