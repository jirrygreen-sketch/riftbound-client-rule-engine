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
 * status 判定（README 第 2 节）：judge-required，而不是 no-ability。
 * 理由：三段印刷文本都是**规则提醒与追踪用途说明**（729.1.a 的标记方式、824.1 的 Level 门槛、
 * 730.2 的 XP 花费），没有一段是这张 token 自身的触发式/启动式能力。卡面确有印刷文本，
 * 因此不满足 no-ability 的"经确认没有能力文本"；同时也没有可编码的能力，故按 judge-required
 * 记录，并写明缺的是"提醒文本的归属"。abilities 保持空数组——不把 Level 门槛或 XP 花费
 * 写成这张牌的能力（那属引用它的卡），也不自造追踪指令。
 *
 * 依赖：无（XP 的获得/花费已由 effect.xp 与 cost.xp / 支付计划实现；Level 门槛属各卡自身与
 * 依赖式关键词展开）。
 * 说明（数据问题，不改数据）：本地目录把 unl-t08 记为 cardType "Token"、energy/power/might 全为
 * null——与任务卡一致（null = 无印刷值，绝不写成 0）。effect-coverage 把该印刷标记为
 * judge-required（"outside the explicitly verified compiler coverage"），与本判定一致。
 */
export default {
  canonicalCardId:
    "card.hash-bd13577acf2621457b102b04d868bc9c236deec535cbd42baead7bc5fee78ab4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三段原文都是规则提醒 / 追踪用途说明，不是这张 token 自身的能力：" +
    "(1)「Track gained XP here.」是 729.1.a 允许用卡牌等载体清楚标记 XP 的物理追踪说明；" +
    "(2)「Some cards get bonuses based on your [Level].」是 824.1 依赖式关键词的提醒（门槛读取属引用它的卡）；" +
    "(3)「Some cards can spend XP for powerful effects.」是 730.2 XP 花费方向的提醒（花费由那些卡的费用/支付计划执行）。" +
    "本卡不执行获得 / 花费 XP 的动作，731/731.1 也规定 XP 不是可选目标、可横置或可重置的 Game Object；" +
    "因此没有可编码的能力，但卡面确有印刷文本，不满足 no-ability 的「经确认没有能力文本」。" +
    "abilities 保持空数组，不把 Level 门槛或 XP 花费写成这张牌的能力，也不自造追踪指令；" +
    "不把 energy/power/might 的 null 写成 0。依赖：无（effect.xp 与 cost.xp 已实现相应方向）。",
  abilities: [],
  sourceText:
    "Track gained XP here.\n" +
    "Some cards get bonuses based on your [Level].\n" +
    "Some cards can spend XP for powerful effects."
} satisfies CardProgram;
