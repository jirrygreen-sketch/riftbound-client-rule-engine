import type { CardProgram } from "../../ir/index.js";

/**
 * Captain Farron (ogn-015-298) — Unit, Fury, Trifarian/Noxus, energy 4, Power 1, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-015-298，逐字）:
 *   "Other friendly units here have [Assault]. (+1 :rb_might: while they're attackers.)"
 *
 * 规则依据（Core Rules v1.5）:
 * - 807.1 / 807.1.b.3：Assault 是单位上的被动关键词，未印刷数值时视为 Assault 1
 *   （提醒文字 "+1 [M] while they're attackers" 与本卡原文一致）。
 * - 807.2：同一单位被多个来源授予 Assault 时数值相加（stacking: "sum"，由
 *   KeywordDef 声明，不在卡内重写）。
 * - 364.1 / 364.2："Other friendly units here have [Assault]" 是持续生效的被动能力
 *   （陈述句，不是触发）；"here" 指本卡所在的位置（421.1 的位置概念），用
 *   sameLocationAs 锚点（契约 3.6 / 解释器 README）表达"同一位置"，other: true
 *   排除本卡自身（355.10）。
 * - 366 / 365.1：战场上永久物的被动能力在 Board 上生效。
 *
 * 结构说明: 单个 static 能力，effect.kind = "continuous.grant-keyword" 把 assault
 * （无数值 → 807.1.b.3 默认 1）授予同一位置的其他友方单位。
 *
 * 未合入依赖（不近似实现）:
 * - 没有 continuous.grant-keyword 原语：effects/instructions/ 只有 effect.* 文件，
 *   KeywordDef 枚举里也没有"授予关键词"的展开（RIFT-9 的 continuous.keyword 缺口）。
 * - layers（RIFT-91）只消费已注册的 ContinuousEffectSpec，没有 CardProgram static
 *   能力 → 图层注册的消费方；被授予的 Assault 也需要"先授予、再按 807 展开"的两级
 *   处理，combined 展开目前不可执行。
 * 依赖：RIFT-9（continuous.keyword）、RIFT-81、RIFT-91。
 */
const captainFarron = {
  canonicalCardId: "card.hash-89422400a305aba2968956c639368704e17bca94d650b959b1c78453e5095fe2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Other friendly units here have [Assault]』需要 continuous.grant-keyword 持续效果把未带数值的 Assault（807.1.b.3 视为 1）授予同一位置的其他友方单位：" +
    "effects/instructions/ 没有该原语（RIFT-9 的 continuous.keyword 缺口），layers（RIFT-91）也没有 CardProgram static 能力 → 图层注册的消费方，" +
    "且被授予的 Assault 还需按 807.1.c/807.2 在接收者上展开（两级处理）。依赖：RIFT-9（continuous.keyword）、RIFT-81、RIFT-91。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "assault",
        filter: {
          type: "unit",
          controller: "controller",
          zone: "board",
          other: true,
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "Other friendly units here have [Assault]. (+1 :rb_might: while they're attackers.)"
} satisfies CardProgram;

export default captainFarron;
