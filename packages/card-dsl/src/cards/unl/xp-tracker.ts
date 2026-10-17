import type { CardProgram } from "../../ir/index.js";

/**
 * XP Tracker (unl-t08) — Colorless token，无印刷 Energy / Power / Might，标签 Token。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-t08，逐字）：
 *   Track gained XP here.
 *   Some cards get bonuses based on your [Level].
 *   Some cards can spend XP for powerful effects.
 *
 * 规则依据（CR v1.5）：
 * - 729 / 729.1 / 729.1.a：XP 是玩家在对局中累积、花费或修改的资源；729.1.a 明确 XP 可以用
 *   计数器、骰子、卡牌或其他能清楚标记的方式追踪——“Track gained XP here." 就是这条规则的
 *   物理追踪说明（本 token 是标记载体）。729.2：XP 数量是公开信息。
 * - 730.1 / 730.2：XP 的获得（增加标记值）与花费（减少标记值）；本卡不执行其中任何一个动作。
 * - 731 / 731.1：XP 不是 Game Object，不能被选为目标、横置或重置——因此也没有可声明的对象交互。
 * - 824.1："[Level N]" 是依赖式关键词（"Some cards get bonuses based on your [Level]." 是对它的
 *   提醒；门槛读取属各卡自身的 dependent ability，不是本 token 的能力）。
 * - "Some cards can spend XP for powerful effects." 是 730.2 花费方向的提醒；花费动作由那些卡
 *   的费用（cost.xp / 支付计划）执行，本 token 不产生费用或指令。
 *
 * status = no-ability（README 第 2 节，2026-10-17 复核）。
 * 印刷说明文字不等于能力文本：本卡既不自行获得/花费 XP，也没有 [Level N][>] 的依赖式
 * 能力。三句只是描述追踪用途和其他卡的行为，不存在尚待执行的能力或上游依赖。
 * abilities 保持空数组，不创造“追踪”指令；目录的 energy/power/might: null 均保持不变。
 */
export default {
  canonicalCardId:
    "card.hash-bd13577acf2621457b102b04d868bc9c236deec535cbd42baead7bc5fee78ab4",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText:
    "Track gained XP here.\n" +
    "Some cards get bonuses based on your [Level].\n" +
    "Some cards can spend XP for powerful effects."
} satisfies CardProgram;
