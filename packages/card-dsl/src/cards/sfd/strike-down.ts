/**
 * Strike Down (sfd-107-221) — Spell, 3 energy + 1 Body power, Fiora deck.
 *
 * Printed text:
 *   Choose an equipped friendly unit. It deals damage equal to its Might to an
 *   enemy unit. Then detach an Equipment from it.
 *
 * Status: judge-required (2026-10-17 review) — the printed rule text is now
 * expressible, but the print is still gated by unresolved pick and predicate
 * paths:
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
 * - the chain Finalize still locks only instruction targets plus ordered
 *   zoneSlice/linked pick sources: `finalizeOrderedPickPlans` filters
 *   `orderedPickSpecs` down to specs that declare `zoneSlice` or `linked`, so
 *   this card's two filter-driven picks yield an empty plan and no production
 *   path fills their ObjectRefs (non-target, non-ordered pick lifecycle).
 * - the printed "equipped friendly unit" restriction needs an equipped
 *   predicate that the merged ObjectFilter does not have: the production
 *   translator rejects `equipped`, and layers/filter.ts ignores unknown keys,
 *   which would make every friendly unit a legal choice.
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
    "「Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit.」已用 " +
    "object-attribute 表达式表达，effect.damage 的 amount/source 都读取 pick 结果，golden 通过参考内核真实执行；" +
    "effect.detach 也已合入并按 linkedTo 处理。仍不能标 executable 的当前缺口：(1) Chain Finalize 只为 " +
    "instruction.targets 生成 TargetPlan，finalizeOrderedPickPlans 也只会锁定声明 zoneSlice/linked 的 pick；本卡两个 " +
    "filter 驱动的 pick 实测得到空计划，没有填充 ObjectRef 的生产生命周期（非目标、非有序 pick）；" +
    "(2)「equipped friendly unit」需要 ObjectFilter 的 equipped 谓词：programs/filters.ts 拒绝该字段，" +
    "layers/filter.ts 又忽略未知键，缺了它会让任意友方单位都成为合法选择；" +
    "(3) detach 的 Equipment 选择同样依赖该 pick 生命周期。把 Choose 误建成 TargetSpec 会错误触发成为目标效果（v1.5 355.10），" +
    "故不近似实现。",
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
