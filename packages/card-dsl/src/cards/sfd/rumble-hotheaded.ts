import type { CardProgram } from "../../ir/index.js";

/**
 * Rumble, Hotheaded (sfd-026-221) — Rumble SFD precon unit (chosen champion).
 *
 * Your Mechs each have [Assault]. (+1 [M] while they're attackers.)
 * When I conquer, you may recycle another friendly unit to play a Mech from
 * your trash. Reduce its Energy cost by the Might of the unit you recycled.
 *
 * Ability 1 is a static ability-layer grant: every friendly Mech gains the
 * Assault keyword (CR v1.5 807, valued, default 1 per 807.1.b.3). The
 * continuous.grant-keyword layer and the Assault keyword expansion are owned
 * by RIFT-91 (layers-continuous) and RIFT-81 (kw-assault-shield).
 *
 * Ability 2 triggers when this unit conquers (timing point "conquer",
 * payload filter role "self"). The recycle instruction targets another
 * friendly unit (417.6 treats named-object recycles as targets; effect.recycle
 * links the recycled refs and their count). The play instruction then plays a
 * Mech from the controller's trash. The Energy discount travels on the
 * effect.play cost argument in the frozen FinalizedCostPlan shape
 * ({ finalized: true, energy: <linked recycled-unit Might> }); computing the
 * printed cost minus that Might and materializing the plan is the
 * cost.modify / cost-plan work tracked as RIFT-89.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺少已注册的 continuous.grant-keyword 持续效果原语（契约 3.7 / RIFT-9 清单中的 continuous.keyword，" +
    "用于「Your Mechs each have [Assault]」）；效果期间的 Energy 减费需要 cost.modify / 费用计划生成" +
    "（RIFT-89）把「减少量为被回收单位的 Might」落实为 finalized cost plan。" +
    "依赖：RIFT-91（layers-continuous 持续效果层）、RIFT-81（kw-assault-shield 关键词展开）、RIFT-89（batch3-cost-plan）。",
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
