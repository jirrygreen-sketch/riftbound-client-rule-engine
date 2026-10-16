import type { CardProgram } from "../../ir/index.js";

/**
 * Lost to the Sands (rad-013-167) — Spell, 3 Energy + 1 Fury Power, Fury.
 *
 * Printed text (packages/card-data/data/deck-catalog.json):
 *   [Action] (Play on your turn or in showdowns.)
 *   Choose one —
 *   Deal 4 to a unit at a battlefield.Kill a gear.
 *
 * ⚠ 数据问题（不在本任务修改范围）：目录 sourceText 把两个 bullet 合并成
 * "battlefield.Kill"（缺分隔符），但官方卡面是两条独立模式；本程序按官方卡面把
 * 两条模式分别建模，sourceText 仍逐字使用目录原文（见任务回复的数据问题清单）。
 *
 * Rules evidence (Core Rules v1.5):
 * - 806 [Action] / 159.2.a default spell timing: declared as the merged
 *   { kind: "keyword", keyword: "action" } (keywords/Action.ts).
 * - 355.3: a spell with a bulleted list of modes chooses at Finalize; the mode
 *   header "Choose one —" is the contract 3.9 structure `choice.mode`
 *   (count 1, different true), not a target.
 * - "Deal 4 to a unit at a battlefield": effect.damage with a TargetSpec whose
 *   filter keeps the unit at a battlefield (355.9.b example: "a unit at a
 *   battlefield" is a targeting restriction). The battlefield itself is not a
 *   target (355.10.b).
 * - "Kill a gear": effect.kill with a TargetSpec over a gear on the Board
 *   (355.9.a.1 makes "gear" mean an object on the Board unless stated
 *   otherwise; 429.6 formats Kill).
 *
 * Status: judge-required. The primitives are merged (effect.damage,
 * effect.kill, choice.mode) and the golden test executes both modes against the
 * reference kernel, but the production chain refuses mode-bearing cards until
 * the Finalize/Resolve choice-plan adapter exists: ChainEngine.finalize calls
 * assertFinalizationSurface, which throws ChainContractBlockedError for any
 * `choice.mode` instruction (chain/engine.ts, contract 3.9 "users of choice.mode
 * need the choice-plan adapter"). Placing the mode choice at Finalize (355.3)
 * is the missing engine piece (engine batch 4 follow-up, RIFT-90/120 scope).
 * The card is therefore not executable end-to-end and is not marked executable.
 */
const lostToTheSands = {
  canonicalCardId: "card.hash-ebc16c621c62d012f80adc1a2faa4b87722a2ea924309743bafb7b413e043f1c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "choice.mode 已在解释器实现并有 golden 执行证据，但生产链仍显式阻断：ChainEngine.finalize 的 " +
    "assertFinalizationSurface 对任何 choice.mode 抛 ChainContractBlockedError（链与事件核心的 " +
    "Finalize/Resolve 选择计划适配器尚未合入，属引擎批 4 收尾 / RIFT-90 范围）。" +
    "CR 355.3 要求模式在 Finalize 决定，当前没有该时机的选择计划落地路径，故整卡不可执行；" +
    "两条模式的原语本身已合入并用真实内核执行（见 golden 测试）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "lost-to-the-sands.choose-one",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: { kind: "constant", value: "Choose one —" },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "lost-to-the-sands.damage-mode",
                  body: [
                    {
                      id: "lost-to-the-sands.deal-4",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 4 },
                        target: { kind: "constant", value: "lost-to-the-sands.unit" }
                      },
                      targets: [
                        {
                          id: "lost-to-the-sands.unit",
                          filter: { type: "unit", zone: "board", location: "battlefield" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "lost-to-the-sands.kill-mode",
                  body: [
                    {
                      id: "lost-to-the-sands.kill-gear",
                      op: "effect.kill",
                      args: { target: { kind: "constant", value: "lost-to-the-sands.gear" } },
                      targets: [
                        {
                          id: "lost-to-the-sands.gear",
                          filter: { type: "gear", zone: "board" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose one —\n" +
    "Deal 4 to a unit at a battlefield.Kill a gear."
} satisfies CardProgram;

export default lostToTheSands;
