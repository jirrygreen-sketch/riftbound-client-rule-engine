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
 *   Might；317.2.c 本回合到期），不是 Buff 计数器（CR 702）。
 * - [Flow]（829）是费用改写关键词；卡面只声明关键词，展开归 effects/keywords/Flow。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处执行缺口见 judgeReason；
 * 条件判定本身用已合入表达式表达，golden 用真实解释器执行。
 */

/**
 * 描述性目的地标记，不是可执行的 LocationRef：effect.move 的 to 只接受静态 LocationRef、
 * "controller-base" 或静态候选列表，所以该形状会被原语直接拒绝（fail-closed），不会把敌方
 * 单位移到某个猜测的战场。真实目的地选择属 355.4 的地点计划（见 judgeReason 第 1 点）。
 */
const A_BATTLEFIELD_WHERE_YOU_HAVE_UNITS = {
  kind: "destination-selector",
  filter: { type: "battlefield" },
  whereYouHaveUnits: true
} as const;

const shadowDash = {
  canonicalCardId: "card.hash-d36d553ad15f3dd8bd9c05be30069fca4730d573292d1f2d05ddc4cc468b099f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「to a battlefield where you have units」是一次运行期的 Move 目的地选择" +
    "（355.4 / 355.4.a 的合法目的地，451.1 的目的地限制）：冻结 IR 没有运行期 Location 选择器，" +
    "已合入的 effect.move 的 to 只接受静态 LocationRef / \"controller-base\" / 静态候选列表，" +
    "程序只保留描述性目的地标记，原语直接拒绝该形状而不是把敌方单位移到错误的地点。依赖 RIFT-90（target/location plan）。" +
    "(2)「they each get +1 :rb_might: this turn」缺临时 Might 修正的卡牌侧入口：layers/engine.ts 消费 continuous.might，" +
    "但 effects/instructions 里没有任何已合入的 op 创建该持续效果（143.2.a 有效 Might、317.2.c 本回合到期），" +
    "依赖 RIFT-91；不用 effect.buff 近似（CR 702 的 Buff 是计数器，不是 Might 修改）。" +
    "条件「exactly two units there」用已合入的 count 表达式 + sameLocationAs 锚点读 move 收据（359.3.e.14），" +
    "golden 用真实解释器执行该判定；[Flow]（829）的关键词展开仍未合入（RIFT-266），卡面只声明印刷关键词。",
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
            to: { kind: "constant", value: A_BATTLEFIELD_WHERE_YOU_HAVE_UNITS },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "movedEnemy" }
          },
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
