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
 * (RIFT-81) are both merged, and the default static binder registers the aura
 * for real: measured, a friendly Mech ends up with keywords
 * [{ id: "Assault", value: 1 }]. What is still missing is the consumption half —
 * a runtime-granted keyword is not expanded into the arithmetic Might layer, so
 * the same Mech keeps its printed Might (measured 3, not 4), and the Assault
 * expansion's own designation condition is not on a path that reads combatRole.
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
 * Current review (re-checked 2026-10-17):
 * CR v1.5 807.1.c/.d.1: granted Assault still needs runtime Might consumption.
 * CR 383.4.c / 383.4.c.2.a: "When I conquer" requires this unit at the scored
 * battlefield; the conquer producer emits only { player, details: {
 * battlefieldId } }, so a source:self anchor cannot be evaluated (measured: the
 * registered spec is { event: "conquered", object: { objectId: <this card> } }
 * and never matches a real conquer emission).
 * CR 355.10.c.1: the recycled unit is a non-target cost within an instruction;
 * effect.recycle links recycled refs and their count, never a Might value, so the
 * printed discount has no source and the nested Mech play cost plan stays
 * unbound.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处当前缺口，均不近似实现（复核 2026-10-17）：" +
    "(1)「Your Mechs each have [Assault]」的静态登记已真实生效——默认 static binder 把 continuous.grant-keyword 写进 ability 层，" +
    "实测友方 Mech 的 keywords 变为 [{ id: 'Assault', value: 1 }]（CR v1.5 807、807.1.b.3）；" +
    "但运行时授予的关键词没有展开成算术 Might（实测该 Mech Might 仍为印刷值 3），且 Assault 展开自带的 designation 条件不在读取 combatRole 的求值路径上（807.1.c/.d.1）。" +
    "(2)「When I conquer」（383.4.c/383.4.c.2.a）的触发已改用封闭判别值 conquered + source:self，可注册且通过 trigger-spec 校验，" +
    "但 turn/flow.ts 的 Score wave 只发 { player, details: { battlefieldId } }，没有本单位 object，" +
    "events/pipeline-match.ts 的 matchesTriggerObject 对 undefined object 仅在过滤器为空时命中，实测真实 conquer 发射恒不匹配，无法判定本单位在被征服战场。" +
    "(3) 回收作为「to」费用依 355.10.c.1 不应是目标：印文的「another friendly unit」需要相对锚（除本单位外），" +
    "当前 role:other-friendly 键被程序绑定 fail-closed 拒绝（实测 \"Unsupported filter field role\"），" +
    "IR 的 exclude 锚虽已存在，但 programs/filters.ts 的 translateObjectFilter 同样拒绝该键（实测 \"Unsupported filter field exclude\"）。" +
    "(4) cost.modify/cost.pay 均已合入，但 effect.recycle 只链接 recycled 引用与 recycledCount，不给出被回收单位的 Might；" +
    "因此减费计划缺取值时点，Mech 的真实印刷费用与嵌套 effect.play Finalize 的绑定（356/357）也不存在，" +
    "不能把 recycled/recycledCount 当作不存在的 recycledMight。" +
    "依赖：运行时授予关键词的 Might 消费、conquer 发射的场地/对象身份、回收的非目标选择器，以及嵌套打出减费计划。",
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
        // 383.4.c.2.a: this Unit's own Conquer Ability. The closed
        // EventPattern discriminant for the conquer timing point is
        // "conquered" (EVENT_PATTERN_TYPES; pipeline-match maps it to conquer),
        // and the object anchor is this card. The runtime emission still carries
        // only { player, details: { battlefieldId } }, so the anchor cannot match
        // yet (judgeReason).
        filter: { event: "conquered", filter: { source: "self" } }
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
