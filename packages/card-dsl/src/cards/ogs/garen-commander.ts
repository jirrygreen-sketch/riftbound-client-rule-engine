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
 * 状态：judge-required（复核 2026-10-17）。continuous.might、CardProgram static 绑定与
 * chain 生命周期接线都已合入，但 production static binder 仍有两处硬缺口：
 * 1. programs/statics.ts 的 staticFilter 显式拒绝 exclude 锚点：本卡 filter 里的
 *    exclude: "source" 直接抛 "Static exclude anchor needs a dynamic relative filter"
 *    （golden 用真实 binder 证明），所以连注册都到不了图层。
 * 2. sameLocationAs 在绑定时被求值成固定的 concrete LocationRef：golden 用去掉 exclude
 *    的同形 filter 证明绑定后 filter.location 定格在宿主当时的位置，宿主移动到另一个
 *    战场后仍给原位置的单位 +1——不是 053.3/359.3.f.2 要求的动态重算。
 * 本文件按契约 3.1 写出 static + 锚点过滤形状；不用 Buff 或其它原语近似 +1 Might。
 * 依赖：静态层对 source-relative exclude 的消费，以及宿主位置变化的动态重算。
 */
export default {
  canonicalCardId: "card.hash-74b83d5a2a718072a63d9ce9431ec68047c326c6c61dad708fc3642b6b3c76a2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might、static 绑定路径与 chain 生命周期都已合入，但生产 static binder 仍无法消费本卡的 source-relative filter：" +
    "(1) programs/statics.ts 的 staticFilter 拒绝 exclude 锚点，bindStatic 抛 " +
    "\"Static exclude anchor needs a dynamic relative filter\"（golden 实测 ProgramBindingError）；" +
    "(2) sameLocationAs 在绑定时被求值成固定 LocationRef，宿主移动后不会重算" +
    "（golden 用同形 filter 证明位置被定格），而 CR 053.3/359.3.f.2 要求 here 按求值时的宿主位置重查；" +
    "通用测试台实测：本卡 static 在绑定阶段即抛上述异常、注册表为空，因此同址友方单位保持在 Might 2。" +
    "解释器集合查询本身已支持 sameLocationAs/exclude 锚点，缺的是静态层的生产消费方。不近似实现。" +
    "依赖：静态层对 source-relative exclude 的消费与宿主位置变化的动态重算。",
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
