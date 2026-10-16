import type { CardProgram } from "../../ir/index.js";

/**
 * Wuju Master (unl-191-219) — Legend, Calm/Body, tag Master Yi.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-191-219，逐字）：
 *   [Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the
 *   effect.)
 *   [Level 11][>] Your units enter ready.
 *
 * 规则依据（CR v1.5）：
 * - 824.1.a / 824.1.b / 824.1.b.1 / 824.1.c：[Level N][>] 是依赖式关键词，从
 *   关键词到子句结尾整段是 Level Ability，功能等价于“当你有 N 点或更多 XP 时，
 *   本牌获得‘[Text]’”；控制者 XP 变化会即时让依赖能力 Active/Inactive
 *   （824.1.c.1 / 824.1.d）。
 * - 第一条依赖能力 “Your units have +1 [M]” 是持续性的图层修正：需要有 XP 门槛
 *   条件的 continuous.might（图层 arithmetic，作用域为你的单位）。
 * - 第二条依赖能力 “Your units enter ready” 是入场状态替代：把单位横置入场
 *   （143.4 / 359.2.c）替换成就绪入场（对照 805.6 的 Accelerate 写法：入场替代，
 *   不是先横置再就绪，不触发“成为就绪”）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 没有 Level 关键词展开（kw-level）：824.1 的 XP 门槛依赖能力需要
 *   condition.value/condition.predicate 形式的谓词与“小于 N 时立即失活”的动态评估，
 *   合并解释器的 Condition 只有 always/never/expression/compare/all/any/not，
 *   无法读取 XP（PlayerSnapshot.xp 没有进入 Expr 的路径）。
 * - “Your units have +1 [M]” 是 continuous.might 图层修正，尚无卡牌可用的注册入口；
 * - “Your units enter ready” 是入场替代（replacement.enter 家族），合并 events 管线
 *   只有 object-enters-board 事件模式，没有接收卡牌 ReplacementAbility 的注册/结算路径，
 *   且 effect.ready 是“事后重置”，语义不同，不能替代。
 *
 * 依赖：RIFT-91（layers-continuous 的卡牌接线）、RIFT-89/90（条件/谓词管线）、
 * kw-level 关键词展开与 replacement.enter 入场替代（引擎批 4）。
 */
export default {
  canonicalCardId:
    "card.hash-8b7f21bf0986b17b411aeaaeffd500931ea02096c94389c90265a214f7707ab4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Level N][>] 依赖式关键词（824.1）没有展开实现：824.1.c 的“控制者有 N 点或更多 XP 时依赖能力 Active”需要可求值的 XP 谓词，" +
    "合并 IR 的 Condition 只有 always/never/expression/compare/all/any/not，读取 PlayerSnapshot.xp 没有进入 Expr/谓词的路径（824.1.c.1/.d 的动态失活同样缺失）。" +
    "“Your units have +1 :rb_might:” 是 continuous.might 图层修正，尚无卡牌可用的注册入口；" +
    "“Your units enter ready” 是入场状态替代（replacement.enter 家族），合并事件管线没有接收卡牌 ReplacementAbility 的注册/结算路径，" +
    "事后 effect.ready 语义不同（会额外产生“成为就绪”事件），不近似实现。" +
    "依赖 kw-level 展开、RIFT-91（layers 接线）、RIFT-89/90（条件/谓词）与引擎批 4 的入场替代。",
  abilities: [
    {
      kind: "static",
      // 824.1.b.1：“当你有 6+ XP 时，本牌获得 ‘Your units have +1 [M]’”。
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // 作用域：你的单位（controller 锚点由图层引擎解析）。
        filter: { zone: "board", type: "unit", controller: "controller" }
      },
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
    },
    {
      kind: "replacement",
      // “Your units enter ready”：把单位横置入场替换为就绪入场（143.4 / 359.2.c，
      // 对照 805.6）；真实注册与结算属引擎批 4。
      replaces: {
        event: "object-enters-board",
        filter: { controller: "self", type: "unit", exhausted: true }
      },
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 11 }
      },
      with: [
        {
          id: "wuju-master.enter-ready",
          op: "effect.ready",
          args: { objects: { kind: "constant", value: { kind: "source" } } }
        }
      ]
    }
  ],
  sourceText:
    "[Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the effect.)\n" +
    "[Level 11][>] Your units enter ready."
} satisfies CardProgram;
