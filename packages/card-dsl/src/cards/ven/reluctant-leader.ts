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
 * status = judge-required（缺口见 judgeReason，均不近似实现）：触发过滤的「另一个」键
 * 与 might-changed 管线是当前真实缺口；宿主 +2 Might 已由合入的 continuous.might 表达，
 * golden 用真实解释器执行。
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
        // continuous.might 已合入，appliesTo self 把效果注册到能力宿主。
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
    "两处缺口，均不近似实现：(1) 触发条件「you play another unit」无法表达：events/pipeline-match.ts 的 " +
    "matchesTriggerEvent 只识别 object/source/target/player/fromZone/toZone/amount/details，没有「另一张牌 / " +
    "排除本卡」的过滤键；ObjectSelector.exclude 只作用于集合查询，不作用于触发过滤，而程序绑定侧的 " +
    "translateObjectFilter 直接拒绝 other/exclude 键（383.4.a.4 要求这是“另一个对象被打出”的触发）。" +
    "(2) might-changed 时点的 producer 没有接入事件管线。已支持部分：「give me +2 :rb_might: this turn」由合入的 " +
    "continuous.might 经 appliesTo self 注册到宿主（golden 用真实解释器执行，算术层 2 点、回合结束到期）。" +
    "依赖：事件管线扩展（“另一对象”过滤，RIFT-359 条件谓词不覆盖该键）与 might-changed 管线接线。",
  abilities,
  sourceText: "When you play another unit, give me +2 :rb_might: this turn."
} satisfies CardProgram;
