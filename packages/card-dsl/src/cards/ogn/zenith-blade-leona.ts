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
 * - "move a friendly unit": 355.12 makes every choice for a may-action a
 *   target chosen independently of the decision to perform the action, so the
 *   TargetSpec sits on the may node itself (the merged sfd/disarming-rake and
 *   ogn/salvage "you may kill a gear" shape). The Move instruction inside the
 *   body therefore carries only the { target: ... } selector; the nested
 *   target shape is what ChainEngine.assertFinalizationSurface rejected.
 * - The reminder text "(A stunned unit doesn't deal combat damage this turn.)"
 *   is the consequence of the Stunned state itself (424.1.b), not an
 *   instruction, so it is not authored separately.
 *
 * Status: judge-required, with the target shape now aligned to 355.12 and the
 * whole printed ability expressed in merged IR. The golden drives the card
 * through the real ChainEngine: describePlay builds the draft from the program
 * and Finalize locks both printed choices (355.12). Resolve itself stops one
 * instruction earlier on an engine-side adapter gap: chain/interpreter-adapter.ts
 * LITERAL_FIELDS has no effect.stun entry, so the card's own Stun instruction is
 * rejected with "effect.stun target must be a spec id string" (the golden
 * asserts that exact boundary). The Stun primitive and the Location read plus
 * optional Move are therefore executed through the merged interpreter and the
 * chain adapter respectively.
 *
 * The remaining gap is the runtime Move destination itself: 355.4 / 355.4.a /
 * 451.1 require the Move Destination to be a valid Location chosen at
 * Finalize, and this card's destination is the stunned unit's battlefield (a
 * runtime Location). The merged effect.move evaluates a linked Location, and
 * the merged TurnFlow emits the resulting object-leaves/enters-battlefield
 * timing plus Contested (452) for the committed move-location action, but no
 * merged path answers 355.4.a/449.2 legality for an effect Move: the Finalize
 * surface has no location plan for effect.move (only target/pick plans are
 * locked), and combat start (466.2) / simultaneous combat damage
 * (467.2.c.1.a / 467.3) remain explicitly blocked in Turn/Combat, so the
 * Showdown this Move stages cannot be completed.
 *
 * The Move is an effect Move, not the Standard Move ability (144, 451.1), so
 * it neither exhausts nor pays for the friendly unit — the golden asserts that.
 * The Stun half is merged and executed by the golden through the primitive
 * registry, the same way the merged Rune Prison / Solari Chief programs record
 * their adapter dependency.
 */
const zenithBlade = {
  canonicalCardId: "card.hash-a4a04e52d4544c14530e273f53c3890ccd0d8688ef9dc725dc0ef6b1d20103de",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "已复核并改写为 355.12 的冻结形状：may 仍是 choice.optional 包住 Move，而「a friendly unit」的 TargetSpec 按 355.12" +
    "（may-action 的全部选择都视为目标、独立于是否执行的决定）挂在 may 节点上——同已合入的 sfd/disarming-rake、ogn/salvage。" +
    "golden 经真实 ChainEngine 的 describePlay 从程序生成 draft，并让 Finalize 锁定两处印刷选择（355.12 的敌方单位与友方单位）；" +
    "Resolve 本身停在更早的引擎侧适配缺口：chain/interpreter-adapter.ts 的 LITERAL_FIELDS 没有 effect.stun 条目，" +
    "卡内 Stun 指令被拒为 “effect.stun target must be a spec id string”（golden 断言该边界）。" +
    "已合入并有真实执行证据的部分：effect.stun（424.1/424.1.a.1）经原语注册表令敌方单位 Stunned；" +
    "condition.value 读出该单位的运行时 Location，effect.move 据此把友方单位移入该战场，declined 分支不移动；" +
    "effect Move 不是 Standard Move（144/451.1），不横置也不付费（golden 断言）。" +
    "仍缺的唯一依赖是 effect Move 的 355.4 / 355.4.a / 451.1 目的地合法性：目的地是「被 Stun 单位的战场」这一运行时 Location，" +
    "Finalize 面只为 target/pick 生成锁定计划、没有 effect.move 的 location plan，" +
    "因此无法在 Finalize 前证明该目的地是「该单位当前位置之外且允许出现」的合法 Location；" +
    "已合入的 TurnFlow/CombatFlow 会为已提交的 move-location 发出离/入战场时点并置 Contested（452），" +
    "但战斗开始（466.2）与同时战斗伤害（467.2.c.1.a / 467.3）在 Turn/Combat 工作流仍被显式阻断，该 Move 搭起的 Showdown 无法推进完。不近似实现。",
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
                  }
                }
              ]
            }
          },
          targets: [
            {
              id: "friendly-unit",
              // 355.12: every choice made for the may-action is a target chosen
              // independently of the decision to perform it, so the TargetSpec
              // sits on the may node (the merged disarming-rake / salvage
              // "you may <action> a <thing>" shape). The Move body carries only
              // the { target: ... } selector; the Move destination is fixed by
              // the printed text, so no destination choice is authored.
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default zenithBlade;
