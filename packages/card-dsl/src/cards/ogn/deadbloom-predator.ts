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
 * - [Deflect] 的展开没有消费方：目标税通知属引擎批 4（契约 3.8 第 4 条），
 *   TargetPlan 只接受调用方经 TargetFinalizeOptions.tax 传入的税，链的 Finalize
 *   没有从图层读取 target.tax 的接线，cost.pay 也没有并入目标税（RIFT-89 费用计划 / RIFT-90 目标税）。
 * - play-location-permission 也没有消费方：打出位置校验由 Finalize 的费用/位置管线
 *   负责，当前没有读取该持续效果的路径（见 sfd dauntless-vanguard 的 test.todo）。
 * 依赖：RIFT-90（目标税/目标锁定）、RIFT-89（费用计划）、打出位置许可的图层消费者。
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
    "两处依赖未合入：（1）[Deflect]（809.1.c/d）展开的 static target.tax 没有消费方——契约 3.8 " +
    "第 4 条把“成为目标/目标锁定通知”归引擎批 4，TargetPlan 的 TargetTaxAdapter 只接受调用方经 " +
    "TargetFinalizeOptions.tax 传入的税，链 Finalize 没有从图层读取 target.tax 的接线，" +
    "cost.pay 也未并入目标税（依赖 RIFT-89 费用计划与 RIFT-90 目标税）。（2）static play-location-permission（170.11.a 的" +
    "“occupied enemy battlefield”，420.3.b.2 的 Finalize 位置校验）没有消费方：打出位置校验" +
    "目前不读取该持续效果（与 sfd dauntless-vanguard 同一缺口）。依赖：RIFT-89（费用计划）、" +
    "RIFT-90（目标税/目标锁定）、打出位置许可的图层消费者。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "You may play me to an occupied enemy battlefield."
} satisfies CardProgram;

export default program;
