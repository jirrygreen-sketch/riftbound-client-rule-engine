import type { CardProgram } from "../../ir/index.js";

/**
 * Butcher of the Sands (ven-141-166) — Legend, Fury/Body, tag Renekton.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-141-166，逐字）：
 *   [Reaction][>] :rb_rune_rainbow::rb_rune_rainbow:, :rb_exhaust:: [Add]
 *   :rb_energy_2:. Spend this Energy only to play units or activated abilities of
 *   units.
 *
 * 规则依据（Core Rules v1.5）：
 * - 813.1.d / 813.1.c：[Reaction][>] 是修饰其后启动能力的 Closed State 许可关键词；
 *   契约 3.1 用 activated.timing = "reaction" 记录（与 ogn-253-298 Hand of Noxus 一致）。
 * - 204.1.b / 415.5：印刷费用是「:」前的两个 :rb_rune_rainbow: 与 :rb_exhaust:。两个
 *   :rb_rune_rainbow: 即两个 [A]（任意域 Power，135.2.e.5.a / 163.2.b），:rb_exhaust:
 *   即 Exhaust 此来源。
 * - 430.1 / 430.2 / 430.2.a / 168：[Add] 把资源加入 Rune Pool，触发式与启动式 Add 能力
 *   Finalize 后立即结算、不传递 Priority/Focus；effect.resources 的 energy 参数即该动作。
 * - 「Spend this Energy only to play units or activated abilities of units」是对这批
 *   Energy 的花费限制（Rune Pool 的受限资源）；它不是一条独立指令。
 *
 * 复核（2026-10-17，第一轮 M2 覆盖率复核）：原 judgeReason 的第 1 条（:rb_rune_rainbow: 不可
 * 表达）已不成立——合并费用管线的 payment 形状用 `{ kind: "power", amount, allowedDomains }`
 * 表达任意域 Power 需求（cost/plan-values.ts 的 domains()；所有六域 = 135.2.e.5.a 的 [A]，
 * 135.2.e.5.b 的「任意域的 Power 都能支付」），dragon-roost / power-nexus 等卡已按该形状写出
 * 并于 cost-plan 真实执行。因此本卡的印刷费用写成两条各 1 点、allowedDomains 覆盖六域的 Power
 * 需求（印刷的两个符号 = 两条 1 点需求，不是一个 2 点需求），golden 用真实费用计划 + 支付管线
 * 断言「任意域 Power 均能支付」与 Exhaust 横置。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：逐项对照当前源码，唯一缺口仍然成立。
 *
 * status = judge-required（唯一剩余缺口）：
 * 「Spend this Energy only to play units or activated abilities of units」是受限资源的花费限制。
 * 契约 3.6 的 GameAction 集合只有无用途标签的 `gain-energy`（contract.ts：
 * `{ type: "gain-energy"; player; amount }`，无 purpose / restriction 字段），ResolveContext /
 * PlayerSnapshot 都不暴露「带用途标签的 Energy」，EffectIR 也没有受限资源形状；
 * effect.resources 等 42 个已注册 op 里没有对应原语，continuous.restrict 的 restriction 标签
 * 也只覆盖 target / movement / action 等动作级许可，不表达“这批 Energy 只能用于某些用途”。
 * 因此不能用 restriction 或某个 continuous.effect 近似：把 2 Energy 视为无限制资源会让本卡
 * 比印刷更强，所以不能标记 executable。
 * 依赖：受限资源 / 花费限制原语（含 204.4 的 applied-cost 之外的用途标签形状）。
 * 印刷费用与 Add 本体都已用真实 cost plan + payment + 解释器执行（exhaust 横置、六域 Power、
 * effect.resources 的 2 Energy），只是不含用途标签。
 */
const butcherOfTheSands = {
  canonicalCardId: "card.hash-fd135b06be83d09c3f8ab5d01c8c2625b0ae9ea0392ea903d7ac2fae20d61237",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一剩余缺口：「Spend this Energy only to play units or activated abilities of units」是受限资源的花费限制。" +
    "契约 3.6 的 GameAction 集合只有无用途标签的 gain-energy（contract.ts 的 " +
    "{ type: \"gain-energy\"; player; amount }，无 purpose / restriction 字段），PlayerSnapshot / ResolveContext " +
    "不暴露按用途受限的 Energy，EffectIR 也没有受限资源形状；已注册的 42 个 op（含 effect.resources）里" +
    "没有对应原语，continuous.restrict 的 restriction 标签只覆盖 target / movement / action 等动作级许可，" +
    "没有承载“这批 Energy 只能用于某些用途”的形状，因此不能用 restriction / continuous.effect 近似；" +
    "把 Add 出的 2 Energy 当成无限制资源会让本卡比印刷更强。" +
    "印刷费用本身已可执行：两个 :rb_rune_rainbow:（135.2.e.5.a 的 [A]）用两条 amount 1、allowedDomains 覆盖" +
    "全六域的 Power 需求表达（cost/plan-values.ts 的 domains()，与 dragon-roost / power-nexus 同形状），" +
    "golden 用真实 cost plan + payment 断言任意域 Power 均可支付、单域不足时拒绝，以及 Exhaust 横置；" +
    "effect.resources 的 Add 2 Energy 本体也已合入并真实执行。依赖受限资源 / 花费限制原语。不近似实现。",
  abilities: [
    {
      kind: "activated",
      // [Reaction][>]：能力级许可关键词，按契约 3.1 用 activated.timing 记录（813.1.c）。
      timing: "reaction",
      cost: {
        kind: "activated",
        // :rb_rune_rainbow::rb_rune_rainbow: = 两个 [A]：135.2.e.5.a 的「任意域 Power 均可支付」
        // 用 allowedDomains 覆盖全部六域表达（cost/plan-values.ts 的 domains() 读该形状，
        // 与 dragon-roost / power-nexus 一致）。两个印刷符号走两条 1 点需求。
        payments: [
          {
            kind: "power",
            amount: { kind: "constant", value: 1 },
            allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
          },
          {
            kind: "power",
            amount: { kind: "constant", value: 1 },
            allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
          },
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          id: "butcher-of-the-sands.add-energy",
          op: "effect.resources",
          // [Add] :rb_energy_2:：向控制者 Rune Pool 加 2 Energy（430.1、168）。
          args: { energy: { kind: "constant", value: 2 } }
          // 「Spend this Energy only to …」的用途限制没有可表达形状（见 judgeReason），
          // 这里不写伪造的 restriction：受限资源的标签需要契约层面的新形状。
        }
      ]
    }
  ],
  sourceText:
    "[Reaction][>] :rb_rune_rainbow::rb_rune_rainbow:, :rb_exhaust:: [Add] :rb_energy_2:. " +
    "Spend this Energy only to play units or activated abilities of units."
} satisfies CardProgram;

export default butcherOfTheSands;
