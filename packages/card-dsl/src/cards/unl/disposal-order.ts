import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Disposal Order (unl-103-219) — Spell, 2 energy, no printed power, no Might,
 * Body.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-103-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n"
 *   "Choose one —\n"
 *   "Choose up to 3 cards from opponents' trashes. Their owners recycle them.Draw 1."
 *
 * 数据问题（不改数据）：目录文本在 "Their owners recycle them." 与 "Draw 1" 之间
 * 缺少空格/模式分隔（"them.Draw"），而 "Choose one —" 需要一个 bulleted 模式列表
 * （CR 355.3）；docs/plans/survey/unclassified-unl.md 第 19 行把本卡记为
 * 「二选一：回收对手 Trash 中至多三张，或抽一张」，因此程序按该已记录读法写两个
 * 模式，sourceText 保留目录原文逐字。
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「Choose one —」是 355.3 的模式选择；契约 3.9 用 choice.mode（count 1、
 *   different true）表达，不写成 choice + linkedTo。
 * - 模式一「Choose up to 3 cards from opponents' trashes. Their owners recycle
 *   them」：417.1 / 417.1.c 规定回收把牌放到其拥有者自己的牌库底（无论谁被指示
 *   执行）；417.4 不足则尽量回收；417.6 的 "Recycle X from [Zone]" 选择不是目标
 *   （355.7），用 effect.recycle 的 from 形状。"up to 3" 允许选更少（355.13）。
 *   108.2.a：每名玩家各有自己的 Trash，"opponents' trashes" 是复数区域。
 * - 模式二「Draw 1」是已合入的 effect.draw（414.1）。
 *
 * status = judge-required（不近似实现）：
 * - effect.recycle 的 from 形状是 { zone, owner?: "controller" | "source-owner",
 *   amount }：单一所有者的单一区域，无法表达 "opponents' trashes" 这种复数区域
 *   （同 ogn/forge-of-the-future 的缺口），按 controller 读会静默漏掉对手的 Trash；
 * - "up to 3" 允许玩家选 0–3 张（355.13），但 from 把选择锁成恰好
 *   min(3, 可用数)（chooseFromZone 用 min: count, max: count），任何更小的答案都会
 *   被拒绝，无法表达玩家自选的更小张数；
 * - 「Choose one」的模式选择还需要链的 Finalize/Resolve choice-plan 适配器
 *   （chain/engine.ts assertFinalizationSurface 目前阻断 choice.mode 的卡牌 body），
 *   解释器 + 参考内核可执行该结构（golden 提供答案）。
 * 模式二与 choice.mode 结构已由 golden 真实执行；模式一按描述性 owner 写出。
 * 依赖：effect.recycle 的多所有者区域形式与 up-to 选择（RIFT-9 / RIFT-66 后续）、
 * 链的模式选择适配器。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "play",
    body: [
      {
        id: "disposal-order.choose-mode",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          prompt: { kind: "constant", value: "Choose one —" },
          modes: {
            kind: "constant",
            value: [
              {
                id: "disposal-order.recycle-mode",
                body: [
                  {
                    id: "disposal-order.recycle-up-to-3",
                    op: "effect.recycle",
                    args: {
                      from: {
                        kind: "constant",
                        value: {
                          zone: "trash",
                          // 108.2.a："opponents' trashes" 是复数区域，from 的 owner 只
                          // 接受 controller | source-owner；此描述性值会被原语的
                          // argsSchema 拒绝（fail-closed），不会静默读成控制者的 Trash。
                          owner: "opponents",
                          amount: { kind: "constant", value: 3 }
                        }
                      }
                    }
                  }
                ]
              },
              {
                id: "disposal-order.draw-mode",
                body: [
                  {
                    id: "disposal-order.draw-1",
                    op: "effect.draw",
                    args: { amount: { kind: "constant", value: 1 } }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const disposalOrder = {
  canonicalCardId: "card.hash-ae826439bb4605b7d72d3b0b431548f77c4cde681a949dd0e613036488b554c0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "模式一无法用已合入的 effect.recycle from 形状表达（{ zone, owner?: controller | source-owner, amount }）：" +
    "(1)「opponents' trashes」按 CR 108.2.a 是每名对手各自的 Trash，是复数区域；from 只能读单一所有者的单一区域，" +
    "按 controller 读会静默漏掉对手 Trash 中的牌，也没有规则条目把它收窄为控制者自己的区域（同 ogn/forge-of-the-future 的缺口）。" +
    "(2)「up to 3」允许选 0–3 张（355.13），from 却把选择锁成恰好 min(3, 可用数)（chooseFromZone 用 min: count, max: count），" +
    "更小的答案会被拒绝。(3)「Choose one」的模式选择还需要链的 Finalize/Resolve choice-plan 适配器" +
    "（chain/engine.ts assertFinalizationSurface 目前阻断卡牌 body 里的 choice.mode）。" +
    "模式二 Draw 1 与 choice.mode 结构只用已合入原语，golden 用解释器 + 参考内核真实执行。" +
    "依赖：effect.recycle 的多所有者区域形式与 up-to 选择、链的模式选择适配器；不近似实现。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose one —\n" +
    "Choose up to 3 cards from opponents' trashes. Their owners recycle them.Draw 1."
} satisfies CardProgram;

export default disposalOrder;
