import type { CardProgram } from "../../ir/index.js";

/**
 * Temptation (sfd-129-221) — Spell, 2 energy, no printed power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-129-221, verbatim):
 *   "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    Move an enemy unit to a location where there's a unit with the same
 *    controller."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Repeat] :rb_energy_2:" (820.1.c) is an Optional Additional Cost: the
 *   printed component is declared on the play ability's CostSpec in the merged
 *   sfd/danger-zone / sfd/frigid-touch shape (356.2.b.1). The merged program
 *   binding (RIFT-257) does not collect it: programs/play.ts translateCost
 *   rejects kind "additional-cost" and the detached `keyword`/`additional`
 *   fields, so describePlay throws (verified by the golden). Cost-plan
 *   optionalAdditional exists but has no card-program producer (RIFT-261).
 * - "Move an enemy unit" is an effect Move (451, not the Standard Move of 144
 *   and not a Recall of 457/458): the named unit is chosen by the spell's
 *   controller in the public Board zone, so it is a Target (355.7 /
 *   355.9.a.1), and "enemy" is its targeting restriction (355.9.b).
 * - "to a location where there's a unit with the same controller" is the Move
 *   Destination: 355.4/355.4.a has the controller choose a valid Location other
 *   than the unit's current one, and the printed sentence restricts it to a
 *   Location whose occupants include another unit controlled by the moved
 *   unit's controller. Neither half is expressible today: the frozen IR cannot
 *   enumerate runtime-legal Locations (target.location), and the "same
 *   controller" occupant test needs a per-Location occupant query that does not
 *   exist in the merged selector vocabulary. The destination is therefore a
 *   documented descriptive marker (see below) which effect.move rejects instead
 *   of silently moving the unit somewhere invented.
 * - The spell has no [Action]/[Reaction] line: spells default to Action timing
 *   (159.2.a), so no speed keyword is declared.
 *
 * Status (cards/README.md §2): judge-required. Both clauses are blocked by
 * missing dependencies; nothing is approximated (no fixed destination is
 * substituted, and the printed [Repeat] cost is not executed twice by hand).
 * The CardProgram binding itself (RIFT-257) is merged; the remaining gaps are
 * the runtime Location destination (RIFT-90) and the Repeat additional-cost
 * collector (RIFT-261).
 */

/**
 * 描述性目的地标记，不是可执行 LocationRef：effect.move 的 destination() 只接受
 * base/battlefield 字面量、controller-base 或合法 LocationRef 候选列表，本形状会被直接
 * 拒绝（fail-closed），因此不会把单位移到错误地点。filter 记录印刷限制：目的地需有同一
 * 控制者的另一个单位（355.4.a 的合法性 + 355.9.b 的限制）。
 */
const DESTINATION_WITH_SAME_CONTROLLERS_UNIT = {
  kind: "destination-selector",
  filter: {
    anyUnitControlledByTheMovedUnitsController: true,
    exclude: { target: "temptation.enemy-unit" }
  }
} as const;

const temptation = {
  canonicalCardId: "card.hash-472f50f62c82089c0d50baa218635f3214bbef1e2eb24fc259ec1761a6a9eb19",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「to a location where there's a unit with the same controller」是效果移动的目的地" +
    "（CR 355.4 / 355.4.a：控制者在 Finalize 选择“除该单位当前位置外、且其被允许出现”的合法 Location），" +
    "而冻结 IR 无法枚举运行期 Location（target.location 未合入），effect.move 的 to 只接受静态 LocationRef / " +
    "controller-base / 静态合法候选列表；本卡只保留描述性目的地标记，原语会拒绝它而不是落到错误地点。" +
    "同时“存在同一控制者的单位”这一地点占用限制需要按 Location 查询占用者的谓词，合并过滤器词表没有该形态。" +
    "(2)「[Repeat] :rb_energy_2:」的可选追加费用没有收取/计数路径：卡牌程序绑定（RIFT-257）已合入，但 programs/play.ts 的 translateCost " +
    "对 additional-cost 与 keyword/additional 字段直接 judgeRequired（golden 在 describePlay 上实测抛错），费用计划里的 optionalAdditional 没有卡牌产出方（RIFT-261）。" +
    "被移动的敌方单位按 355.7 / 355.9.a.1 / 355.9.b 声明为目标，effect.move 本身已合入。依赖：RIFT-90（目标/目的地计划）、RIFT-261（Repeat 追加费用）。",
  abilities: [
    {
      kind: "play",
      cost: {
        // 印刷基础费用 2 Energy、无 Power 由卡牌身份在 Finalize 绑定（356.1.c）；
        // 这里只声明 [Repeat] :rb_energy_2:（820.1.c）的可选追加费用（无消费方，见 judgeReason）。
        kind: "additional-cost",
        keyword: "repeat",
        energy: { kind: "literal", value: 2 }
      },
      body: [
        {
          id: "temptation.move-enemy-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "temptation.enemy-unit" }
            },
            // 描述性目的地（见上方说明）：effect.move 会拒绝它，绝不猜测目的地。
            to: { kind: "constant", value: DESTINATION_WITH_SAME_CONTROLLERS_UNIT },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "temptation.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
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
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Move an enemy unit to a location where there's a unit with the same controller."
} satisfies CardProgram;

export default temptation;
