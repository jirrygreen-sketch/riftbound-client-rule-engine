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
 * 关于条件从句的写法：本卡第二句是强制的 if 从句、不是玩家选择，因此**不**能用 choice.optional
 * 包一层（那会凭空引入一次玩家决定，等于伪造语义）。而「if I am at a battlefield」这个门控在现有
 * IR 里无法忠实表达（见 judgeReason），所以程序里**不**写一个语义不等价的 condition 占位，
 * body[1] 只精确表达它能表达的那半句「buff all other friendly units there」。
 *
 * status = judge-required：见 judgeReason。
 */
const peakGuardian = {
  canonicalCardId: "card.hash-9280855113d398f4a348f702083fe564e2c7ef030983070eb28dcb3f83835e8d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「if I am at a battlefield」这个门控在已合入的 IR 里不可判定：需要「来源当前位置的类型是 " +
    "battlefield」这一谓词（359.3.f.2 的 referent 在执行时检查），而 Condition 只有 " +
    "always/never/compare/all/any/not/expression——expression 只做布尔转换" +
    "（object-property(source, location) 返回位置对象，恒为真），compare 只能比较被求值的值，" +
    "嵌套位置类型（location.type）既不能被 object-property 读取，也没有对应的谓词节点；" +
    "写死具体战场 id 不是卡面语义。" +
    "因此程序里不写语义不等价的 condition 占位：body[1] 只精确表达它可以表达的那半句" +
    "「buff all other friendly units there」（sameLocationAs/exclude/controller 的集合查询），" +
    "而“只在我是战场时生效”的门控缺失——若本卡在基地被结算，这条指令会多作用于基地上的其它友方单位，" +
    "这是本卡判为 judge-required 的原因之一；触发能力的 CardProgram 绑定也尚依赖 RIFT-257。依赖：" +
    "位置类型谓词（或可判定的 target.location 形式）落地。" +
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
