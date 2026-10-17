import type { CardProgram } from "../../ir/index.js";

/**
 * Rumble, Hotheaded (sfd-026-221) — Rumble SFD precon unit (chosen champion).
 *
 * Your Mechs each have [Assault]. (+1 [M] while they're attackers.)
 * When I conquer, you may recycle another friendly unit to play a Mech from
 * your trash. Reduce its Energy cost by the Might of the unit you recycled.
 *
 * Ability 1 is a static ability-layer grant: every friendly Mech gains the
 * Assault keyword (CR v1.5 807, valued, default 1 per 807.1.b.3).
 * continuous.grant-keyword (RIFT-258) and the Assault keyword expansion
 * (RIFT-81) are both merged.
 *
 * Ability 2 triggers when this unit conquers (timing point "conquer", which
 * turn/flow.ts emits in the Score wave). The recycle instruction still has a
 * blocked target declaration: as a "to" cost it must instead make a non-target
 * choice (355.10.c.1). effect.recycle links recycled refs and their count. The play
 * instruction then plays a Mech from the controller's trash. The Energy
 * discount travels on the effect.play cost argument in the frozen
 * FinalizedCostPlan shape, but binding the recycled Might snapshot into the nested Mech play Finalize
 * plan remains blocked even though cost.modify / cost.pay are merged.
 *
 * Current review:
 * CR v1.5 807.1.c/.d.1: granted Assault still needs runtime Might
 * consumption. CR 383.4.c: Conquer requires this unit at the scored battlefield.
 * CR 355.10.c.1: the recycled unit is a non-target cost within an instruction.
 * cost.modify/cost.pay and static binding are merged, but the recycled Might
 * snapshot and the nested Mech play Finalize cost plan remain unbound.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Your Mechs each have [Assault]」可由默认 static binder 登记 continuous.grant-keyword，但运行时授予的 Assault 未进入 KeywordDef 展开/攻击者 Might 消费，且现有展开的 designation 与 combatRole 尚未对齐（CR v1.5 807.1.c/.d.1）。「When I conquer」事件只有 player/details.battlefieldId，无本单位 object，当前 role:self 过滤不能判定本单位在被征服战场（383.4.c）；回收作为「to」费用依 355.10.c.1 不应是目标，当前 role:other-friendly 也无法翻译。cost.modify/cost.pay 均已合入；仍缺被回收单位 Might 的费用取值时点、Mech 的真实印刷费用/减费计划与嵌套 effect.play Finalize 的绑定（356/357），不能把 recycled/recycledCount 当作不存在的 recycledMight。依赖：授予 Assault 的消费、conquer 场地身份、回收非目标费用与嵌套打出减费计划。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Assault",
        value: { kind: "constant", value: 1 },
        filter: {
          zone: "board",
          controller: "controller",
          tag: "Mech",
          type: "unit"
        }
      }
    },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", filter: { role: "self" } }
      },
      optional: true,
      body: [
        {
          id: "rumble.recycle-fodder",
          op: "effect.recycle",
          args: {
            target: { kind: "constant", value: "rumble.fodder" }
          },
          targets: [
            {
              id: "rumble.fodder",
              filter: {
                zone: "board",
                controller: "controller",
                type: "unit",
                role: "other-friendly"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "rumble.play-mech",
          op: "effect.play",
          linkedTo: "rumble.recycle-fodder",
          args: {
            target: { kind: "constant", value: "rumble.mech-in-trash" },
            cost: {
              kind: "constant",
              value: {
                finalized: true,
                energy: {
                  kind: "linked-value",
                  instructionId: "rumble.recycle-fodder",
                  key: "recycledMight"
                }
              }
            }
          },
          targets: [
            {
              id: "rumble.mech-in-trash",
              filter: {
                zone: "trash",
                owner: "controller",
                tag: "Mech",
                type: "unit"
              },
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
    "Your Mechs each have [Assault]. (+1 :rb_might: while we're attackers.)\nWhen I conquer, you may recycle another friendly unit to play a Mech from your trash. Reduce its Energy cost by the Might of the unit you recycled."
} satisfies CardProgram;
