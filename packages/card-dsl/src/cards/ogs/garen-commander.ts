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
 * 1. 缺 continuous.might 的消费方：layers/engine.ts 有算术图层代码，但没有
 *    "卡牌静态能力 → 已注册持续效果"的装配/消费路径（keyword 侧 Assault.ts、
 *    Shield.ts 也把 continuous.might 明确列为未合入依赖）。
 * 2. 该持续效果需要在图层求值时按宿主当前位置动态取集合、并排除宿主（"other"
 *    + "here"），且静态能力以何对象为宿主绑定未接入。
 * 本文件按契约 3.1 写出 static + 锚点过滤形状；不用 Buff 或其它原语近似 +1 Might。
 * 依赖：RIFT-91（layers-continuous）、RIFT-89/90（条件/目标批次）。
 */
export default {
  canonicalCardId: "card.hash-74b83d5a2a718072a63d9ce9431ec68047c326c6c61dad708fc3642b6b3c76a2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.might 消费方：其他友方单位在此处 +1 Might 是算术图层的持续 +1 Might" +
    "（CR 143.2），layers/ 尚无卡牌静态能力到已注册持续效果的装配/消费路径" +
    "（Assault.ts、Shield.ts 同样把 continuous.might 列为未合入依赖）；且该效果需在" +
    "图层求值时按宿主当前位置动态取集合并排除宿主（other + here：053.3、355.10.d、" +
    "359.3.f.2），当前未接入。依赖：RIFT-91（layers-continuous）、RIFT-89/90（条件/目标批次）。" +
    "不近似实现。",
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
