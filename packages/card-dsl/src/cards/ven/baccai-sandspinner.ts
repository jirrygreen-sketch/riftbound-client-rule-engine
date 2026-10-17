import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * baccai-sandspinner — M2 源码复核（2026-10-17）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 5 Energy。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 具体规则与剩余阻塞见 judgeReason；执行证据在
 * templates/keyword-static-static-673.test.mjs，局部执行不代表整卡可执行。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 5
  },
  {
    // 827.1.c.3 / 206.1：这条文本改写的正是该 Empower 起动费用，不是独立效果。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "empower-activation-cost",
      amount: { kind: "constant", value: -3 },
      // 356.6：Energy 费用不能被减到 0 以下；具体钳制由费用计划执行。
      minimum: 0
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "runes",
        filter: { type: "rune", controller: "self", zone: "rune-zone" }
      },
      operator: "lte",
      right: { kind: "constant", value: 4 }
    }
  },
  {
    // 828.1.b.1 / 828.1.c：宿主拥有 Empowered 状态时获得 [Deflect] 与 [Assault 2]。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [
        { id: "deflect", value: 1 },
        { id: "assault", value: 2 }
      ]
    },
    // 828.1.c：依赖能力读取来源实时 empowered 计数。
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-43ef38def4a837781a4013a179db99f1eb1e312f85de8d9c3053f7168a1652f5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "827.1.c.1 的 5 Energy 印刷费用缺 KeywordAbility.params.cost → expandProgram → Empower.expand 接线；ObjectSnapshot 尚未声明 empowered（442.1.a），统一生产 Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通；827.1.c.3 的 continuous.cost-modification 尚无 empower-activation-cost → 费用计划接线，控制 4 或更少符文时的减 3 Energy 不能应用；count.filter.controller:self 尚无相对玩家求值，不能用测试内符号替换证明生产条件已实现。828.1.c 的 continuous.grant-keyword 已用 empowered 比较门控；授予的 Assault 2 仍缺展开与攻击者 designation/combatRole 接线（807.1.c），Deflect 的真实 Power 目标税适配器尚未进入 Chain Finalize，chain/engine.ts 仍把税写为 Energy（809.1.c）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_5:. This ability costs :rb_energy_3: less if you control 4 or fewer runes. " +
    "(Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Assault 2]. (Opponents must pay :rb_rune_rainbow: to choose me " +
    "with a spell or ability. +2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;
