import type { CardProgram } from "../../ir/index.js";

/**
 * Symbol of the Solari (ogn-227-298) — OGN Gear, 1 energy, 0 Order power, no Might.
 *
 * Printed text:
 *   If a combat where you are the attacker ends in a tie, recall ALL units
 *   instead. (Send them to base. This isn't a move. Ties are calculated after
 *   combat damage is dealt.)
 *
 * Modelling notes (Core Rules v1.5):
 * - "instead" makes this a replacement effect (380.1-380.3): it replaces part
 *   of the combat Resolution Step with a different action. It is not a trigger. The
 *   replaced procedure is 468.1.a.2 ("Insert 3d. Recall Attackers present at
 *   the Battlefield if Defenders are still present", 456-460), whose Recall
 *   moves only the attackers. "recall ALL units instead" widens that Recall to
 *   every unit at the battlefield.
 * - "a combat where you are the attacker" is the attacker designation
 *   (740.1/740.2, 468.3.a); "ends in a tie" is 740.3.a — a tie occurs when
 *   units controlled by different players are located at a battlefield where
 *   combat is taking place during step 3d of the combat cleanup, i.e. after
 *   combat damage has been dealt (467.2.c-d). That is why the printed reminder
 *   says ties are calculated after combat damage.
 * - "recall" is 457: a Recall relocates a permanent to its base and is
 *   explicitly NOT a Move (458, 458.1: it triggers no Move triggers;
 *   458.3: it cannot be prevented by movement restrictions; 460.1: it leaves
 *   damage and statuses unchanged). "ALL units" is an each-set over the
 *   battlefield (355.5.a: an effect that affects objects by criteria involves
 *   no choice), so it is not a target.
 *
 * Status: judge-required.
 * Recall is distinct from Move and still explicitly fails closed in both
 * effect.move and the replacement planner. Combat cleanup 3d has no replacement
 * interception point. The blocked declaration also lacks the tie/attacker and
 * current battlefield bindings; querying all board units cannot stand in for
 * all units at that combat's battlefield.
 */
const symbolOfTheSolari = {
  canonicalCardId: "card.hash-a16ac42e7e64f8cc856cd0d66e484b3c448476bae90001b4b613fd8d2a1fddde",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺独立 Recall 动作（CR 457-460）：effect.move mode:recall 仍为 negated/impossible，替代 planner 抛 " +
    "BlockedReplacementError；Recall 必须绕过移动限制、保留伤害/状态且不产生 Move 触发（458.1/458.3/460.1）。" +
    "还缺 468.1.a.2 战斗清理 3d 的过程替代入口：combat-result 无提交产生方，替代模式也未匹配该事件。" +
    "受阻声明仍需绑定 740.3.a 的 tie、attacker 与该战场双方单位（355.5.a）；不能用所有 board 单位替代本次战场。" +
    "不近似实现。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "combat-result",
        filter: {
          // "you are the attacker": the ability controller holds the attacker
          // designation (740.1.a, 468.3.a). PlayerSelector "self" means the
          // trigger/ability controller in the frozen TriggerSpec vocabulary.
          player: "self"
        }
      },
      with: [
        {
          id: "symbol-of-the-solari.recall-all-units",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "symbol-of-the-solari.all-units",
                filter: { type: "unit", zone: "board" },
                min: 0
              }
            },
            amount: {
              kind: "count",
              subject: "units",
              filter: { type: "unit", zone: "board" }
            },
            to: { kind: "constant", value: "controller-base" },
            mode: { kind: "constant", value: "recall" }
          }
        }
      ]
    }
  ],
  sourceText:
    "If a combat where you are the attacker ends in a tie, recall ALL units instead. " +
    "(Send them to base. This isn't a move. Ties are calculated after combat damage is dealt.)"
} satisfies CardProgram;

export default symbolOfTheSolari;
