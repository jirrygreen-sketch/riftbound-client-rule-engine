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
 * - "Choose a battlefield where you have units"：战场是游戏对象（170）、其区域是公开信息
 *   （355.10.a.1），具体选择（355.5）使其成为目标（355.7）；"where you have units" 是
 *   战场的合法性限制。
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
 * 1. "to that battlefield" 需要把 battlefield 目标的当前 LocationRef 作为 effect.move 的
 *    工作目的地（target.location 未合入）；合并 IR 没有运行期 Location 选择器，
 *    effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表，因此本卡
 *    保留描述性目的地标记，解释器会拒绝该形状而不是落到错误地点（依赖 RIFT-90 / RIFT-91）。
 * 2. "give enemy units there -2 :rb_might: this turn" 是临时 Might 修正：契约 3.6 的封闭
 *    GameAction 集合没有 might 修改动作，effect.buff 既有文档把临时 Might 归 layers 的
 *    continuous.might / 479.4 Arithmetic 图层（RIFT-83/84）。（该集合同时需要 "there"
 *    锚点，同第 1 点。）
 * 依赖：RIFT-90（目标/目的地计划）、RIFT-91 与 RIFT-83/84（图层）。被移动的敌方单位已
 * 按 355.10 / 355.9.a.1 声明为目标；[Action] 声明本身可校验。
 */

/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 1 点）。 */
const CHOSEN_BATTLEFIELD = {
  kind: "destination-selector",
  locationOf: { target: "moonfall.battlefield" }
} as const;

/** 描述性的临时 Might 修正（见 judgeReason 第 2 点）。 */
const MIGHT_MINUS_2 = {
  id: "moonfall.might-modify",
  op: "effect.might-modify",
  args: {
    amount: { kind: "constant", value: -2 },
    duration: { kind: "constant", value: "this-turn" },
    // “enemy units there”：355.10.d 的程序化集合 + 359.3.f.1 的地点 referent。
    appliesTo: {
      kind: "constant",
      value: {
        type: "unit",
        controller: "opponent",
        sameLocationAs: { target: "moonfall.battlefield" }
      }
    }
  }
} as const;

export default {
  canonicalCardId: "card.hash-e2e26781b4b52ed2eb1cf50ca00160e4ad95f6b59a93ca58abd157a6e8cee977",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) “move up to one enemy unit to that battlefield” 的目的地是前面选中的战场的当前 " +
    "LocationRef（CR 355.4 / 355.4.a / 451.1），合并 IR 没有运行期 Location 选择器（target.location 未合入），" +
    "effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表；本卡只保留描述性目的地标记，解释器会拒绝它而不是落到错误地点（依赖 RIFT-90 / RIFT-91）。" +
    "(2) “Then give enemy units there -2 :rb_might: this turn” 是临时 Might 修正：契约 3.6 的封闭 GameAction 集合没有 might 修改动作，" +
    "effect.buff 既有文档把临时 Might 归 layers 的 continuous.might / 479.4 Arithmetic 图层（RIFT-83/84）；该集合的 “there” 锚点还依赖第 1 点的运行期地点读取。" +
    "已按契约落地的部分：战场目标与敌方单位目标（355.5 / 355.7 / 355.10.a.1 / 355.9.a.1）、“you may” 按契约 3.9 包进 choice.optional 的 body（不写 choice + linkedTo）、" +
    "受影响单位按 355.10.d 声明为非目标集合；[Action] 关键词声明可校验。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // “Choose a battlefield where you have units.” 先于可选的移动做出
          // （355.5 的具体选择；355.7 / 355.10.a.1 使它成为目标），因此战场
          // 的 TargetSpec 声明在承载后续指令的这条控制节点上（与已合入的
          // ogn/shakedown 把 TargetSpec 声明在 choice.mode 上的写法一致）。
          // “You may move up to one enemy unit to that battlefield.”（383.3.a 的
          // “you may”；契约 3.9：被选指令包进 choice.optional 的 body）。
          id: "moonfall.optional-move",
          op: "choice.optional",
          targets: [
            {
              id: "moonfall.battlefield",
              // 170 / 355.10.a.1：战场是公开区域的游戏对象；“where you have units”
              // 是它的合法性限制（本阶段过滤器没有该谓词，随 judgeReason 第 1 点
              // 一并接线）。
              filter: { type: "battlefield", controller: "self" },
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
                    to: { kind: "constant", value: CHOSEN_BATTLEFIELD },
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
