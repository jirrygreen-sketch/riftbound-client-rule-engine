import type { CardProgram } from "../../ir/index.js";

/**
 * ambessa-respected-and-feared — M2 源码复核（2026-10-17）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 1 Energy + 2 Order Power。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-e8af5c2839945839572f9122c2803fdda719845f1a7356eca006d791891545cd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "827.1.c.1 的 1 Energy + 2 Order Power 印刷费用缺 KeywordAbility.params.cost → expandProgram → Empower.expand 接线；ObjectSnapshot 尚未声明 empowered（442.1.a），统一生产 Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通；828.1.b.1 的 continuous.grant-keyword 与攻击触发已用 empowered 比较门控；仍缺授予 Assault 2 后的展开接线及 designation → combatRole 的攻击者读数（807.1.c），translateInstructionTargets 也不能绑定 sameLocationAs/exclude，无法生产选择此处 Might 更低的敌方单位（355.9/355.10.g）。",
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
