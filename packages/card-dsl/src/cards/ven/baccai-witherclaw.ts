import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * baccai-witherclaw — M2 源码复核（2026-10-17）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 1 Energy + 两个 :rb_rune_rainbow: 任意域 Power。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */

/** 442.1.a / 828.1.c / 727.1.b.3：Empowered 门槛（读取真实状态计数）。 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empowered" },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

const abilities: Ability[] = [
  {
    // 印刷费 1 Energy + 两个 [A] Power 见 judgeReason；KeywordAbility 没有承载费用
    // 的字段，不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>]「I have +2 :rb_might:」（143.2.a 的算术图层修正）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      appliesTo: "self"
    },
    condition: empoweredGate
  },
  {
    // [Empowered][>>][Deathknell][>] 的依赖能力：727.1.b.3 要求 Empowered 条件成立时
    // 该 Deathknell 才 Active；condition 保留死亡时点的 Empowered 门槛。
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { self: true, cause: "kill", destination: "trash" },
      condition: empoweredGate
    },
    optional: false,
    body: [
      {
        // 431.1 / 431.2：“Channel 2 runes exhausted”。
        id: "baccai-witherclaw.channel-2-exhausted",
        op: "effect.channel",
        args: {
          amount: { kind: "constant", value: 2 },
          exhausted: { kind: "constant", value: true }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-3a9686028c1c8883834ec636779521dcd144e90d07dbc34d923dc7533699ba4d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "827.1.c.1 的 1 Energy + 两个 :rb_rune_rainbow: 任意域 Power 印刷费用缺 KeywordAbility.params.cost → expandProgram → Empower.expand 接线；ObjectSnapshot 尚未声明 empowered（442.1.a），统一生产 Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通；727.1.b.3/727.1.c.1 的 continuous.might 与死亡时 Empowered 门控已使用真实 empowered 计数；但 translateTriggerFilter 仍丢弃 cause/destination，object-killed 也未携带 toZone，死亡去向限制缺生产匹配。431.2 的 channel-rune.exhausted 虽已下发，参考内核仍忽略进入状态、把符文置为就绪。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow: " +
    "(:rb_energy_1::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +2 :rb_might:.\n" +
    "[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted. (When I die while " +
    "Empowered, get the effect.)"
} satisfies CardProgram;
