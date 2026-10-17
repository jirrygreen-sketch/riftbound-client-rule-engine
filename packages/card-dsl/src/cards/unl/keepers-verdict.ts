import type { CardProgram } from "../../ir/index.js";

/**
 * Keeper's Verdict (unl-204-219) — Spell, 2 energy + 2 power, Body/Order,
 * tags Poppy / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-204-219，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "Choose an enemy unit at a battlefield. Its owner places it on the top or bottom of their Main Deck."
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806.1 / 806.1.b）是许可类关键词，卡牌只声明（契约 3.7）。
 * - "Choose an enemy unit at a battlefield"：具体对象选择（355.5 / 355.7），单位在公开区域
 *   （355.9.a.1 / 355.10.a.1），"enemy" 与 "at a battlefield" 是它的合法性限制
 *   （355.9.b、355.10.b 的示例），因此是目标。
 * - "Its owner places it on the top or bottom of their Main Deck"："Its owner" 指该单位的
 *   拥有者（359.3.f.1 的 referent），由其在"顶部或底部"之间二选一后被放回
 *   拥有者的 Main Deck；055 / 056.1 规定牌只能进入拥有者的非棋盘区域，426/437 之外的
 *   这类"放回牌库顶或底"由 effect.zone 的 deck-top / deck-bottom 提交 move-zone 完成
 *   （zone 变更产生新对象身份，124）。
 *
 * status = judge-required（不近似实现）：
 * 1. "on the top or bottom" 是拥有者在结算时做的二选一（355.17：指令给出强制要求时按
 *    要求执行；355.16：不得做出会导致后续非法结果的选择）。契约 3.9 的 choice.mode 只在
 *    模式之间选择，每个模式内部可以带指令；但链的 Finalize 面
 *    （chain/engine.ts assertFinalizationSurface）显式阻断结算期出现的 choice.mode
 *    （"Mode choices require a Finalize/Resolve choice-plan adapter"），因此本卡的模式分支
 *    目前无法通过打出管线执行，因为 Finalize 面没有 choice.mode 的 Resolve choice-plan 适配器。
 * 2. 被移动对象的归属玩家由目标的 owner 决定，effect.zone 的 move-zone 由内核按 056.1
 *    路由到拥有者的对应区域；这部分形状已可写，但只有第 1 点解决后才能整卡执行。
 * 依赖：choice.mode 的 Finalize/Resolve choice-plan 适配器。[Action] 关键词、enemy+battlefield 的目标限制、
 * effect.zone 的 deck-top / deck-bottom 均已合入，golden 用真实解释器与参考内核执行两个模式；
 * 解释器路径可执行本身不构成"打出管线可执行"的证据。
 */

export default {
  canonicalCardId: "card.hash-f90cd5af60e3899d3330ee8473377f3975c421713216d6ec28e24242296f72be",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "结算期的“top or bottom”二选一没有打出管线：CR 355.17 要求按指令的强制要求执行该选择、355.16 约束不得产生后续非法结果，" +
    "契约 3.9 的 choice.mode 只在模式之间选择（每个模式内部可带指令），但链的 Finalize 面" +
    "（chain/engine.ts assertFinalizationSurface）显式阻断结算期出现的 choice.mode：\"Mode choices require a Finalize/Resolve choice-plan adapter\"，" +
    "因此本卡的模式分支目前无法通过打出管线执行，因为缺少 Finalize/Resolve choice-plan 适配器。" +
    "可写部分：目标按 355.5 / 355.7 / 355.9.a.1 / 355.9.b 声明为“敌方 + 战场单位”，" +
    "“Its owner” 是目标的 owner referent（359.3.f.1），放回由 effect.zone 的 deck-top / deck-bottom（056.1 / 124）完成；" +
    "golden 用真实解释器与参考内核执行两个模式，但解释器可执行不等于打出管线可执行。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // “Its owner places it on the top or bottom of their Main Deck.”
          // 选择者是该单位的拥有者（359.3.f.1 的 referent）。
          id: "keepers-verdict.choose-destination",
          op: "choice.mode",
          args: {
            chooser: {
              kind: "object-property",
              object: { target: "keepers-verdict.enemy-unit" },
              property: "owner"
            },
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: {
              kind: "constant",
              value: "Place it on the top or bottom of your Main Deck?"
            },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "keepers-verdict-top",
                  body: [
                    {
                      id: "keepers-verdict.to-top",
                      op: "effect.zone",
                      args: {
                        target: { kind: "constant", value: "keepers-verdict.enemy-unit" },
                        // deck-top 由内核路由到拥有者的 Main Deck（056.1）。
                        to: { kind: "constant", value: "deck-top" }
                      }
                    }
                  ]
                },
                {
                  id: "keepers-verdict-bottom",
                  body: [
                    {
                      id: "keepers-verdict.to-bottom",
                      op: "effect.zone",
                      args: {
                        target: { kind: "constant", value: "keepers-verdict.enemy-unit" },
                        to: { kind: "constant", value: "deck-bottom" }
                      }
                    }
                  ]
                }
              ]
            }
          },
          targets: [
            {
              id: "keepers-verdict.enemy-unit",
              // “enemy unit at a battlefield”：单位是目标（355.9.a.1），
              // “enemy / at a battlefield” 是它的限制（355.9.b、355.10.b）。
              filter: { type: "unit", controller: "opponent", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose an enemy unit at a battlefield. Its owner places it on the top or bottom of their Main Deck."
} satisfies CardProgram;
