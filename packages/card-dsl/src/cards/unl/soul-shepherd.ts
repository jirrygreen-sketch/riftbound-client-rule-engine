import type { CardProgram } from "../../ir/index.js";

/**
 * Soul Shepherd (unl-077-219) — Unit，5 能量、无印刷 Power、Might 3，Mind / Shadow Isles。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-077-219，逐字）：
 *   Your token units have +1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 479.4："Your token units have +1 :rb_might:." 是算术层的持续修正；作用范围是
 *   与能力控制者同一控制者（740.1.a 的 "your"）的 token 单位。
 * - 186 / 440.2：token 由 create-token 游戏动作生成；"token units" 的判定要读对象的
 *   token 特征（ObjectSnapshot.isToken）。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. continuous.might 原语已经合入，但还没有把卡牌 static 能力注册进图层引擎的适配
 *    路径（RIFT-91 卡牌接线缺口），本条修正当前不生效。
 * 2. 过滤器无法判定 token：已合入的 layers/filter.ts 的 matchesObjectFilter 不含
 *    isToken 成员判定（实测 { type: "unit", controller: "A", zone: "board", isToken: true }
 *    对非 token 单位仍返回 true）；事件侧 ObjectFilter 白名单同样没有该位。写成普通友方
 *    单位会把非 token 单位也一起加成，属近似实现，故不写。
 * 依赖：RIFT-91（layers-continuous 的卡牌接线与 token 特征过滤）。
 */
const soulShepherd = {
  canonicalCardId: "card.hash-bd9ef27aeff0a310c407d20aaac7113859f60260060aac163b4025ea2e70bf4c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) continuous.might 原语已合入，但还没有把卡牌 static 能力注册进图层引擎的适配路径" +
    "（RIFT-91 卡牌接线缺口），本条 +1 :rb_might: 当前不生效；" +
    "(2) 过滤器无法判定 token：layers/filter.ts 的 matchesObjectFilter 不含 isToken 成员判定" +
    '（实测 { type: "unit", controller: "A", zone: "board", isToken: true } 对非 token 单位仍返回 true），' +
    "事件侧 ObjectFilter 白名单也没有该位；写成普通友方单位会连非 token 单位一起加成。依赖：RIFT-91。",
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
          controller: "controller",
          // token 特征判定的缺口见 judgeReason；这里按可审查形状书写，
          // 不把它当成已生效的限制。
          isToken: true
        }
      }
    }
  ],
  sourceText: "Your token units have +1 :rb_might:."
} satisfies CardProgram;

export default soulShepherd;
