import type { CardProgram } from "../../ir/index.js";

/**
 * ambessa-respected-and-feared — M2 源码复核（2026-10-18）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 1 Energy + 2 Order Power。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 *
 * status = judge-required（四处当前缺口，均为实测，不近似实现）：
 * 1. 印刷费用没有载体：KeywordAbility 只有 keyword/value，programs/keywords.ts 的
 *    expandProgram 因此调 Empower.expand 时拿不到 params.cost，产出
 *    { kind: "empower" }；实测生产 buildCostPlan 对该 kind 抛
 *    CostPlanError('Unsupported cost kind: empower')，1 Energy + 2 Order Power 付不出去。
 * 2. Empowered 状态：本卡用 object-property(self, "empowered") 门控，实测该条件在参考
 *    内核路径上可求值（Empower 后授予 Assault 2），但 ObjectSnapshot 契约没有 empowered
 *    字段，engine-runtime/host.ts 也不提供；442.1.b/c 的二元状态限制没有统一生产适配。
 * 3. 关键词重展开已有独立的 KeywordGrantLayerEngine adapter：它会把 granted Assault 2
 *    与 combatRole/designation 别名接起来并真实计算攻击者 Might；但默认
 *    attachProgramLifecycle 仍使用基础 LayerEngine，卡牌授予不会进入生产重展开路径，
 *    所以这段孤立 adapter 证据不能把整卡升为 executable。
 * 4. 攻击触发的目标选择无法绑定：translateInstructionTargets 实测抛
 *    ProgramBindingError('Unsupported filter field sameLocationAs')，355.9/355.10.g 的
 *    “此处 Might 更低的敌方单位” 无法生产；攻击时点本身也没有发射方（466.2 的
 *    combat-start-transaction 仍阻断 combat/flow.ts）。
 */
export default {
  canonicalCardId: "card.hash-e8af5c2839945839572f9122c2803fdda719845f1a7356eca006d791891545cd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口（2026-10-18 复核，均为实测）：(1) 827.1.c.1 的 1 Energy + 2 Order Power 印刷费用没有载体——" +
    "KeywordAbility 只有 keyword/value，expandProgram 调到 Empower.expand 时拿不到 params.cost，实测产出 { kind: \"empower\" }，" +
    "生产 buildCostPlan 对该 kind 抛 CostPlanError('Unsupported cost kind: empower')。" +
    "(2) 442.1.a/828.1.b.1 的 Empowered 门控：卡牌用 object-property(self, \"empowered\")，实测在参考内核路径上可求值（Empower 后授予 Assault 2），" +
    "但 ObjectSnapshot 契约没有 empowered 字段、engine-runtime/host.ts 也不提供，442.1.b/c 的二元状态限制没有统一生产适配。" +
    "(3) 807.1.c 的授予重展开已有独立 KeywordGrantLayerEngine adapter，可在隔离图层中把 Assault 2 " +
    "按 combatRole/designation 计算攻击者 Might；但默认 attachProgramLifecycle 仍使用基础 LayerEngine，" +
    "生产卡牌授予不会进入该重展开路径，不能把 adapter 子集证据当作整卡 executable。" +
    "(4) 828.1.b.1 的攻击触发目标无法绑定：translateInstructionTargets 实测抛 ProgramBindingError('Unsupported filter field sameLocationAs')，" +
    "355.9/355.10.g 的此处 Might 更低敌方单位不可生产；attack-declared 也没有发射方（combat/flow.ts 仍以 " +
    "TurnCombatBlockedError('combat-start-transaction') 阻断，466.2）。不近似实现。",
  abilities: [
    {
      // 印刷费 1 Energy + 2 Order Power 见 judgeReason；不伪造启动能力。
      kind: "keyword",
      keyword: "empower"
    },
    {
      // [Empowered][>] I have [Assault 2]：828.1.b.1 的依赖能力只在宿主 Empowered 时
      // 授予 Assault 2（807.1.c）；关键词本体由已合入的 Assault KeywordDef 展开。
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "assault",
        value: { kind: "constant", value: 2 },
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: {
          kind: "object-property",
          object: "self",
          property: "empowered"
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    {
      // [Empowered][>] When I attack, kill an enemy unit here with less Might
      // than me.（828.1.b.1 的依赖能力 + 383.4.e 攻击触发）
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        condition: {
          kind: "compare",
          left: { kind: "object-property", object: "self", property: "empowered" },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "ambessa.kill-weaker-enemy-here",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "ambessa.enemy-unit-here" } },
          targets: [
            {
              id: "ambessa.enemy-unit-here",
              // “an enemy unit here”：同一战场上的敌方单位（355.9/355.10.g）。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: "self",
                exclude: "self"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          // “with less Might than me”：结算时比较目标当前 Might 与宿主 Might。
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "ambessa.enemy-unit-here" },
              property: "might"
            },
            operator: "lt",
            right: {
              kind: "object-property",
              object: "self",
              property: "might"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Empower] :rb_energy_1::rb_rune_order::rb_rune_order: " +
    "(:rb_energy_1::rb_rune_order::rb_rune_order:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Assault 2]. (+2 :rb_might: while I'm an attacker.)\n" +
    "[Empowered][>] When I attack, kill an enemy unit here with less Might than me."
} satisfies CardProgram;
