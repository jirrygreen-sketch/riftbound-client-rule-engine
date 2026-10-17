import type { CardProgram } from "../../ir/index.js";

/**
 * Shadow Dash (ven-148-166) — Spell, 2 Energy + 1 Calm/Order Power, tags
 * Shen/Signature. Might null（法术没有印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-148-166，逐字）:
 *   "Move an enemy unit to a battlefield where you have units. If you have
 *    exactly two units there, they each get +1 :rb_might: this turn.
 *    [Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: (You may play this
 *    from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）:
 * - 「Move an enemy unit …」：被点名的敌方单位是 Finalize 选定的目标
 *   （355.7 / 355.9.a.1「Unit 指 Board 上的对象」/ 355.9.b 限制）；效果式 Move
 *   （421 / 448-451）不加 Standard Move 的横置费用与 Main Phase 门槛，也不是区域变更
 *   （448.2）。目的地「a battlefield where you have units」是 Finalize 选择的地点
 *   （355.4 / 355.4.a），并构成该次 Move 的合法性限制（451.1）。
 * - 「If you have exactly two units there」：「there」指该单位移动后的战场，「you」是能力
 *   控制者（190.6.d 的隐含 you）；该集合按特征程序化选出，不是目标（355.10.d）。计数用
 *   已合入的 count 表达式 + sameLocationAs 锚点，从 move 的结果读引用（359.3.e.14）。
 * - 「they each get +1 :rb_might: this turn」：临时 Might 修正是图层算术（143.2.a 的有效
 *   Might；317.2.c 本回合到期），不是 Buff 计数器（CR 702）。continuous.might 原语已合入：引用数组形状真实注册图层并返回受影响收据（golden 有执行证据）；卡面
 *   “sameLocationAs 集合选择器” 不在原语接受的选择器词汇里（objects 与 appliesTo:"self"
 *   之外的查询锚点会被原语拒绝），同位置集合读取属目标/位置计划。
 * - [Flow]（829）是费用改写关键词；卡面只声明关键词，展开归 effects/keywords/Flow。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
const shadowDash = {
  canonicalCardId: "card.hash-d36d553ad15f3dd8bd9c05be30069fca4730d573292d1f2d05ddc4cc468b099f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「they each get +1 :rb_might: this turn」的临时 Might 修正原语已合入：continuous.might" +
    "接受引用数组 / { objects: [refs] } 形状并真实注册图层（143.2.a 有效 Might、317.2.c 本回合到期，" +
    "golden 有执行证据）；卡面需要的「sameLocationAs 集合选择器」不在该原语的选择器词汇里" +
    "（objects 与 appliesTo:'self' 之外的查询锚点会被拒绝），同位置集合读取依赖目标/位置计划；" +
    "不用 effect.buff 近似（CR 702 的 Buff 是计数器，不是 Might 修改）。" +
    "条件「exactly two units there」用已合入的 count 表达式 + sameLocationAs 锚点读 move 收据（359.3.e.14），" +
    "golden 用真实解释器执行该判定；[Flow] KeywordDef 与 params.cost 输入已存在，但卡程序仍未把印刷的 5 Energy + 2 [A]" +
    "传入 KeywordDef，也没有把 Flow alternate cost 与弃牌区打出及 then-banish replacement 接入生产链。",
  abilities: [
    // 829.1 / 829.1.c：印刷的 [Flow] 替代费用关键词，只声明不重写展开。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // 「Move an enemy unit …」：目标 = 对手控制的 Board 单位（355.9.a.1 / 355.9.b）。
          id: "shadow-dash.move-enemy-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "shadow-dash.enemy-unit" } },
            to: { kind: "location", value: { kind: "target-location", target: "shadow-dash.battlefield" } },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "movedEnemy" }
          },
          locations: [
            {
              id: "shadow-dash.battlefield",
              type: "battlefield",
              controller: "controller",
              hasUnits: true,
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          targets: [
            {
              id: "shadow-dash.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「If you have exactly two units there, they each get +1 Might this turn」：
          // 「there」由 move 收据（结果引用，359.3.e.14）经 sameLocationAs 锚点绑定；
          // 「they」是同一位置、由你控制的单位集合（355.10.d 的程序化集合，非目标）。
          id: "shadow-dash.grant-might-to-two",
          op: "continuous.might",
          linkedTo: "shadow-dash.move-enemy-unit",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            appliesTo: {
              kind: "constant",
              value: {
                type: "unit",
                zone: "board",
                controller: "self",
                sameLocationAs: { linked: "shadow-dash.move-enemy-unit" }
              }
            }
          },
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units-you-control-at-that-battlefield",
              filter: {
                type: "unit",
                zone: "board",
                controller: "self",
                sameLocationAs: { linked: "shadow-dash.move-enemy-unit" }
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ],
  sourceText:
    "Move an enemy unit to a battlefield where you have units. If you have exactly two units there, " +
    "they each get +1 :rb_might: this turn.\n" +
    "[Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default shadowDash;
