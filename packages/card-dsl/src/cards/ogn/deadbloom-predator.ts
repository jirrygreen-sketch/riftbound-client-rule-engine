import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Deadbloom Predator (ogn-161-298) — Unit（能量 8，力量 2，Might 8，Body；Shadow Isles）。
 *
 * 原文：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   You may play me to an occupied enemy battlefield.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect] 809：关键词声明；展开为 target.tax（809.1.c 对手选择时追加 Power 费用，
 *   809.1.c.1 该 Power 可为任意领域）。
 * - "You may play me to an occupied enemy battlefield."：静态的合法打出位置许可
 *   （170.11.a：occupied = 战场上有单位；420.3.b.2 的打出位置在 Finalize 校验）。
 *   契约 3.1 的 play ability 只有 `restriction`（限制）字段、没有"许可"字段，
 *   因此与同效果的 sfd-093-221 Dauntless Vanguard 采用同一建模方式：
 *   static + ContinuousEffect kind: "play-location-permission"，由 layers/ 消费。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。2026-10-17 逐项实测后的当前缺口：
 * - RIFT-360 已合入 target/tax 的独立适配器（deflectCost(1) 产出任意领域的 1 Power
 *   支付组件，符合 809.1.c.1），但 programs/statics.ts 仍没有 target.tax 的图层映射：
 *   把展开后的静态能力走真实 attachLifecycle 时，回调收到 "Static ability kind
 *   target.tax has no layer mapping"，图层注册数为 0（golden 固定）。因此该税项目前
 *   既不会进入目标 Finalize，也不会进入支付计划。
 * - 同一次 attach 还会对 play-location-permission 报 "Static ability kind
 *   play-location-permission has no layer mapping"；layers/rules/query.ts 的
 *   playLocations() 只消费 continuous.location 的 permission/restriction 字符串，
 *   而 continuous.location 在同一 layerFor 中同样没有映射。位置选择器本身已合入，
 *   缺的是"手牌许可 → 合法打出位置集合"的生产消费方（170.11.a、420.3.b.2）。
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
    "两处当前缺口（均已实测，不近似实现）：" +
    "（1）[Deflect]（809.1.c/d）的展开仍缺图层映射：RIFT-360 已合入 target/tax 独立适配器" +
    "（deflectCost(1) 产出任意领域的 1 Power 支付组件，符合 809.1.c.1），" +
    "但 programs/statics.ts 的 layerFor 没有 target.tax，真实 attachLifecycle 回调报" +
    "「Static ability kind target.tax has no layer mapping」且图层注册数为 0，" +
    "因此该税项目前既不会进入目标 Finalize，也不会进入支付计划。" +
    "（2）「play me to an occupied enemy battlefield」的静态许可同样缺映射与消费方：" +
    "attachLifecycle 报「Static ability kind play-location-permission has no layer mapping」，" +
    "layers/rules/query.ts 的 playLocations() 只读取 continuous.location 的 permission/restriction 字符串，" +
    "而 continuous.location 在同一个 layerFor 中也没有映射，所以 170.11.a 的" +
    "「战场上有单位」许可不会进入合法打出位置集合与 420.3.b.2 的 Finalize 校验。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "You may play me to an occupied enemy battlefield."
} satisfies CardProgram;

export default program;
