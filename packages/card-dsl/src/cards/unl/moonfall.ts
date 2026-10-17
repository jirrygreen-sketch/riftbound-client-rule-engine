import type { CardProgram } from "../../ir/index.js";

/**
 * Moonfall (unl-198-219) — Spell, 3 energy + 1 power, Mind/Chaos,
 * tags Diana / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-198-219，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "Choose a battlefield where you have units. You may move up to one enemy unit to that battlefield. "
 *   "Then give enemy units there -2 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806.1 / 806.1.b）是许可类关键词，卡牌只声明（契约 3.7）。
 * - "Choose a battlefield where you have units"：这是公开信息上的运行期地点选择
 *   （355.4 / 355.5）；"where you have units" 是战场地点的合法性限制。
 * - "You may move up to one enemy unit to that battlefield"："you may" 属 383.3.a 的
 *   可选执行，按契约 3.9 用 choice.optional 把被选指令包进 body；移动是效果移动
 *   （451，不是 Standard Move 144），被移动的敌方单位是目标（355.10 / 355.9.a.1），
 *   默认目的地是"that battlefield"（355.4.a：目的地是这些单位当前地点以外的合法地点；
 *   此处被"that battlefield"固定，因此不是自由选择）。
 * - "Then give enemy units there -2 :rb_might: this turn"："Then" 是顺序词；受影响单位是
 *   按特征程序化选定的集合（355.10.d），因此不是目标；"there" 指前面移动的目的地
 *   （359.3.f.1 的 referent）；本回合的 -2 Might 属 479.4 Arithmetic 图层的临时修正。
 *
 * status = judge-required（不近似实现）：
 * 1. "give enemy units there -2 :rb_might: this turn" 已改写为 continuous.might，
 *    但其运行期集合仍依赖前面选择的 battlefield referent 在嵌套 optional/then
 *    结算中保持可读（479.4 Arithmetic layer 与 359.3.f.1）。
 * 依赖：continuous.might 的 location-aware query / nested referent consumer。
 * 运行期 Location 选择、effect.move 的 LocationExpr 目的地、被移动的敌方单位目标
 * 与 [Action] 声明均已接通。
 */

/** 临时 Might 修正；运行期集合锚点仍见 judgeReason 的剩余缺口。 */
const MIGHT_MINUS_2 = {
  id: "moonfall.might-modify",
  op: "continuous.might",
  args: {
    amount: { kind: "constant", value: -2 },
    duration: { kind: "constant", value: "this-turn" },
    // “enemy units there”：355.10.d 的程序化集合 + 359.3.f.1 的地点 referent。
    objects: {
      kind: "constant",
      value: {
        kind: "query",
        filter: {
          type: "unit",
          controller: "opponent",
          zone: "board",
          sameLocationAs: { target: "moonfall.battlefield" }
        }
      }
    }
  }
} as const;

export default {
  canonicalCardId: "card.hash-e2e26781b4b52ed2eb1cf50ca00160e4ad95f6b59a93ca58abd157a6e8cee977",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "一处依赖未合入，且不近似实现：“Then give enemy units there -2 :rb_might: this turn” 已使用可执行的 continuous.might 指令，" +
    "但其运行期 enemy-unit 集合必须在嵌套 optional/then 结算中读取前面 battlefield LocationSpec 的地点 referent（479.4 与 359.3.f.1）；" +
    "当前 queryObjects 的 sameLocationAs 只消费 ObjectSelector，不能消费 location target binding，故该锚点消费仍未完成。" +
    "已按契约落地的部分：战场位置选择与敌方单位目标（355.4 / 355.5 / 355.10 / 355.9.a.1）、“you may” 按契约 3.9 包进 choice.optional 的 body（不写 choice + linkedTo）、" +
    "受影响单位按 355.10.d 声明为非目标集合、运行期战场选择与 effect.move 的目标地点解析；[Action] 关键词声明可校验。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // “Choose a battlefield where you have units.” 先于可选的移动做出；
          // 地点选择声明在承载后续指令的控制节点上。
          // “You may move up to one enemy unit to that battlefield.”（383.3.a 的
          // “you may”；契约 3.9：被选指令包进 choice.optional 的 body）。
          id: "moonfall.optional-move",
          op: "choice.optional",
          locations: [
            {
              id: "moonfall.battlefield",
              // 355.4 / 355.5：战场位置是公开地点选择；hasUnits 表达“where you
              // have units”的占据限制，controller 绑定到能力控制者。
              type: "battlefield",
              controller: "controller",
              hasUnits: true,
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            prompt: {
              kind: "constant",
              value: "Move up to one enemy unit to the chosen battlefield?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "moonfall.move-enemy-unit",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "moonfall.enemy-unit" }
                    },
                    to: { kind: "location", value: { kind: "target-location", target: "moonfall.battlefield" } },
                    // “up to one”：数量上限 1，无可移动单位时按 055 / 359.3.e.11
                    // 尽可能执行（0 个即无事发生）。
                    amount: { kind: "constant", value: 1 }
                  },
                  targets: [
                    {
                      id: "moonfall.enemy-unit",
                      filter: { type: "unit", controller: "opponent" },
                      min: 0,
                      max: 1,
                      selection: "up-to"
                    }
                  ]
                }
              ]
            }
          }
        },
        {
          // “Then give enemy units there -2 :rb_might: this turn.” 独立语句（"Then"
          // 是顺序词，055 / 359.3.e.11：移动被否定时仍尽可能执行）；集合与缺口的
          // 说明见 judgeReason 第 2 点。
          id: "moonfall.might-minus-2",
          op: "sequence",
          args: {
            body: { kind: "constant", value: [MIGHT_MINUS_2] }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a battlefield where you have units. You may move up to one enemy unit to that battlefield. " +
    "Then give enemy units there -2 :rb_might: this turn."
} satisfies CardProgram;
