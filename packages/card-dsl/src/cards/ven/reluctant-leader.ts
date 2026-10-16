import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Reluctant Leader (ven-121-166) — Unit, 4 Energy + 1 Order Power, Might 3,
 * Order, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-121-166，逐字）：
 *   When you play another unit, give me +2 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4："Abilities that trigger when another object is played are not
 *   considered Play Effects."——本卡的触发描述的是「你打出了另一个单位」这一事件，
 *   不是本卡自己的 Play Effect；因此 filter 记录被献出的单位（type unit + 控制者为你
 *   + "another" 排除宿主自身），而不是 { source: "self" }。封闭时点仍是 "card-played"
 *   （383.4.a / 420.4.a：打出完成后触发）。
 * - 143.2 / 143.2.a："give me +2 :rb_might: this turn" 是带回合期限的 Might 修正，属
 *   arithmetic 图层（continuous.might），不是 702 的 Buff 计数器——effect.buff 的文件头
 *   明确临时 Might 修改归 continuous.might，本卡不放置任何 Buff。
 * - 355.10.d / 355.10.d.1："me" 是按特征程序化指定的宿主自身，不是选择目标，因此
 *   effect.buff 一类的 target 参数形式不适用；本卡用所选指令的对象选择器记录宿主。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 触发条件「你打出另一个单位」无法在已合入实现中表达：events/pipeline-match.ts 的
 *    matchesTriggerEvent 只识别 object/source/target/player/fromZone/toZone/amount/
 *    details，没有「另一张牌 / 排除宿主自身」的过滤键；解释器的 ObjectSelector.exclude
 *    只作用于集合查询，不作用于触发过滤。
 * 2. 临时 Might 修正没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改
 *    动作，effects/instructions/ 下也没有注册 continuous.might 的原语（layers 引擎能求值
 *    arithmetic 层与 end-of-turn 期限，但没有把结算中的持续效果经 ResolveContext
 *    .addContinuous 落地的指令）；不能近似为 effect.buff 计数。
 * 3. card-played 时点由 chain/engine.ts 发射，但到 game-server / 卡牌触发的接线未合入
 *    （RIFT-120 后续）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        filter: {
          // 383.4.a.4：触发对象是“另一个单位”，不是本卡自身。
          type: "unit",
          controller: "controller",
          // “another”：排除宿主自身（355.9.c）；当前触发匹配器不读该键（见 judgeReason）。
          other: true
        }
      }
    },
    optional: false,
    body: [
      {
        // “give me +2 :rb_might: this turn”：arithmetic 图层的临时 Might 修正；
        // effects/instructions/ 下没有 continuous.might 原语消费它（见 judgeReason）。
        id: "reluctant-leader.give-plus-2",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-9ca2b329f015cf54a163a35cbad76798217d6fae4e4bc9b00b585281c2cb65cf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 触发条件「you play another unit」无法表达：events/pipeline-match.ts 的 " +
    "matchesTriggerEvent 只识别 object/source/target/player/fromZone/toZone/amount/details，没有「另一张牌 / " +
    "排除本卡」的过滤键；ObjectSelector.exclude 只作用于集合查询，不作用于触发过滤（383.4.a.4 要求这是" +
    "“另一个对象被打出”的触发）。(2) 「give me +2 :rb_might: this turn」是带回合期限的临时 Might 修正，属" +
    "算术图层：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下没有注册 " +
    "continuous.might 的原语（layers 引擎能求值 arithmetic 层与 end-of-turn 期限，但没有把结算中的持续效果经 " +
    "ResolveContext.addContinuous 落地的指令）；effect.buff 文件头明确临时 Might 归 continuous.might，" +
    "绝不能近似为 Buff 计数。(3) card-played 时点虽由 chain/engine.ts 发射，到卡牌触发的注册接线未合入" +
    "（RIFT-120 后续）。依赖：事件管线扩展（“另一对象”过滤）、continuous.might 指令原语（RIFT-9 清单；" +
    "RIFT-91 的图层求值侧已合入）、RIFT-120。",
  abilities,
  sourceText: "When you play another unit, give me +2 :rb_might: this turn."
} satisfies CardProgram;
