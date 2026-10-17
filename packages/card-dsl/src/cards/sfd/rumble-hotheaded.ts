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
 * turn/flow.ts emits in the Score wave). The recycle instruction targets
 * another friendly unit (417.6 treats named-object recycles as targets;
 * effect.recycle links the recycled refs and their count). The play
 * instruction then plays a Mech from the controller's trash. The Energy
 * discount travels on the effect.play cost argument in the frozen
 * FinalizedCostPlan shape, but computing the printed cost minus the recycled
 * unit's Might is the cost.modify / cost-plan work tracked as RIFT-89.
 *
 * Status: judge-required. Both halves have merged building blocks but neither
 * clause can run as printed, and nothing is approximated:
 * - Ability 1: continuous.grant-keyword registers an ability-layer keyword
 *   grant, but the registration path is still a caller-supplied
 *   ProgramStaticBinder callback (programs/statics.ts defaults to noop, and no
 *   production caller passes one that turns a CardProgram static ability into a
 *   ContinuousEffectSpec). Even registered, the granted keyword needs the
 *   Assault expansion's attacker designation, which ObjectSnapshot still lacks
 *   (contract 3.8 declares combatRole; layers/engine.ts conditionMatches does
 *   not evaluate the expansion's compare condition and returns true for an
 *   unknown kind, so the +1 Might would apply unconditionally).
 * - Ability 2: the trigger body needs the Finalize-time discount. cost.pay /
 *   cost.modify exist as instructions only on an unmerged branch (RIFT-261); the
 *   merged cost path consumes a caller-supplied CostPlanInput and its
 *   `discounts`, and programs/play.ts translateCost rejects a raw
 *   FinalizedCostPlan value in the card's `cost` field. The linked
 *   recycledMight key the program reads also does not exist: effect.recycle
 *   links recycled / recycledCount, not the recycled unit's Might.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两半都有已合入构件，但都还跑不起来，且不近似实现：" +
    "(1)「Your Mechs each have [Assault]」——RIFT-258 的 continuous.grant-keyword 与 RIFT-81 的 Assault 展开都已合入，" +
    "但注册路径仍是调用方提供的 ProgramStaticBinder 回调（programs/statics.ts 默认 noop，生产路径没有调用者把 " +
    "CardProgram static 能力注册成 ContinuousEffectSpec）；即便注册，Assault 展开的 +1 Might 依赖 attacker designation" +
    "——ObjectSnapshot 只有契约 3.8 的 combatRole，" +
    "layers/engine.ts 的 conditionMatches 不求值展开的 compare 条件（未知 kind 返回 true）。" +
    "(2)「Reduce its Energy cost by the Might of the unit you recycled」——减费要在 Finalize 落实为 finalized cost plan；" +
    "cost.pay/cost.modify 只在未合入的 RIFT-261 分支上，已合入的费用管线只消费调用方给的 CostPlanInput 及其 discounts，" +
    "programs/play.ts 的 translateCost 也会拒绝把 FinalizedCostPlan 当作卡牌 cost 字段；程序读取的 recycledMight 链接值不存在" +
    "（effect.recycle 只写 recycled/recycledCount）。conquer 时点本身已由 turn/flow.ts 的计分波发出。" +
    "依赖：RIFT-261（cost.modify/费用计划）、卡牌 static/trigger 注册消费方（RIFT-257 后续）、attacker designation 与图层条件求值。",
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
