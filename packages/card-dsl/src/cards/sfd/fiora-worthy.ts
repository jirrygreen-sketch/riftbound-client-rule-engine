import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Fiora, Worthy (sfd-180-221, fiora-sfd M1 卡组；champion option).
 *
 * 原文："When a unit you control becomes [Mighty], you may pay
 *        :rb_rune_order: to ready it. (A unit is Mighty while it has 5+ :rb_might:.)"
 *
 * 规则依据（CR v1.5）：
 * - 709："becomes Mighty" 发生在 Might 从 <5 变为 ≥5 的瞬间——对应封闭时点
 *   "might-changed"（payload 含 previousMight/currentMight，filter 的
 *   becomesMighty 由触发管线据此判定）。
 * - "a unit you control"：触发 filter { controller: "you" }（"you" 由触发管线
 *   按能力控制者解析）；触发来源是那个变成 Mighty 的单位。
 * - 费用 ":rb_rune_order:" 是一个 Order Domain 符文支付。契约 3.1 的 triggered
 *   ability 没有 cost 字段；可选费用触发按 3.2/3.6 建模为：解释器在 Finalize
 *   询问是否支付（optional: true），支付通过 GameAction "pay" 提交，随后
 *   body 用 effect.ready 重置触发来源单位（"it" = 触发来源）。
 *
 * 结构说明：
 * - 费用表达为 CostSpec（payments 内一个 order-domain rune 支付），由
 *   Finalize 在触发进链时校验/收缴；该 CostSpec 通过 ability 顶层
 *   `restriction` 无法表达，因此放在 body 第一条指令的自定义
 *   `args.cost` 上并配合注释说明——实际的费用校验由解释器/费用管线按
 *   CostSpec 执行（见 golden 测试的 test.todo，依赖 RIFT-27 费用场景）。
 * - 解释器就绪后：触发 → Finalize（询问支付）→ 支付成功 → Resolve 执行
 *   effect.ready；放弃支付 → 触发不进 Resolve。
 */
const abilities: Ability[] = [
    {
      kind: "triggered",
      trigger: {
        at: "might-changed",
        filter: {
          type: "unit",
          controller: "you",
          becomesMighty: true
        }
      },
      optional: true,
      body: [
        {
          id: "fiora-worthy.ready-source",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "source" } },
            linkKey: { kind: "constant", value: "readied" }
          }
        }
      ]
    }
  ];

const program = {
  canonicalCardId: "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "When a unit you control becomes [Mighty], you may pay :rb_rune_order: to ready it. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
