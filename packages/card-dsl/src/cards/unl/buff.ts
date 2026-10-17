import type { CardProgram } from "../../ir/index.js";

/**
 * Buff (unl-t04) — Colorless token，无印刷 Energy / Power / Might，标签 Token。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-t04，逐字）：
 *   A unit may have no more than one buff at a time.
 *
 * 规则依据（CR v1.5）：
 * - 427.1 / 427.1.b / 427.1.b.1：Buffing 是把 Buff 计数器放到单位上；已经带有 Buff 计数的
 *   单位不会再得到一个。427.1.b.2：只有其他效果显式授予"可被多次 Buff"的许可才例外。
 * - 702.3 / 702.3.a：同一单位同一时间只能有一个 Buff；再被指示添加时不放置。
 * - 703 / 704：每个 Buff 贡献 +1 Might，且 Buff 本身是 Game Object / 计数器，可被引用与计数。
 *
 * "A unit may have no more than one buff at a time." 是对 Buff 动作的**通用数量限制**，
 * 不是这张 token 自己的触发/启动能力：它复述的正是引擎已经实现的规则（effect.buff 的
 * 文件头与实现按 702.3.a 处理重复 Buff 为 no-op，buffers 计数上限为 1，除非被授予多次许可）。
 * 因此本程序不含可声明为 CardProgram Ability 的新动作——把它写成 continuous.restrict 或
 * 自建的 Buff 修改指令都会凭空发明这张牌没有的能力（本卡不产生任何结算动作）。
 *
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required，而不是 no-ability。
 * 理由：`no-ability` 的定义是"经官方卡面确认没有能力文本"（如基本符文），本卡的卡面**有**印刷
 * 文本，只是这段文本是规则提醒 / 通用限制，不能被编码成这张卡自身的能力。既不是
 * "无能力文本"，也没有可执行的能力，故按 judge-required 记录，并写明缺的是"通用限制的归属"。
 * 已知不一致（记录，不在本任务改数据分类）：unl/reflection.ts 与 unl/xp-tracker.ts 的印刷文本
 * 同样是提醒 / 规则说明，却被归为 no-ability；本卡沿用它自己的既有判定，避免同一个 task 内
 * 单方面改动分类口径。
 *
 * 依赖：无（该限制已由 effect.buff 按 702.3.a 实现）；本卡保持数据声明，不新增指令。
 * 说明（数据问题，不改数据）：本地目录把 unl-t04 记为 cardType "Token"、energy/power/might 全为
 * null——与任务卡一致（null = 无印刷值，绝不写成 0）。
 */
export default {
  canonicalCardId:
    "card.hash-66eaa3ba7dcb5f48286af9287931a07e8311549ec5b0d9c312fce567f2d723b1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "本卡原文「A unit may have no more than one buff at a time.」是 427.1.b.1 / 702.3/702.3.a 的通用数量限制" +
    "（已经带 Buff 的单位不再获得新的 Buff），不是这张 token 自身的触发式/启动式能力，也不是无能力文本：" +
    "该限制已由已合入的 effect.buff 按 702.3.a 实现（实测第二次 Buff 返回 negated/skipped 且计数仍为 1，除非有 427.1.b.2 的多次许可），" +
    "因此既不能编码成新的 CardProgram 能力（会凭空发明这张牌没有的动作），也不能标记为 no-ability" +
    "（卡面确有印刷文本，no-ability 仅用于经确认没有能力文本的卡）。" +
    "另记：unl/reflection 与 unl/xp-tracker 的印刷文本同为提醒/规则说明却归 no-ability，本卡沿用自身既有判定以免单方面改动分类口径。" +
    "不近似实现：不写 continuous.restrict 等自造指令，不把 energy/power/might 的 null 写成 0。依赖：无。",
  abilities: [],
  sourceText: "A unit may have no more than one buff at a time."
} satisfies CardProgram;
