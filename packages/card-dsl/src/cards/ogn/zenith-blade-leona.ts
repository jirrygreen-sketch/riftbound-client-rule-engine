import type { CardProgram } from "../../ir/index.js";

/**
 * Zenith Blade, Leona (ogn-262-298) — Spell, 3 energy + 2 Calm power
 * (Calm/Order, Leona Signature).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Stun an enemy unit at a battlefield. You may move a friendly unit to that
 *   enemy unit's battlefield. (A stunned unit doesn't deal combat damage this
 *   turn.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806 / 159.2.a) is a keyword ability; the card only declares it.
 * - "Stun an enemy unit at a battlefield" is the merged effect.stun primitive:
 *   the unit is a Choice (355.5 / 355.5.a prints this card as its example), so
 *   it is a TargetSpec with the location restriction "at a battlefield"
 *   (355.10.b: the restriction does not make the battlefield a target), and
 *   the Stunned-state consequences stay with the state (424.1.a.1 / 424.1.b).
 * - "You may move a friendly unit to that enemy unit's battlefield" is an
 *   optional effect: contract 3.9 freezes "may" as choice.optional with the
 *   chosen instructions inside its body (never choice + linkedTo). "That enemy
 *   unit's battlefield" is read from the stunned unit's Location at resolution
 *   through an object-property expression published by condition.value, which
 *   the merged interpreter evaluates.
 * - The reminder text "(A stunned unit doesn't deal combat damage this turn.)"
 *   is the consequence of the Stunned state itself (424.1.b), not an
 *   instruction, so it is not authored separately.
 *
 * Status: judge-required — the optional Move half cannot be finalized:
 * - the nested instruction inside choice.optional carries the Move's target
 *   selection. The merged chain Finalize surface still blocks nested targets
 *   ("Nested/repeated targets require an interpreter target-selection lifecycle
 *   adapter", chain/README contract change request 2); the golden drives the
 *   real ChainEngine with this card's own play body and asserts that block.
 *   Hoisting the target out of the optional wrapper would contradict the frozen
 *   3.9 shape for "may".
 * - the Move Destination is the stunned unit's battlefield, a runtime Location.
 *   The merged effect.move accepts it only through an Expr the primitive itself
 *   evaluates, so this program publishes it with condition.value and the
 *   interpreter adapter path resolves it (the golden test runs that Move).
 *   Destination legality (355.4.a / 449.2 / 451.1) belongs to the Turn flow;
 *   for committed effect Moves the merged TurnFlow/CombatFlow now produce the
 *   Contested consequence (452 contested-applied) and stage the Showdown, but
 *   combat start (466.2) and simultaneous combat damage (467.2.c.1.a / 467.3)
 *   are still explicitly blocked in the Turn/Combat workstream.
 * - the Move is an effect Move, not the Standard Move ability (144, 451.1), so
 *   it neither exhausts nor pays for the friendly unit.
 * - playing the card from hand also needs the card-program Play binding
 *   (RIFT-257): chain/engine.ts requires a describePlay adapter for Play
 *   actions.
 * The Stun half is merged and is executed by the golden test with a
 * Finalize-locked target, the same way the merged Rune Prison program does.
 */
const zenithBlade = {
  canonicalCardId: "card.hash-a4a04e52d4544c14530e273f53c3890ccd0d8688ef9dc725dc0ef6b1d20103de",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「You may move a friendly unit to that enemy unit's battlefield」的可选半段缺 Finalize 生命周期：" +
    "按契约 3.9 的冻结形状，may 必须写成 choice.optional 并把被选指令包进 body，而该 Move 指令自带目标选择" +
    "（355.12：对若干对象执行游戏动作的许可，全部选择都视为目标并独立于“是否执行”决定）；" +
    "已合入的链 Finalize 面明确阻断嵌套目标——assertFinalizationSurface 抛 ChainContractBlockedError" +
    "（chain/README 契约变更请求 2：缺解释器目标选择生命周期适配器），golden 用真实 ChainEngine 执行本卡 play body 并断言该阻断。" +
    "把目标提升到可选包装之外会违反 3.9 的 may 形状，故不近似实现。" +
    "另：目的地是“被 Stun 单位的战场”，属运行时 Location（355.4.a / 449.2 / 451.1），" +
    "IR 用 condition.value 发布该 Location 供 effect.move 求值（golden 真实执行该 Move）；" +
    "Move 后果中，已合入的 TurnFlow/CombatFlow 会为已提交的 effect Move 产生 Contested（452 contested-applied）并搭起 Showdown 阶段，" +
    "但战斗开始（466.2）与同时战斗伤害（467.2.c.1.a / 467.3）在 Turn/Combat 工作流仍被显式阻断。" +
    "从手牌打出还需要卡牌程序 Play 绑定（RIFT-257：chain/engine.ts 的 Play 动作要求 describePlay 适配器）。" +
    "Stun 半段只用已合入的 effect.stun（424.1/424.1.a.1），由 golden 真实执行。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Stun an enemy unit at a battlefield. You may move a friendly unit to that enemy unit's battlefield. " +
    "(A stunned unit doesn't deal combat damage this turn.)",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "stun-enemy-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "enemy-unit-at-battlefield" } },
          targets: [
            {
              id: "enemy-unit-at-battlefield",
              // "an enemy unit at a battlefield": one targeted unit;
              // "at a battlefield" is a targeting restriction (355.10.b).
              filter: { type: "unit", controller: "opponent", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "that enemy unit's battlefield" — the Location read at resolution
          // (contract 3.6), published for the Move below. condition.value is a
          // merged structural instruction; it writes a linked value and takes
          // no game action itself.
          id: "read-that-battlefield",
          op: "condition.value",
          linkedTo: "stun-enemy-unit",
          args: {
            value: {
              kind: "object-property",
              object: { target: "enemy-unit-at-battlefield" },
              property: "location"
            },
            key: { kind: "constant", value: "battlefield" }
          }
        },
        {
          id: "may-move-friendly-unit",
          op: "choice.optional",
          linkedTo: "read-that-battlefield",
          args: {
            prompt: { kind: "constant", value: "Move a friendly unit to that enemy unit's battlefield?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "move-friendly-unit",
                  op: "effect.move",
                  args: {
                    objects: { kind: "constant", value: { target: "friendly-unit" } },
                    to: {
                      kind: "linked-value",
                      instructionId: "read-that-battlefield",
                      key: "battlefield"
                    }
                  },
                  targets: [
                    {
                      id: "friendly-unit",
                      // "a friendly unit": one targeted unit the controller
                      // controls; the Move destination is fixed by the text,
                      // so no destination choice is authored.
                      filter: { type: "unit", controller: "self" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default zenithBlade;
