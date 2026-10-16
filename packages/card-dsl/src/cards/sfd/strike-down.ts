/**
 * Strike Down (sfd-107-221) — Spell, 3 energy + 1 Body power, Fiora deck.
 *
 * Printed text:
 *   Choose an equipped friendly unit. It deals damage equal to its Might to an
 *   enemy unit. Then detach an Equipment from it.
 *
 * Status: judge-required — the "It deals damage equal to its Might" half is
 * not expressible with the merged v1 primitives and contract Expr shapes:
 * - the damage SOURCE must be the picked unit (CR 418.6.b.3) and the amount
 *   must read that unit's Might at resolution time; contract 3.2's Expr only
 *   offers object-property over a STATIC ObjectRef, while the picked unit is a
 *   dynamic pick result — there is no Expr form that reads a property of a
 *   pick result, and no merged primitive publishes a picked ObjectRef as a
 *   linked value for a following instruction;
 * - modelling the pick as a TargetSpec would wrongly trigger became-target
 *   effects (v1.5 355.10: "choose" is not a target).
 * The pick, the enemy-unit target, and the "Then detach an Equipment" half
 * (effect.detach + pick) are described below; the damage instruction carries
 * descriptive args for the pending pick-property expression support. Not
 * approximated with a fixed amount or a self-source shortcut.
 *
 * Speed: this printing's ability line has no [Action]/[Reaction] keyword, so
 * the program declares no speed keyword; default spell timing (v1.5 159.2)
 * applies.
 */
const strikeDown = {
  canonicalCardId: "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺“读取 pick 结果属性”的表达式形式：契约 3.2 的 object-property 只能读静态 ObjectRef，" +
    "无法表达“被选单位的 Might”（动态 pick 结果）；effect.damage 的 source 需要 picked unit 的引用，" +
    "也没有原语把 pick 的 ObjectRef 发布为后续指令的链接值。把“Choose”误建成 TargetSpec 会错误触发" +
    "成为目标效果（v1.5 355.10），故不近似实现。detach 半段用已合入的 effect.detach 表达。",
  sourceText:
    "Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit. Then detach an Equipment from it.",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Choose an equipped friendly unit. It deals damage equal to its
          // Might to an enemy unit." The friendly unit is a non-target pick
          // (355.10); the enemy unit is the only target. The source/amount
          // descriptors name the pick result for the pending pick-property
          // expression support (see judgeReason).
          id: "damage",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: "picked-unit.might" },
            source: { kind: "literal", value: "picked-unit" },
            target: { kind: "literal", value: "enemy-unit" }
          },
          picks: [
            {
              id: "picked-unit",
              // Dynamic object pick: the options are the equipped friendly
              // units, resolved by the engine from the filter at Finalize;
              // the placeholder marks a dynamic (non-literal) option set.
              options: ["dynamic:equipped-friendly-units"],
              selection: "one",
              filter: { type: "unit", controller: "you", equipped: true }
            }
          ],
          targets: [
            { id: "enemy-unit", filter: { type: "unit", controller: "opponent" }, selection: "one" }
          ]
        },
        {
          // "Then detach an Equipment from it" — a pick over that unit's
          // attached Equipment; linkedTo the damage instruction so a host that
          // left or lost its Equipment (359.3.e.12) also ignores this one.
          id: "detach",
          op: "effect.detach",
          args: { pick: { kind: "literal", value: "detached-equipment" } },
          picks: [
            {
              id: "detached-equipment",
              options: ["dynamic:attached-equipment"],
              selection: "one",
              filter: { type: "equipment", attachedTo: "picked-unit" }
            }
          ],
          linkedTo: "damage"
        }
      ]
    }
  ]
};

export default strikeDown;
