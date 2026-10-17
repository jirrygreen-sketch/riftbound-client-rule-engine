import type { CardProgram } from "../../ir/index.js";

/**
 * Unforgiven (ogn-259-298) — Legend, Calm/Chaos, tag Yasuo.
 *
 * Printed text:
 *   :rb_energy_2:, :rb_exhaust:: Move a friendly unit to or from your base.
 *
 * Structure (contract 3.1/3.2):
 * - activated ability, action timing, cost = 2 energy + exhaust this legend
 *   (the :rb_exhaust: symbol is the exhaust payment kind, CR 415.5);
 * - "a friendly unit" is a target (CR 355.5, 355.10: a unit you control on the
 *   Board, 355.9.a.1), declared as a TargetSpec on the move instruction;
 * - "to or from your base" is ONE Move instruction whose destination is chosen
 *   at Finalize from the legal locations (CR 355.4: choose a valid Location as
 *   the Move Destination; 451.1: the Move source provides destination
 *   restrictions; 449.1/449.2 define Origin/Destination). The printed text does
 *   not add a mode: the direction follows from where the unit currently is.
 *
 * Status: judge-required (re-reviewed 2026-10-17). The merged effect.move
 * executes the to-base half on the production chain path, but the frozen IR
 * cannot express a resolution-time destination set:
 * - effect.move accepts only a static LocationRef, "controller-base", or a
 *   static `{kind:"choose", options}` list of concrete locations. The merged
 *   target.location/queryLocationCandidates path can find legal locations for
 *   target finalization, but effect.move cannot consume that dynamic set or
 *   derive the printed "to or from" direction from the selected unit's current
 *   location. The one authored instruction therefore declares the printed
 *   target and the "controller-base" destination only (exact while the unit is
 *   at a Battlefield); the "from base" half is not fabricated.
 * - the merged primitive also cannot tell whether the chosen destination is the
 *   unit's own Base (task-text "your base" is ambiguous in teammate games, see
 *   the data issue below), so the whole card cannot be claimed executable even
 *   for the to-base reading.
 *
 * Data issue (not modified here): ogn-259-298 prints "your base" while
 * ogn-305-298 and the star printing print "its base" (survey unclassified-ogn
 * §37). The two are not equivalent in multiplayer/teammate games; this program
 * uses the task-specified main-printing text verbatim.
 */
const program = {
  canonicalCardId:
    "card.hash-6c69039e3668542be770179f1820017af14307a2e3e79a1c71a35edc3e408061",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Move a friendly unit to or from your base」是一个 Move 指令，目的地按 CR 355.4/451.1 在 Finalize 时从当前合法地点集合中选定" +
    "（单位在 Battlefield 时选其基地、在基地时选合法 Battlefield，449.1/449.2）。已合入的 effect.move 能执行 to-base 半段" +
    "（golden 经生产链适配器执行整条 body，单位从战场移到其基地）；当前 target.location/queryLocationCandidates 能为目标选择枚举合法地点，" +
    "但 effect.move 仍只接受静态 LocationRef / controller-base / 静态 options，缺少把动态地点集合交给 Move 并从单位当前位置推导方向的机制，" +
    "本卡只写印刷的目标声明与 controller-base 目的地，不为 from-base 方向伪造语义。" +
    "数据问题：主印刷 ogn-259-298 为 \"your base\"，ogn-305-298/star 为 \"its base\"（survey unclassified-ogn 第 37 条），队友场景不等价，本程序按任务指定的主印刷原文编写。" +
    "依赖：effect.move 的动态 LocationSelector/Finalize 目的地接线与 \"your base\" 的多人语义裁定。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        energy: { kind: "constant", value: 2 },
        payments: [{ kind: "exhaust" }]
      },
      body: [
        {
          id: "unforgiven.move",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "unit" } },
            // "to or from your base": while the unit is at a Battlefield this
            // destination is exact; the "from base" direction needs the legal
            // Battlefield set (target.location) and is covered by the TODO
            // below. The plain Move is the printed instruction; activation of
            // the ability is itself the player's choice, so no extra
            // choice.optional wrapper is added.
            to: { kind: "constant", value: "controller-base" }
          },
          targets: [
            {
              id: "unit",
              filter: { type: "unit", controller: "controller", zone: "board" },
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
    ":rb_energy_2:, :rb_exhaust:: Move a friendly unit to or from your base."
} satisfies CardProgram;

export default program;
