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
 * 结构说明: 单个 static 能力，effect.kind = "continuous.grant-keyword" 把 Assault
 * （无数值 → 807.1.b.3 默认 1）授予同一位置的其他友方单位。
 *
 * 未合入依赖（不近似实现）:
 * - CardProgram static → layers 的绑定已经存在，且能登记本卡的
 *   continuous.grant-keyword；但 programs/statics.ts 会拒绝 static filter 中的
 *   `other`/`exclude` 动态锚点，所以“其他”单位的排除仍没有生产绑定路径。
 *   KeywordGrantLayerEngine 已经提供授予关键词的重展开，但生产装配尚未接入该引擎。
 * - 被授予的 Assault 还要按 807.1.c/807.2 在接收者上展开为 "+1 [M] while attacker"：
 *   KeywordGrantLayerEngine 的重展开环境把 designation 别名到 combatRole，但生产
 *   装配没有接入该引擎，生产侧仍没有 designation→combatRole 映射。
 * 依赖：static filter 的动态排除谓词、授予关键词的二次展开、designation → combatRole
 * 映射。
 */
const captainFarron = {
  canonicalCardId: "card.hash-89422400a305aba2968956c639368704e17bca94d650b959b1c78453e5095fe2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Other friendly units here have [Assault]』是 static 持续能力：continuous.grant-keyword 指令原语已合入，" +
    "CardProgram static → layers 绑定已经能登记该效果，sameLocationAs 也能解析；但 programs/statics.ts " +
    "会拒绝 filter 的 other/exclude 动态锚点，无法把“其他”单位注册成正确的受影响集合；" +
    "KeywordGrantLayerEngine 已支持授予关键词的重展开，但生产装配尚未接入该引擎。" +
    "此外被授予的 Assault 按 807.1.c/807.2 展开为条件于 attacker designation 的 +1 [M]，重展开环境内部虽把 " +
    "designation 别名到 combatRole，生产侧的 designation→combatRole 映射仍未接线，所以无法只在攻击者状态下生效。" +
    "依赖：动态 other/exclude 过滤、位置值匹配、授予关键词二次展开、designation → combatRole 映射。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Assault",
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
