import type { CardProgram } from "../../ir/index.js";

/**
 * Petal Pixie (unl-076-219) — Unit，2 能量、无印刷 Power、Might 2，Mind / Fae / Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-076-219，逐字）：
 *   I have +1 :rb_might: for each of your units with [Temporary] at my battlefield.
 *
 * 规则依据（CR v1.5）：
 * - 479.4："I have +N :rb_might:" 是算术层的持续修正（479.2.b / 479.3.b 的 "have"
 *   即使判为能力授予，数值仍落在 479.4），由图层系统在链之外计算。
 * - 816.1 / 816.3：Temporary 是触发式能力关键词，且「是否具有 Temporary」是永久物的
 *   可读取特征（816.3）；因此 "units with [Temporary]" 是特征过滤。
 * - 740.1.a："your units" 指与能力控制者同一控制者的单位；"at my battlefield" 指与
 *   来源当前位置相同的战场（053.3 的 here 指代），用契约 3.6 的 sameLocationAs: "self" 表达。
 * - "+1 … for each" 是数量型动态取值：契约 3.6 的 count 表达式在求值时按当前局面计数。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. "units with [Temporary]" 的成员判定无已合入形态：hasKeyword 不被 staticFilter
 *    白名单、触发/目标 ObjectFilter 的翻译层或 layers/filter.ts 接受；写成普通友方
 *    单位计数会把没有 Temporary 的单位也算进去，属近似实现，故不写。
 * 2. "+1 … for each" 的动态数值依赖 count 表达式按求值时局面取值；静态绑定路径对
 *    动态 amount 会静默回退为 0（不求值 count），本条修正当前不生效。
 * 依赖：关键词特征过滤与静态 count 动态求值。
 */
const petalPixie = {
  canonicalCardId: "card.hash-8338862de653402acc57a72f7e3d56c3cc2489ec52c8f53f9b778f26d23c59bd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) units with [Temporary] 的成员判定无已合入形态：hasKeyword 不被 staticFilter 白名单、" +
    "触发/目标 ObjectFilter 的翻译层或 layers/filter.ts 接受，写成普通友方单位计数会把没有 Temporary 的单位也算进去；" +
    "(2) +1 for each 的动态数值依赖 count 表达式按求值时局面取值，静态绑定路径对动态 amount 会静默回退为 0（不求值 count）。" +
    "依赖：关键词特征过滤与静态 count 动态求值。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        // "+1 for each of your units with [Temporary] at my battlefield"：数值用 count
        // 表达式按求值时的局面取值；成员判定的缺口见 judgeReason。
        amount: {
          kind: "count",
          subject: "your-units-with-temporary-at-my-battlefield",
          filter: {
            zone: "board",
            type: "unit",
            controller: "controller",
            sameLocationAs: "self",
            hasKeyword: "temporary"
          }
        }
      }
    }
  ],
  sourceText: "I have +1 :rb_might: for each of your units with [Temporary] at my battlefield."
} satisfies CardProgram;

export default petalPixie;
