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
 *   a characteristic set query. The destination is chosen in Finalize per
 *   355.4 (a valid Location other than the unit's current one), so the program
 *   records the destination as the merged primitive's "choose" shape with a
 *   runtime-derived option set (the effect.move contract: "options is a
 *   nonempty list of legal LocationRefs from target.location") and deliberately
 *   does NOT pin a concrete location — naming one would be making the player's
 *   choice for them.
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
 * primitives and are executed in the golden test, and the [Action] timing
 * grant is now consumed by the merged layers/rules query (RIFT-259:
 * actionTimings / canAct decide the off-turn Showdown admission from the
 * registration). The card as a whole is still not executable: choosing the
 * Move destination is a Finalize-time choice for the spell's controller
 * (355.4 / 355.4.a). The chain's current Finalize surface only finalizes
 * "instruction.targets" TargetSpecs and blocks nested/repeated targets
 * (chain/engine.ts assertFinalizationSurface), and the interpreter's
 * "effect.move" destination argument is a fixed Expr (controller-base, a
 * LocationRef, or a { kind: "choose", options } location list) with no merged
 * provider turning "any legal Location other than the current one" into that
 * list. That lifecycle is the chain/target Finalize work (RIFT-84 / RIFT-90);
 * until it lands the card stays judge-required and the golden test supplies
 * the destination the acting player chose, the same way it supplies
 * Finalize-locked targets.
 */
const rideTheWind = {
  canonicalCardId: "card.hash-2df39111dd690c251a044601ce12b0c17ee57b43f9d29ce2de47654b25a9110c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「Move 目标地点」的 Finalize 选择生命周期：CR 355.4/355.4.a 要求由法术控制者选择该单位当前地点以外的合法 Location，" +
    "而链的 Finalize 目前只处理 instruction.targets 的 TargetSpec，且禁止嵌套/重复目标（chain/engine.ts assertFinalizationSurface），" +
    "解释器侧 effect.move 的 to 只是固定 Expr（controller-base / LocationRef / { kind: choose } 列表）：没有已合入机制把「除当前地点外的任意合法地点」变成该 Expr，" +
    "写死一个地点就是替玩家发明选择。另一处旧缺口已解决：[Action] 时机许可现由 layers/rules query 消费（RIFT-259，actionTimings/canAct 可判定 off-turn Showdown 许可）。" +
    "Move 与 ready 两条指令本身只用已合入原语表达并有执行测试（含 359.3.e.14.b 的 Move 被 negate 后 ready 仍执行）；依赖 RIFT-84/RIFT-90 的地点选择与 Finalize 生命周期。",
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
