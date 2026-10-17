import type { CardProgram } from "../../ir/index.js";

/**
 * aurok-general — M2 源码复核（2026-10-17）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 3 Energy + 1 Order Power。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-74533231e291deb55f594e5f04b19faf248214fac82769433d2d3387166f0bad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "827.1.c.1 的 3 Energy + 1 Order Power 印刷费用缺 KeywordAbility.params.cost → expandProgram → Empower.expand 接线；ObjectSnapshot 尚未声明 empowered（442.1.a），统一生产 Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通；828.1.b.1 的来源门控已用 empowered 比较；continuous.might 的作用对象仍缺 empowered > 0 的动态过滤，programs/statics.ts 拒绝 filter.empowered，而简单 characteristics 等值过滤不能覆盖 442.1.c.1 的多次 Empower 单位。不能将光环放宽为所有友方单位。",
  abilities: [
    {
      // 印刷费 3 Energy + 1 Order Power 见 judgeReason；不伪造启动能力。
      kind: "keyword",
      keyword: "empower"
    },
    {
      // [Empowered][>] 的依赖能力：Empowered 状态门槛（442.1.a / 828.1.b.1）与
      // 图层算术修正（479、contract 3.4）。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 2 },
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          empowered: true
        }
      },
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "empowered" },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "[Empower] :rb_energy_3::rb_rune_order: (:rb_energy_3::rb_rune_order:: Empower me. " +
    "Use only if not Empowered.)\n[Empowered][>] Your units that are [Empowered] have " +
    "+2 :rb_might: (including me)."
} satisfies CardProgram;
