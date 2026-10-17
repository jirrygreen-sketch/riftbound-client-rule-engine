import type { CardProgram } from "../../ir/index.js";

/**
 * Peak Guardian (ogn-223-298) — Unit, 6 energy + 1 Order power, Might 5。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-223-298）：
 *   When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there.
 *   (To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)
 *
 * 规则依据（CR v1.5）：
 * - 「When you play me」：card-played 时点、来源为自身（383/420.4.a）。
 * - 「buff me」「buff all other friendly units there」：Buff 标记（702.3/702.3.a：已有 Buff 的单位
 *   不再获得，也不重复放置；427.1.c 允许继续把这些单位选进 Buff 动作，只是不放置）。
 * - 「if I am at a battlefield」：效果里的条件从句（不紧跟触发条件之后，按 383.2.a.1 属于效果；
 *   359.3.f.2 的 referent 在执行时检查）。「there」= 本卡当前所在位置（359.3.f.1）。
 * - 355.10.d/355.10.d.1：按特征程序化选中（all + 其它友方单位 + 同位置）不是目标选择。
 *
 * 结构（契约 3.2/3.4/3.9）：
 * - body[0] 「buff me」：以 self 锚点为目标过滤的 effect.buff（mode buff）；
 * - body[1] 「buff all other friendly units there」：以 sameLocationAs: "self" + exclude: "self"
 *   + controller: "controller" 的 ObjectFilter 做集合查询的 effect.buff。
 *
 * 关于门控的写法：本卡第二句是强制的 if 从句、不是玩家选择，因此**不**能用 choice.optional
 * 包一层（那会凭空引入一次玩家决定，等于伪造语义）。已合入的 TargetSpec.location 可以把
 * “来源所在位置必须是 battlefield”与 sameLocationAs: "self" 一起表达：来源在基地时，第二条
 * TargetSpec 没有合法对象，Buff 效果自然不执行。
 *
 * status = judge-required：见 judgeReason。
 */
const peakGuardian = {
  canonicalCardId: "card.hash-9280855113d398f4a348f702083fe564e2c7ef030983070eb28dcb3f83835e8d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「if I am at a battlefield」已用 TargetSpec.location: { type: \"battlefield\" } 与 " +
    "sameLocationAs: \"self\" 表达（359.3.f.2 的 referent 在执行时检查）；来源在基地时，第二条 " +
    "TargetSpec 没有合法对象，因此不会给基地上的其它单位加 Buff。当前剩余缺口是程序目标适配器仍拒绝并未消费 " +
    "sameLocationAs/exclude 的动态锚点，" +
    "因此这条集合查询还不能进入生产结算路径。依赖：目标适配器对 sameLocationAs/exclude 的支持。" +
    "「buff me」与 702.3.a 的「已有 Buff 不再获得」边界，以及同位置其它友方单位的 Buff 集合行为，" +
    "均已有 golden 执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "peak-guardian.buff-me",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "self-unit" }
          },
          targets: [
            {
              id: "self-unit",
              filter: { object: "self", type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "peak-guardian.buff-others-here",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "other-friendlies-here" }
          },
          targets: [
            {
              id: "other-friendlies-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                exclude: "self",
                sameLocationAs: "self"
              },
              location: { type: "battlefield" },
              min: 0,
              max: null,
              selection: "all"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there. " +
    "(To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)"
} satisfies CardProgram;

export default peakGuardian;
