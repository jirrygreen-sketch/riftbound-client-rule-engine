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
 * 状态：executable。continuous.might 原语、图层注册路径（createEngineStaticBinder）与
 * layers/filter.ts 的 { type: "token" } 判定均已合入；执行证据见
 * test/cards/unl/soul-shepherd.test.mjs（token +1、非 token +0、敌方 token +0、
 * unbind 还原）。
 */
const soulShepherd = {
  canonicalCardId: "card.hash-bd9ef27aeff0a310c407d20aaac7113859f60260060aac163b4025ea2e70bf4c",
  rulesetVersion: "core-1.5",
  status: "executable",
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
          type: "token",
          controller: "controller"
        }
      }
    }
  ],
  sourceText: "Your token units have +1 :rb_might:."
} satisfies CardProgram;

export default soulShepherd;
