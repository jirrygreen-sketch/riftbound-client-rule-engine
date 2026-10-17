import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Deadbloom Predator (ogn-161-298) — Unit（能量 8，力量 2，Might 8，Body；Shadow Isles）。
 *
 * 原文：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   You may play me to an occupied enemy battlefield.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect] 809：关键词声明；展开为 target.tax（809.1.c 对手选择时追加 Power 费用）。
 * - "You may play me to an occupied enemy battlefield."：静态的合法打出位置许可
 *   （170.11.a：occupied = 战场上有单位；420.3.b.2 的打出位置在 Finalize 校验）。
 *   契约 3.1 的 play ability 只有 `restriction`（限制）字段、没有"许可"字段，
 *   因此与同效果的 sfd-093-221 Dauntless Vanguard 采用同一建模方式：
 *   static + ContinuousEffect kind: "play-location-permission"，由 layers/ 消费。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - [Deflect] 的展开仍需要把静态 target.tax 接到目标 Finalize 和支付计划（RIFT-360）。
 * - play-location-permission 仍需要位置选择/Finalize 消费方（RIFT-357）。
 * 不近似实现（不把 Deflect 写成静态数值，也不假装许可已生效）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: true, controller: "opponent" },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    }
  }
];

const program = {
  canonicalCardId: "card.hash-c615c988d8b72525a349735e8c5029acbffec25179ae7427d5f8bc8aff9333b4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处当前缺口未合入：（1）[Deflect]（809.1.c/d）展开的 static target.tax 尚未从持续效果接入目标 Finalize，" +
    "并把目标税纳入支付计划（RIFT-360）；（2）static play-location-permission 对 170.11.a 的 occupied enemy battlefield" +
    "尚未接入 RIFT-357 的运行时位置选择与 Finalize 校验。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "You may play me to an occupied enemy battlefield."
} satisfies CardProgram;

export default program;
