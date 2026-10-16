import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dragonsoul Sage (unl-093-219) — Unit, 2 energy，无印刷力量，Might 1，Body，
 * 标签 Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-093-219，逐字）：
 *   [Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. (Abilities that add resources
 *   can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - 813.1.d / 813.1.c.2：能力上的 “[Reaction][>]” 是 Closed State 启动许可；契约 3.1 的
 *   ActivatedAbility.timing 只有 "action" | "reaction" 两档，因此声明 timing: "reaction"，
 *   许可展开（continuous.timing）由 keywords/Reaction.ts 负责（与 ogn/energy-conduit、
 *   ogn/seal-of-rage 同型）。
 * - 415.3.a / 415.5：冒号前的 :rb_exhaust: 是“横置本来源”的启动费用；合并费用管线
 *   （cost/payment.ts 的 checkAction）支持 { kind: "exhaust", object: "self" } 在 Board 上的
 *   来源，并按其 415.1.b/415.1.c 语义拒绝已横置的来源。
 * - 430.1 / 430.5：“[Add] :rb_energy_1:” 是 Add 动作，把 1 Energy 放进符文池；
 *   effect.resources 提交 gain-energy。430.2/430.2.a：Add 能力 Finalize 后立即结算、
 *   不传递 Priority/Focus（由链与调用方负责），430.3 允许带 [Reaction] 的 Add 在支付资源时启动。
 *   括号提醒（430.2.a / 204.4.b.1）是说明文本，不是另一条能力。
 *
 * status = executable：费用（exhaust 自身）、Reaction 时机声明与 effect.resources 都有已合入的
 * 实现路径；golden 用真实费用计划（buildCostPlan/payCostPlan）+ 解释器（resolveChainBody）
 * 执行程序自己的 cost 与 body，并覆盖“来源已横置则付不出费用”的边界（415.1.b/415.1.c）。
 * Reaction 的 continuous.timing 展开没有图层消费方（RIFT-91），但链读取的是能力自身的
 * timing 字段（与 energy-conduit 相同）。
 */
const abilities: Ability[] = [
  // 813.1.d：“[Reaction]” 写在能力上；卡内只声明关键词（README 第 5 节）。
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "activated",
    // 415.3.a / 415.5：“:rb_exhaust:” = 横置本来源的启动费用。
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    // 813.1.c.2：“[Reaction][>]” 把该启动能力改写为 Closed State 许可。
    timing: "reaction",
    body: [
      {
        id: "dragonsoul-sage.add-energy",
        // 430.1 / 430.5：“[Add] :rb_energy_1:” = 加 1 Energy。
        op: "effect.resources",
        args: { energy: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-774ce414b4ee3d0b43aea5f3068e27d3c37a9ea7ef7a2dc53a6716201702d11f",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
