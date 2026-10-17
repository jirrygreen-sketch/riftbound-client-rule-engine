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
 * 状态：judge-required。
 * 1. continuous.might 指令本体与图层算术已合入（RIFT-258；静态图层的
 *    appliesTo/filter 形态也被该原语支持），但本卡是持续型 static 能力：没有已合入
 *    的生产方把 CardProgram 的 static 能力解析成持续效果并在宿主入场时注册
 *    （RIFT-257 card-program binding；layers/engine.ts 的 registerContinuousEffect
 *    在卡牌路径上没有调用方）。
 * 2. 该持续效果需要在图层求值时按宿主当前位置动态取集合、并排除宿主（"other"
 *    + "here"：053.3、355.10.d、359.3.f.2）；interpreter 的集合查询已支持
 *    sameLocationAs/exclude 锚点（selectors.ts），但静态能力的持续重估仍缺上述注册路径。
 * 本文件按契约 3.1 写出 static + 锚点过滤形状；不用 Buff 或其它原语近似 +1 Might。
 * 依赖：RIFT-257（CardProgram 静态能力绑定）。
 */
export default {
  canonicalCardId: "card.hash-74b83d5a2a718072a63d9ce9431ec68047c326c6c61dad708fc3642b6b3c76a2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 CardProgram 静态能力的持续注册路径：continuous.might 指令（RIFT-258）已能注册算术层持续效果，" +
    "interpreter 集合查询也能求值 sameLocationAs/exclude 锚点（other + here：053.3、355.10.d、359.3.f.2），" +
    "但「其他友方单位在此处 +1 Might」是持续型 static 能力（CR 143.2），必须有生产方在宿主入场时把" +
    "CardProgram 的 static 能力解析成已注册持续效果并随宿主位置变化重估——layers/engine.ts 的 " +
    "registerContinuousEffect 在卡牌路径上没有调用方（RIFT-257 CardProgram 绑定）。不近似实现。" +
    "依赖：RIFT-257（CardProgram 绑定）。",
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
