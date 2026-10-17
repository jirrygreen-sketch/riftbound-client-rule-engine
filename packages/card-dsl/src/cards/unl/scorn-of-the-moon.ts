import type { CardProgram } from "../../ir/index.js";

/**
 * Scorn of the Moon (unl-197-219) — Legend, Mind/Chaos, tag Diana.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-197-219，逐字）：
 *   [Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. Spend this Energy only
 *   during showdowns. (Abilities that add resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.4 / 415.5：「:」之前的 :rb_exhaust: 是启动能力的费用
 *   「Exhaust me」；合并费用管线（cost/plan-values.ts、cost/payment.ts）支持
 *   { kind: "exhaust", object: "self" } 的支付种类。
 * - 174.8 / 376：Legends 可以有启动能力，能力进链并像法术一样结算。
 * - 813.1 / 813.1.c.2 / 813.1.d：能力上的 [Reaction] 是 Closed State 的启动许可，
 *   IR 用 activated.timing = "reaction" 声明。
 * - 430.1 / 430.2 / 430.2.a / 430.5：[Add] :rb_energy_1: 是 Add 行动，把 1 Energy
 *   加入控制者的 Rune Pool；触发式/启动式 Add 能力 Finalize 后立即结算，不传递
 *   Priority / Focus（由链与费用管线负责），用 effect.resources 的 energy 参数表达。
 *
 * status = judge-required：
 * 两处当前缺口：(1) Spend this Energy only during showdowns（CR 166.1–166.3/167.1）：Rune Pool 只有玩家级 Energy 计数，
 * gain-energy 与 effect.resources 没有每笔资源的来源/使用窗口限制，费用支付也无法筛选该笔 Energy。
 * 不能把 Reaction 的 813.1 启动许可收紧为仅 showdown 来代替资源使用限制。需扩展资源入账与支付限制契约。
 * (2) programs/activate.ts 将本能力描述为 activated；chain/ 只为 kind:add 提供 430.2 的 Finalize 后立即结算，
 * 尚缺卡牌 Add 能力分类到该生产路径的适配，不能将普通启动能力的 Priority 窗口当作等价物。
 */
const scornOfTheMoon = {
  canonicalCardId:
    "card.hash-37e8098b66aae3a20774fb0fe94cc57402e8f238fc4c5f72a1e46172b0cfece9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) Spend this Energy only during showdowns（CR 166.1–166.3/167.1）：Rune Pool 只有玩家级 Energy 计数，" +
    "gain-energy 与 effect.resources 没有每笔资源的来源/使用窗口限制，费用支付也无法筛选该笔 Energy。" +
    "不能把 Reaction 的 813.1 启动许可收紧为仅 showdown 来代替资源使用限制。需扩展资源入账与支付限制契约。" +
    "(2) programs/activate.ts 将本能力描述为 activated；chain/ 只为 kind:add 提供 430.2 的 Finalize 后立即结算，" +
    "尚缺卡牌 Add 能力分类到该生产路径的适配，不能将普通启动能力的 Priority 窗口当作等价物。",
  abilities: [
    // 813.1.d：能力上的 [Reaction] 打印在整个能力前（印刷为 [Reaction][>]）。
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "activated",
      // 813.1 / 813.1.c.2：Reaction 授予 Closed State 的启动许可。
      timing: "reaction",
      cost: {
        kind: "activated",
        // 404.1.a / 415.5：印刷的 :rb_exhaust: = 「Exhaust me」。
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          // 430.1 / 430.5：「[Add] :rb_energy_1:」= 加 1 Energy（无 Power、无域）。
          // 该 Energy 的使用窗口限制见 judgeReason，不写成会被 schema 拒绝的参数。
          id: "scorn-of-the-moon.add-energy",
          op: "effect.resources",
          args: { energy: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. Spend this Energy only during showdowns. " +
    "(Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default scornOfTheMoon;
