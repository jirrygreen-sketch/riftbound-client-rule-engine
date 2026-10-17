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
 * - CardProgram static → layers 的绑定已经存在，且能登记本卡的
 *   continuous.grant-keyword；但 programs/statics.ts 会拒绝 static filter 中的
 *   `other`/`exclude` 动态锚点，所以“其他”单位的排除仍没有生产绑定路径。
 *   即使去掉该过滤缺口，静态授予的关键词也不会自动再次进入 KeywordDef.expand。
 * - 被授予的 Assault 还要按 807.1.c/807.2 在接收者上展开为 "+1 [M] while attacker"：
 *   Assault 的 KeywordDef 展开条件读宿主 attacker designation，而 designation 不在
 *   layers 的 ObjectSnapshot 特征里，layers/engine.ts 的 conditionMatches 也不求值
 *   compare 条件（未知 kind 按 true）。
 * 依赖：static filter 的动态排除谓词、授予关键词的二次展开、designation 谓词与 compare
 * 条件消费方。
 */
const captainFarron = {
  canonicalCardId: "card.hash-89422400a305aba2968956c639368704e17bca94d650b959b1c78453e5095fe2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Other friendly units here have [Assault]』是 static 持续能力：continuous.grant-keyword 指令原语已合入，" +
    "CardProgram static → layers 绑定已经能登记该效果，sameLocationAs 也能解析；但 programs/statics.ts " +
    "会拒绝 filter 的 other/exclude 动态锚点，无法把“其他”单位注册成正确的受影响集合；授予的关键词也不会自动再次进入 KeywordDef.expand。" +
    "此外被授予的 Assault 按 807.1.c/807.2 展开为条件于 attacker designation 的 +1 [M]，" +
    "designation 不在 layers 的 ObjectSnapshot 特征中，layers/engine.ts 的 conditionMatches 也不求值 compare 条件（未知 kind 按 true），" +
    "展开在真实图层计算中无法只在我攻击时生效。依赖：动态 other/exclude 过滤、授予关键词二次展开、designation 谓词与 compare 条件消费方。不近似实现。",
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
