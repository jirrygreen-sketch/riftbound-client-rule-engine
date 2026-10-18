import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * ambessa-the-wolf — M2 源码复核（2026-10-17）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 3 Energy + 1 Body Power。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */
const abilities: Ability[] = [
  {
    // 印刷费 3 Energy + 1 Body Power 见 judgeReason；不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>] 的 “I have +3 :rb_might:”：算术层 Might 增加（479.4.e.1）。
    // 828.1.c：依赖门槛读取真实 empowered 计数；测试覆盖获得与失去状态。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 3 }
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
    // “can't be dealt damage unless I'm in combat”：按宿主的 combatRole
    // 匹配战斗外状态（369.1/369.2/438.7）。空 with 表示事件被替换为不发生的动作
    //（同 ogn-189-298 Kayn, Unleashed 的写法）；不能把伤害动作的 combat 标记
    // 当作“我正在战斗中”的宿主身份。
    kind: "replacement",
    replaces: {
      event: "damage",
      filter: {
        // “dealt damage to me”：受伤害者是本卡自身（359.3.f 的来源指代）。
        target: "self",
        // “…unless I'm in combat”：只有宿主没有战斗身份时才防止伤害。
        characteristics: { combatRole: null }
      }
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
    },
    with: []
  }
];

export default {
  canonicalCardId: "card.hash-e8452b3b9f2d2d608a43289045ddea899510d5650e10a3ffaf7066b5484d0f49",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "827.1.c.1 的 3 Energy + 1 Body Power 印刷费用缺 KeywordAbility.params.cost → expandProgram → Empower.expand 接线；ObjectSnapshot 尚未声明 empowered（442.1.a），统一生产 Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通；828.1.b.1 的 continuous.might 与 bindReplacement 条件已使用真实 empowered 计数；438.7 的战斗外伤害防止仍缺 combat/flow.ts 的 466.2 原子战斗指定事务（combat-start-transaction），生产链路未写入 attacker/defender combatRole，无法确定战斗例外。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3::rb_rune_body: (:rb_energy_3::rb_rune_body:: Empower me. " +
    "Use only if not Empowered.)\n" +
    "[Empowered][>] I have +3 :rb_might: and can't be dealt damage unless I'm in combat."
} satisfies CardProgram;
