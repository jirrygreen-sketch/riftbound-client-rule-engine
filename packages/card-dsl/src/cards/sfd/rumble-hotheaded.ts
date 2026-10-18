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
 * continuous.grant-keyword and the Assault keyword expansion are both merged,
 * and the default static binder registers the aura for real. The merged
 * KeywordGrantLayerEngine now also consumes a runtime Assault and maps its
 * designation condition to combatRole; production lifecycle wiring remains
 * separate from that re-expander.
 *
 * Ability 2 triggers when this unit conquers (timing point "conquer", which
 * turn/flow.ts emits in the Score wave). The recycle instruction still has a
 * blocked target declaration: as a "to" cost it must instead make a non-target
 * choice (355.10.c.1). effect.recycle links recycled refs and their count. The play
 * instruction then plays a Mech from the controller's trash. The merged
 * cost.modify / cost.pay path really computes the discount (measured: base
 * energy 5, a 3-Might recycled unit yields plan.base.energy=5,
 * plan.discounts=[{amount:3,before:5,after:2}], plan.total.energy=2), but the
 * complete CostPlan has no flat top-level `energy` field, so effect.play's
 * finalized override is read as cost.energy ?? 0 (chain/engine.ts) and pays
 * silently zero. The missing piece is a CostPlan -> flat finalized-override
 * conversion primitive, not the discount calculation itself.
 *
 * Current review (re-checked 2026-10-18):
 * CR 383.4.c / 383.4.c.2.a: "When I conquer" requires this unit at the scored
 * battlefield; the conquer producer emits only { player, details: {
 * battlefieldId } }, so a source:self anchor cannot be evaluated (measured: the
 * registered spec is { event: "conquered", object: { objectId: <this card> } }
 * and never matches a real conquer emission).
 * CR 355.10.c.1: the recycled unit is a non-target cost within an instruction.
 * The programs translation layer rejects both relative anchors the printed
 * wording needs ("another friendly unit"): role:other-friendly and exclude:self
 * are measured "Unsupported filter field role/exclude" failures even though the
 * IR anchors exist. An explicit base=5 + linked-Might reduce modifier executes
 * for real (see above), so the discount math is available; only the plan-shape
 * conversion is missing.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处当前缺口，均不近似实现（复核 2026-10-18）：" +
    "(1)「Your Mechs each have [Assault]」的 continuous.grant-keyword 静态登记已真实生效；KeywordGrantLayerEngine 还能把运行时授予的 Assault 展开成" +
    "attacker-only Might，并把 designation 映射到 combatRole。production lifecycle 仍使用普通 LayerEngine，" +
    "不会在真实 card-program 路径中自动采用该 re-expander，但 Assault 规则消费本身已有独立执行证据。" +
    "(2)「When I conquer」（383.4.c/383.4.c.2.a）的触发已改用封闭判别值 conquered + source:self，可注册且通过 trigger-spec 校验，" +
    "但 turn/flow.ts 的 Score wave 只发 { player, details: { battlefieldId } }，没有本单位 object，" +
    "events/pipeline-match.ts 的 matchesTriggerObject 对 undefined object 仅在过滤器为空时命中，实测真实 conquer 发射恒不匹配，无法判定本单位在被征服战场。" +
    "(3) 回收作为「to」费用依 355.10.c.1 不应是目标：印文的「another friendly unit」需要相对锚（除本单位外），" +
    "当前 role:other-friendly 键被程序绑定 fail-closed 拒绝（实测 \"Unsupported filter field role\"），" +
    "IR 的 exclude 锚虽已存在，但 programs/filters.ts 的 translateObjectFilter 同样拒绝该键（实测 \"Unsupported filter field exclude\"）。" +
    "(4) cost.modify/cost.pay 均已合入且减费计算真实可执行（实测 explicit base=5、被回收单位 Might=3 时 " +
    "plan.base.energy=5、plan.discounts=[{amount:3,before:5,after:2}]、plan.total.energy=2）；" +
    "但完整 CostPlan 没有顶层扁平 energy 字段，effect.play 的 finalized 费用覆盖被 chain/engine.ts 按 " +
    "cost.energy ?? 0 读取，静默支付 0 费（实测 A 的能量保持 10）。缺的是完整 CostPlan 到扁平 " +
    "finalized override 的转换原语，不是减费运算本身；effect.recycle 也只链接 recycled 引用与 recycledCount，" +
    "不写 recycledMight 键，取 Might 需按引用自行求值。" +
    "依赖：production lifecycle 对运行时关键词 re-expander 的接线、conquer 发射的场地/对象身份、回收的非目标选择器，" +
    "以及 CostPlan → 扁平 finalized 费用覆盖的转换原语。",
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
