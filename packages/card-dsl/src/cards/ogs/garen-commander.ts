import type { CardProgram } from "../../ir/index.js";

/**
 * Garen, Commander (ogs-013-024) — Unit, 6 energy / 1 power (Order), Might 5.
 *
 * sourceText (deck-catalog.json, ogs-013-024, verbatim):
 *   "Other friendly units have +1 :rb_might: here."
 *
 * 规则依据（CR v1.5）：
 * - 143.2：Might 是可被卡牌效果修改的战斗属性；+1 Might 属算术图层
 *   （continuous.might，layer: arithmetic）。
 * - "Other friendly units"：本控制者控制、排除宿主自身的单位集合。此类按特征
 *   程序化选出的集合不选目标（355.10.d），因此写成 static 能力的 filter 而不是
 *   instruction.targets。
 * - "here"：战场用 "here" 指代自己（053.3）；359.3.f.2 说明引用信息在求值时
 *   检查，故 IR 用同一位置锚点 sameLocationAs: "source" 表达（契约 3.6 的
 *   ObjectFilter 锚点，解释器负责绑定运行时引用）。
 *
 * 状态：judge-required。continuous.might 与 CardProgram static 绑定已经合入，但本卡的
 * 静态 filter 同时需要按宿主当前位置动态取集合并排除宿主（"other" + "here"：053.3、
 * 355.10.d、359.3.f.2）。解释器的集合查询已支持 sameLocationAs/exclude 锚点；
 * 生产静态绑定目前拒绝 exclude/source 这种相对排除，并在绑定时固定位置，无法完成该
 * 动态集合的精确重算。
 * 本文件按契约 3.1 写出 static + 锚点过滤形状；不用 Buff 或其它原语近似 +1 Might。
 * 依赖：静态层对 source-relative exclude 与宿主位置变化的支持。
 */
export default {
  canonicalCardId: "card.hash-74b83d5a2a718072a63d9ce9431ec68047c326c6c61dad708fc3642b6b3c76a2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "静态绑定仍无法精确消费本卡的 source-relative filter：continuous.might 与 static 绑定路径已存在，" +
    "interpreter 集合查询也能求值 sameLocationAs/exclude 锚点（other + here：053.3、355.10.d、359.3.f.2），" +
    "但生产静态 filter 不接受 exclude: \"source\"，且绑定时固定 source 位置，无法在宿主移动后" +
    "重算「其他友方单位在此处 +1 Might」（CR 143.2）。不近似实现。依赖：静态层的相对排除与动态位置重算。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        filter: {
          type: "unit",
          controller: "controller",
          exclude: "source",
          sameLocationAs: "source"
        }
      }
    }
  ],
  sourceText: "Other friendly units have +1 :rb_might: here."
} satisfies CardProgram;
