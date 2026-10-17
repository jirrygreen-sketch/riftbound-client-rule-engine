import type { CardProgram } from "../../ir/index.js";

/**
 * Icevale Archer (unl-065-219) — Unit，2 能量、无印刷 Power、Might 2，Mind / Freljord。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-065-219，逐字）：
 *   When I attack, you may pay :rb_energy_1: to give a unit here -1 :rb_might:
 *   this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.e / 466.2.c："When I attack" 是攻击触发，时点取封闭枚举里的
 *   attack-declared。
 * - 355.9 / 355.9.a.1："a unit here" 是选目标（Board 上的单位；英文没有
 *   friendly/enemy，故不写控制者限制）。"here" 指来源当前位置（053.3），用契约
 *   3.6 的 sameLocationAs 锚点表达，由解释器在结算时按来源位置解析。
 * - 383.3.a / 383.3.b："you may pay :rb_energy_1:" 位于效果开头，是触发能力的
 *   基础费用，在 Finalize 时决定是否支付（383.3.b.1：未支付则该触发不进链）。
 *   冻结 IR 的 triggered ability 没有 cost 字段（契约 3.1），因此这里用
 *   optional: true 表达「由控制者在 Finalize 决定是否执行」，费用本身见 judgeReason。
 * - 122.5：-1 :rb_might: 是临时数值修正，归 continuous.might 图层（effect.buff 的
 *   边界注释明确临时 Might 修改不进 Buff 原语），期限为 "this turn"。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. attack-declared 没有已合入的发出方：该 id 只出现在 events/timing-points.ts 与
 *    events/trigger-spec.ts 的封闭枚举里，combat/（base-combat-allocation、
 *    derived-might）不发射任何时点，战斗流程属引擎批 5（RIFT-31/33/77）。
 * 2. 效果本体 "give a unit -1 :rb_might: this turn" 使用已合入的 continuous.might 原语，
 *    但 body 目标过滤的 sameLocationAs（"a unit here"）会被触发目标翻译层拒绝，
 *    目标锁定在绑定即失败。
 * 3. 前导可选 Energy 费用（383.3.b）在冻结 IR 里没有承载字段（triggered ability
 *    无 cost）；cost.pay 原语已合入，但 Finalize 费用计划入口仍未接线（RIFT-89）。
 * 依赖：RIFT-31/33/77（战斗时点）、RIFT-89（费用计划）、翻译层 sameLocationAs。
 */
const icevaleArcher = {
  canonicalCardId: "card.hash-cfa683e56408938bf27747d5d9dcb341900100c1cc87f15bd487c270cd7b2dee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 攻击时点 attack-declared 只存在于封闭枚举（events/timing-points.ts、trigger-spec.ts），" +
    "combat/ 不发射该时点（战斗流程属引擎批 5，RIFT-31/33/77），触发在真实内核中不可达；" +
    "(2) 效果本体「give a unit -1 :rb_might: this turn」使用已合入的 continuous.might 图层修正，" +
    "但 body 目标过滤的 sameLocationAs（a unit here）会被目标翻译层拒绝，目标锁定在绑定即失败；" +
    "(3) 前导可选 Energy 费用（383.3.b）在冻结 IR 的 triggered ability 里没有 cost 字段，" +
    "cost.pay 原语已合入但 Finalize 费用计划入口未接线（RIFT-89）——本能力只用 optional: true 表达 Finalize 决定，" +
    "不把费用写成事后指令。依赖：RIFT-31/33/77、RIFT-89、翻译层 sameLocationAs。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } }
      },
      // 383.3.a/383.3.b："you may pay" 在效果开头，由控制者在 Finalize 决定是否执行该触发。
      optional: true,
      body: [
        {
          id: "icevale-archer.give-minus-1",
          // 临时 Might 修正属 continuous.might（见 judgeReason 第 2 点）；本指令按
          // 契约形状书写，等待原语合入后由解释器 + 图层执行。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -1 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "icevale-archer.unit-here" }
          },
          targets: [
            {
              id: "icevale-archer.unit-here",
              // "a unit here"：任何一方的单位，只要与来源同地点（355.9.a.1、053.3）。
              filter: { type: "unit", zone: "board", sameLocationAs: "source" },
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
    "When I attack, you may pay :rb_energy_1: to give a unit here -1 :rb_might: this turn."
} satisfies CardProgram;

export default icevaleArcher;
