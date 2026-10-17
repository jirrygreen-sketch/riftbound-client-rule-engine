import type { CardProgram } from "../../ir/index.js";

/**
 * Soul Shepherd (unl-077-219) — Unit，5 能量、无印刷 Power、Might 3，Mind / Shadow Isles。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-077-219，逐字）：
 *   Your token units have +1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 479.4：持续修正作用于 "your token units"，即与能力控制者同一控制者（740.1.a 的
 *   "your"）的 token 单位；修正是算术层的 +1 :rb_might:。
 * - 186 / 440.2：token 由 create-token 游戏动作生成；"token units" 依据对象快照的
 *   isToken 特征判定。
 *
 * status = judge-required（缺口不近似实现）：生产静态绑定在首次进入 Board 时把
 * controller: "controller" 解析为当时的控制者并固化到 ContinuousEffectSpec；对象之后
 * 经 take-control 改变控制者时，光环仍作用于原控制者的 token，违反“your token units”
 * 随当前控制者变化的语义。待共享静态绑定路径按实时控制者重算过滤后再升级。
 */
const soulShepherd = {
  canonicalCardId: "card.hash-bd9ef27aeff0a310c407d20aaac7113859f60260060aac163b4025ea2e70bf4c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "生产静态绑定会在首次绑定时把 controller: controller 固化为来源当时的控制者；" +
    "来源经 take-control 改变控制者后，光环仍作用于原控制者的 token，" +
    "无法满足 479.4 的 your token units 随当前控制者变化。待共享静态绑定路径修复。" +
    "RIFT-668 已将集合明确为 type: unit 且 characteristics.isToken: true，排除非单位 token；正向与排除场景见 static-668.test.mjs。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        filter: {
          zone: "board",
          type: "unit",
          characteristics: { isToken: true },
          controller: "controller"
        }
      }
    }
  ],
  sourceText: "Your token units have +1 :rb_might:."
} satisfies CardProgram;

export default soulShepherd;
