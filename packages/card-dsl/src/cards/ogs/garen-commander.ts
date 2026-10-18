import type { CardProgram } from "../../ir/index.js";

/**
 * Garen, Commander (ogs-013-024) — Unit, 6 energy / 1 power (Order), Might 5.
 *
 * sourceText (deck-catalog.json, ogs-013-024, verbatim):
 *   "Other friendly units have +1 :rb_might: here."
 *
 * 规则依据（CR v1.5）：
 * - 143.2：Might 是可被卡牌效果修改的战斗属性；+1 Might 属算术图层
 *   （479.4.a，continuous.might，layer: arithmetic）。
 * - "Other friendly units"：本控制者控制、排除宿主自身的单位集合。此类按特征
 *   程序化选出的集合不选目标（355.10.d），因此写成 static 能力的 filter 而不是
 *   instruction.targets。
 * - "here"：053.3 是战场的自称约定；本卡作为单位的 "here" 是来源位置的
 *   referent（359.3.f.1）。静态图层按 478.1/478.1.a 持续求值，不能固定为进入
 *   战场时的位置；IR 用 sameLocationAs: "source" 表达（契约 3.6）。
 *
 * 状态：judge-required（复核 2026-10-18）。当前静态路径的缺口：
 * 1. programs/statics.ts 的 staticFilter 显式拒绝 exclude 锚点：本卡 filter 里的
 *    exclude: "source" 直接抛 "Static exclude anchor needs a dynamic relative filter"
 *    （golden 用真实 binder 证明），所以连注册都到不了图层。
 * 2. staticFilter 在绑定时将 sameLocationAs 转成固定 LocationRef；宿主移动后
 *    filter.location 不变，违反 478.1/478.1.a 的持续重查要求。
 * 3. layers/filter.ts 的 matchesObjectFilter 按对象身份比较 LocationRef，相同
 *    战场的独立位置对象也无法匹配。因此旧测试中的原位置单位没有获得 +1，不能据此
 *    声称光环仍作用于原位置；测试分别检查位置值、对象身份与绑定后的固定 filter。
 * 本文件按契约 3.1 保留 static + 锚点过滤形状；集合查询和 continuous.might 的局部
 * 执行不替代动态光环，不用 Buff 近似。
 * 依赖：静态层的 source-relative exclude、动态位置重查及 LocationRef 值相等匹配。
 */
export default {
  canonicalCardId: "card.hash-74b83d5a2a718072a63d9ce9431ec68047c326c6c61dad708fc3642b6b3c76a2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 的 static 路径缺 source-relative filter 的生产消费：" +
    "(1) programs/statics.ts 的 staticFilter 拒绝 exclude: source，抛 " +
    "\"Static exclude anchor needs a dynamic relative filter\"；" +
    "(2) sameLocationAs 在绑定时转成固定 LocationRef，宿主移动后不重查；" +
    "(3) layers/filter.ts 的 matchesObjectFilter 按对象身份比较 LocationRef，相同位置的独立对象无法匹配。" +
    "here 是来源位置 referent（CR 359.3.f.1；053.3 仅为战场自称约定），静态光环须按 " +
    "478.1/478.1.a 持续求值。依赖：静态 exclude 锚点消费、动态位置重查及 LocationRef 值相等匹配；" +
    "不以一次性 continuous.might 或 Buff 近似。",
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
