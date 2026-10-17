/**
 * Strike Down (sfd-107-221) — Spell, 3 energy + 1 Body power, Fiora deck.
 *
 * Printed text:
 *   Choose an equipped friendly unit. It deals damage equal to its Might to an
 *   enemy unit. Then detach an Equipment from it.
 *
 * Status: judge-required — the printed rule text is now expressible, but the
 * print is still gated by unmerged paths:
 * - the damage SOURCE and the amount both read the picked unit
 *   (CR 418.6.b.3): contract 3.6/3.2's object-attribute selector accepts
 *   `{ pick: "picked-unit" }` (effects/interpreter/selectors.ts
 *   resolveObjectSelector resolves pick selectors, and effect.damage evaluates
 *   both source and amount through ctx.evaluate), so the former "no Expr form
 *   reads a pick result" gap no longer exists. The program declares the
 *   attribute read for the amount and for the source, and the golden test
 *   executes both against the reference kernel;
 * - modelling the pick as a TargetSpec would wrongly trigger became-target
 *   effects (v1.5 355.10: "choose" is not a target), so the chosen unit stays a
 *   picks entry;
 * - the whole ability still needs the merged CardProgram binding surface to
 *   accept a play body whose instructions carry pick selectors: the chain
 *   Finalize only locks instruction targets (chain/engine.ts
 *   assertFinalizationSurface), so a production play has no path that fills
 *   the pick's ObjectRefs (contract 3.6 pick lifecycle / RIFT-90), and the
 *   printed "equipped friendly unit" restriction needs an equipped predicate
 *   that the merged ObjectFilter (layers/filter.ts matchesObjectFilter) does
 *   not have.
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
    "「Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit.」已改用已合入的表达式与原语：" +
    "effect.damage 的 amount/source 都接受 object-attribute 表达式，object 选择器 { pick: \"picked-unit\" } 由 " +
    "effects/interpreter/selectors.ts 的 resolveObjectSelector 解析（amount 读 might、source 读 ref），" +
    "golden 用参考内核真实执行了这条伤害指令（3 Might 造成 3 点伤害）。仍不能标 executable 的当前缺口：" +
    "(1) 生产链 Finalize 只为 instruction.targets 生成 TargetPlan（chain/engine.ts 的 assertFinalizationSurface 明确" +
    "「Nested/repeated targets require an interpreter target-selection lifecycle adapter」），没有为 picks 填充 ObjectRef 的" +
    "生命周期，卡牌绑定后「Choose an equipped friendly unit」这一非目标选择在生产打出时没有候选（RIFT-90 的 pick 生命周期）；" +
    "(2) 印刷限制「equipped friendly unit」需要 ObjectFilter 的已装备谓词，而合并词表（layers/filter.ts 的 matchesObjectFilter）" +
    "没有 equipped，只支持对象自身的 states: [\"attached\"]；" +
    "(3) 打出该法术的卡牌程序绑定（RIFT-257）已可用于 describePlay，但在 pick 生命周期落地前整卡仍不可执行。" +
    "把 Choose 误建成 TargetSpec 会错误触发成为目标效果（v1.5 355.10），故不近似实现；detach 半段用已合入的 effect.detach 表达。",
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
            // "It deals damage equal to its Might": the picked unit's Might is
            // read at resolution time through the merged pick selector
            // (contract 3.6 / CR 418.6.b.3), never a fixed amount.
            amount: {
              kind: "object-attribute",
              object: { pick: "picked-unit" },
              attribute: "might"
            },
            // "It" is the picked unit, so the Deal's source is that unit's
            // current reference (CR 418.6.b.3), not the spell and not "self".
            source: {
              kind: "object-attribute",
              object: { pick: "picked-unit" },
              attribute: "ref"
            },
            target: { kind: "constant", value: "enemy-unit" }
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
              filter: { type: "equipment", attachedTo: { pick: "picked-unit" } }
            }
          ],
          linkedTo: "damage"
        }
      ]
    }
  ]
};

export default strikeDown;
