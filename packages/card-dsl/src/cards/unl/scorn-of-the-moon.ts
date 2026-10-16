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
 *   IR 用 activated.timing = "reaction" 声明（展开属关键词注册表 813 / RIFT-84）。
 * - 430.1 / 430.2 / 430.2.a / 430.5：[Add] :rb_energy_1: 是 Add 行动，把 1 Energy
 *   加入控制者的 Rune Pool；触发式/启动式 Add 能力 Finalize 后立即结算，不传递
 *   Priority / Focus（由链与费用管线负责），用 effect.resources 的 energy 参数表达。
 *
 * status = judge-required（唯一缺口是「Spend this Energy only during showdowns」）：
 * - 那句是对「本次 Add 产生的 Energy」的使用限制。合并的 Rune Pool 是玩家级的
 *   { energy: number }（effects/contract.ts 的 PlayerSnapshot / cost/resources.ts 的
 *   DuelRunePool），166.1-166.3 / 167.1 把 Energy 记为单一池，没有「某笔 Energy 只能
 *   在某个窗口花」的来源/限制追踪；契约 3.6 的 GameAction 也没有带用途限制的
 *   gain-energy（只有 { type: "gain-energy", player, amount }），effect.resources 的
 *   参数表（energy / power / player / target / pick / choiceId / linkKey）没有
 *   restriction / window 字段，费用侧同样没有「只能支付某种 Cost」的过滤。
 *   因此「Spend this Energy only during showdowns」无法表达：把限制写成声明性参数
 *   会被原语 schema 拒绝（不近似实现），把 Add 收紧成只有 showdown 时可启动又改变了
 *   813.1 的许可（本能力在 Closed State 也可启动，只是加出来的 Energy 有使用窗口）。
 * 已支持的 Add 半段（430.1 / 430.5）、reaction 时机与 Exhaust 费用在 golden 里真实执行。
 *
 * 依赖：Rune Pool 的来源/用途限制模型（契约变更：带 restriction 的资源入账与支付过滤）
 * 与 813 的关键词展开接线（RIFT-84）；在此之前整卡保持 judge-required。
 */
const scornOfTheMoon = {
  canonicalCardId:
    "card.hash-37e8098b66aae3a20774fb0fe94cc57402e8f238fc4c5f72a1e46172b0cfece9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一缺口是「Spend this Energy only during showdowns」无法表达：合并的 Rune Pool 是玩家级单一 Energy 计数" +
    "（effects/contract.ts 的 PlayerSnapshot / cost/resources.ts 的 DuelRunePool；CR 166.1-166.3 / 167.1），" +
    "没有「某笔 Energy 只能在某个窗口花」的来源与用途限制追踪；契约 3.6 的封闭 GameAction 只有 " +
    "{ type: \"gain-energy\", player, amount }，没有带用途限制的入账，effect.resources 的参数表" +
    "（energy/power/player/target/pick/choiceId/linkKey）也没有 restriction/window 字段，费用侧同样没有按用途过滤支付来源的接口。" +
    "把限制写成声明性参数会被原语 schema 拒绝，把 Add 收紧成只有 showdown 时可启动又改变 813.1 的许可" +
    "（本能力在 Closed State 也可启动，受限的是加出来的 Energy 的使用窗口），两者都不是该句的语义，故不近似实现。" +
    "已支持部分：[Reaction] 的 reaction 时机（813.1.c.2）、Exhaust 启动费用（404.1.a/415.4/415.5）与 effect.resources 的 Add 1 Energy" +
    "（430.1/430.2/430.5），golden 用真实费用计划与参考内核执行。依赖：Rune Pool 用途限制模型（契约变更）与 813 关键词展开接线（RIFT-84）。",
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
