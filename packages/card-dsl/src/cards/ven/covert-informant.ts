import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Covert Informant（ven-090-166 相邻批次）：CR v1.5 827.1.c.1、828.1.b.1/828.1.c、421.1。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：RIFT-593 的 Empower KeywordDef（effects/keywords/Empower.ts）
 * 已合入，Empowered 状态也通过 object-property 的 `empowered` 属性可求值，旧的
 * 「缺关键词展开 / 缺状态谓词」理由已过时。仍不能整卡可执行的当前缺口：
 * 1. 印刷的 Empower 费用无法从卡侧送达展开：827.1.c 的 “[Cost]: Empower this” 是 CostSpec，
 *    而契约 3.1 的 KeywordAbility 只有 keyword / value，programs/keywords.ts 的
 *    expandProgram 仍以 `def.expand({ value, host })` 调用、不传契约 3.8.3 的 params.cost。
 *    本卡原先用 `value: 3` 记录印刷数值，但 827.1.c 的费用不是“数值关键词参数”：
 *    Empower.ts 明确 “a numeric keyword value never replaces the printed Empower cost”，
 *    value 3 与 0 展开结果相同，所以它只是描述性记录，不能当作 3 Energy 的费用。
 * 2. 费用管线不认识 empower 支付种类：cost/plan-values.ts 的 readCost 对非资源支付只接受
 *    exhaust / discard / recycle / kill / reveal / spend-buff，其余 blocked。实测
 *    describeActivate 抛 “Unsupported cost kind empower on activate:src:1:A:3”。
 * 3. 828.1.c 的门控本身可求值，但“依赖能力挂在 Empowered 上”还缺生产接线：
 *    programs/triggers.ts 的 triggerRegistrations 只从 keyword 展开出来的 activated 能力产生
 *    TriggerRegistration，而依赖能力的门控在 static/trigger 条件上；本卡触发在未 Empowered 时
 *    也会照常注册与触发（实测 trigger 注册结果为 program:src:1:1，无门控字段）。
 * 已合入并用真实执行验证的部分：[Empowered][>] When I move, draw 1. 的抽牌 body 本身是
 * 已合入的 effect.draw（414 系列），object-moved 触发过滤器也由 programs/filters.ts 正确翻成
 * 该来源对象的 objectId 过滤。不近似实现：不把 value 3 当成费用、不跳过 Empowered 门控。
 * 依赖：契约 3.8.3 的 KeywordAbility params 生产侧接线、empower 费用种类，以及依赖能力
 * （828.1.b.1）到触发器/静态层的门控接线。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    // 印刷的 :rb_energy_3: 无法从 KeywordAbility 送达 expand（见 judgeReason 第 1 条）；
    // 这里的 3 只保留印刷符号数的可审查记录，不被当作可执行费用。
    value: 3
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "covert-informant.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-a7852cd3cb51ac726ccf3fd549d64c739122b2160a5f283dd604718dda7c5bb6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口，均不近似实现：(1) 印刷的 Empower 费用送不进展开——827.1.c 的 “[Cost]: Empower this” 是 " +
    "CostSpec，而契约 3.1 的 KeywordAbility 只有 keyword / value，programs/keywords.ts 的 expandProgram " +
    "仍以 def.expand({ value, host }) 调用、不传契约 3.8.3 的 params.cost；本卡的 value: 3 只是印刷符号数记录，" +
    "Empower.ts 明确数值 keyword value 不能替代印刷 Empower 费用（value 3 与 0 展开相同）。" +
    "(2) 费用管线不认识 empower 支付种类：cost/plan-values.ts 的 readCost 对非资源支付只接受 exhaust / discard / " +
    "recycle / kill / reveal / spend-buff，其余 blocked(\"Unsupported payment kind\")；实测 describeActivate 抛 " +
    "“Unsupported cost kind empower on activate:src:1:A:3”。(3) 依赖能力（828.1.b.1/828.1.c）到触发器层的门控接线未合入：" +
    "programs/triggers.ts 的 triggerRegistrations 只为关键词展开出的 activated 能力产生注册，依赖能力的门控需要接到 " +
    "触发/静态条件上；实测范围内注册结果无门控字段，未 Empowered 时该触发也会照常成立。" +
    "已合入并用真实执行验证的部分：RIFT-593 的 Empower KeywordDef、object-property 的 empowered 状态读取（442.1.a）、" +
    "以及 「When I move, draw 1.」的 effect.draw body 与 object-moved 自身过滤（programs/filters.ts 正确翻成该来源对象的 objectId）。" +
    "依赖：契约 3.8.3 的 KeywordAbility params 生产侧接线、empower 费用种类、依赖能力门控接线。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] When I move, draw 1."
} satisfies CardProgram;
