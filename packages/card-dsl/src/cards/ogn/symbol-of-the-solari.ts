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
 * Status: judge-required — the Recall cannot be executed and the replacement
 * point cannot be expressed:
 * - the merged `effect.move` primitive implements Recall only as a fail-closed
 *   refusal: "mode: recall … Recall requires an action distinct from Move
 *   (CR v1.5 457-460)", returning negated/impossible with a documented
 *   blockedReason and submitting no substitute Move. Approximating the Recall
 *   with an ordinary Move would both trigger Move triggers (458.1) and apply
 *   movement restrictions (458.3) that a Recall ignores, so no near-form is
 *   authored.
 * - the Combat Special Cleanup step 3d insertion point (468.1.a.2) is
 *   engine-internal combat flow: the closed timing-point enum has no
 *   "tie / combat cleanup 3d" point, and `replaces` (an EventPattern) cannot
 *   name the procedure insertion. The declared pattern below records the
 *   intended replacement (attacker's combat result + tie) without claiming a
 *   merged interception site.
 * - "ALL units" would additionally have to be read at resolution across both
 *   players' boards; the merged `choose` selection in effect.move is a
 *   non-target set query whose `amount` is an Expr, so the count form is
 *   available, but it is worthless while recall mode itself is blocked.
 */
const symbolOfTheSolari = {
  canonicalCardId: "card.hash-a16ac42e7e64f8cc856cd0d66e484b3c448476bae90001b4b613fd8d2a1fddde",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 缺可执行的 Recall：已合入的 effect.move 只把 mode: recall 作为 fail-closed 拒绝实现" +
    "（Recall requires an action distinct from Move，CR 457-460），返回 negated/impossible 且不提交任何替代动作；" +
    "用普通 Move 近似会错误触发 Move 触发（458.1）并应用 Recall 本应忽略的移动限制（458.3），故不近似。" +
    "(2) 替代点无法表达：被替代的是战斗 Resolution Step 的 Combat Special Cleanup 3d（468.1.a.2，" +
    "仅 Recall Attackers），封闭时点枚举里没有 tie / combat cleanup 3d 时点，`replaces` 的 EventPattern 也无法指名流程插入点。" +
    "(3) ALL units 需要跨双方棋盘在结算时读取（355.5.a 的按条件作用集合、非目标选择），该部分依赖 (1) 落地后才有意义。" +
    "依赖：Recall 动作原语与战斗清理替代接入（引擎 combat 流程 / 新增时点，属契约变更）。",
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
