import type { CardProgram } from "../../ir/index.js";

/**
 * Ride the Wind (ogn-173-298) — Spell, 2 energy + 1 Chaos Power, Chaos.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Move a friendly unit and ready it.
 *
 * Structure (contract 3.1 / 3.2, Core Rules v1.5):
 * - "action" keeps the printed [Action] keyword (806; 159.2.a); its
 *   "continuous.timing" expansion and the chain admission are owned by the
 *   keyword registry and chain/ (contract 3.7).
 * - "Move a friendly unit" is one "effect.move" instruction (451) targeting a
 *   unit the controller controls. "a friendly unit" is a choice of a specific
 *   game object (355.7 / 355.9.b, "unit you control"), i.e. a TargetSpec, not
 *   a characteristic set query. The LocationTargetSpec / LocationSelector /
 *   candidate-query machinery for the destination is merged (RIFT-357), but
 *   this card still needs its Finalize binding, a predicate that excludes the
 *   selected unit's current Location (355.4.a), and a producer that supplies
 *   the legal destination set to effect.move. The program therefore keeps the
 *   destination as reviewable data and does not pin a concrete location.
 * - "and ready it": the same chosen unit is read back with the ObjectSelector
 *   { target: "ride-the-wind.friendly-unit" }, so the ready applies to the unit
 *   the Move was performed on ("it"). The two instructions are NOT linked with
 *   "linkedTo": CR 359.3.e.14.b spells this card out — if the Move is negated
 *   on resolution (its own example is Ride the Wind against Vilemaw's Lair),
 *   "the ready instruction will still execute" (359.3.e.14.c limits linked
 *   references to the action and its object). The golden test asserts exactly
 *   that negated-Move/executed-ready split.
 * - Printed cost (2 Energy plus 1 Chaos Power) is bound from the card identity
 *   at Finalize (356.1.c); the program declares no CostSpec instead of
 *   re-stating printed values.
 *
 * Status: judge-required — both instructions are expressible with merged
 * primitives and are executed in the golden test. The card as a whole is
 * still not executable: the Move destination is a Finalize-time choice for
 * the spell's controller (355.4 / 355.4.a). The remaining gaps are the
 * destination's Finalize binding, exclusion of the selected unit's current
 * Location, and the legal-destination producer (see judgeReason). Until those
 * are connected, the golden test supplies the destination the acting player
 * chose, the same way it supplies Finalize-locked targets.
 */
const rideTheWind = {
  canonicalCardId: "card.hash-2df39111dd690c251a044601ce12b0c17ee57b43f9d29ce2de47654b25a9110c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「Move 目标地点」的三个精确接线依赖：CR 355.4/355.4.a 要求由法术控制者选择该单位当前地点以外的合法 Location；" +
    "RIFT-357 已合入 LocationTargetSpec、LocationSelector、地点候选查询和地点 Expr，但本卡仍缺 (a) 将地点选择声明接入该 Move 的 Finalize 生命周期，" +
    "(b) LocationTargetSpec/候选查询中排除所选单位当前地点的谓词，及 (c) 把该单位的合法目的地集合供给 effect.move 的生产者。" +
    "因此不能写死一个地点替玩家发明选择。Move 与 ready 两条指令本身只用已合入原语表达并有执行测试（含 359.3.e.14.b 的 Move 被 negate 后 ready 仍执行）；" +
    "仍保持 judge-required，不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "ride-the-wind.move",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "ride-the-wind.friendly-unit" } },
            // 355.4：目的地由法术控制者在 Finalize 选择（该单位当前地点以外的合法
            // Location）。此处只记录原语的 choose 形状与描述性选项集，不写死地点；
            // 见 judgeReason。
            to: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "ride-the-wind.destination",
                options: ["legal-locations-other-than-the-units-current-location"]
              }
            }
          },
          targets: [
            {
              id: "ride-the-wind.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "and ready it"：独立语句，不用 linkedTo —— Move 被 negated 时 ready 仍执行
          // （CR 359.3.e.14.b 的 Ride the Wind 例）。
          id: "ride-the-wind.ready",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "ride-the-wind.friendly-unit" }
            },
            amount: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Move a friendly unit and ready it."
} satisfies CardProgram;

export default rideTheWind;
