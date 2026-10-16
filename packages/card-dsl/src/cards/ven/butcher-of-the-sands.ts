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
 * status = judge-required（三处缺口均不近似实现）：
 * 1. :rb_rune_rainbow: = [A]（任意域 Power，163.2.b）无法在六域封闭 Domain 集合中表达；
 *    effect.resources 已明确记录「Universal Power 不可表达，绝不用某个选定的域近似」。
 * 2. 「Spend this Energy only to play units or activated abilities of units」是不可表达的
 *    花费限制：契约 3.6 的 GameAction 集合只有无标签的 gain-energy，ResolveContext /
 *    PlayerSnapshot 都不暴露「带用途标签的 Energy」；EffectIR 也没有「受限资源」形状，
 *    因此不能用 restriction 或某个 continuous.effect 近似（RIFT-9 清单里没有对应原语）。
 * 3. 启动能力 → 链的生产接线（ActivatedAbility 进入 Finalize / Reaction Add 支付窗口，
 *    430.3）未合入；本卡能力因此只作为数据存在，没有可执行入口。
 * effect.resources 的 Add 2 Energy 本体已合入，golden 用真实解释器 + 参考内核执行该子效果
 * （不带用途标签，见上面的缺口 2）。
 * 依赖：Universal Power 表达（契约变更请求）、受限资源 / 花费限制原语与 RIFT-89（费用与
 * 启动接线）。
 */
const butcherOfTheSands = {
  canonicalCardId: "card.hash-fd135b06be83d09c3f8ab5d01c8c2625b0ae9ea0392ea903d7ac2fae20d61237",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 印刷费用里的 :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5.a、163.2.b），" +
    "内核 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，无法表达；effect.resources 已记录" +
    "「绝不用某个域近似」，程序里以描述性 [\"rainbow\"] 记录。 " +
    "(2) 「Spend this Energy only to play units or activated abilities of units」是受限资源的花费限制：" +
    "契约 3.6 的 gain-energy 不带用途标签，PlayerSnapshot / ResolveContext 不暴露受限 Energy，" +
    "EffectIR 也没有受限资源的形状，无法用 restriction / continuous.effect 近似（RIFT-9 清单无对应原语）。 " +
    "(3) ActivatedAbility → 链的 Finalize 接线与 430.3 的 Reaction Add 支付窗口未合入，能力没有可执行入口。 " +
    "effect.resources 的 Add 2 Energy 子效果已合入，golden 用真实解释器执行（不含用途标签）。 " +
    "依赖 Universal Power 表达（契约变更请求）、受限资源原语与 RIFT-89。不近似实现。",
  abilities: [
    {
      kind: "activated",
      // [Reaction][>]：能力级许可关键词，按契约 3.1 用 activated.timing 记录（813.1.c）。
      timing: "reaction",
      cost: {
        kind: "activated",
        // :rb_rune_rainbow::rb_rune_rainbow: = 两个 [A]；六域封闭集合无对应值，保留
        // 描述性记号（与 RIFT-238 的 Matriarch of War 同写法）。
        power: { kind: "constant", value: ["rainbow", "rainbow"] },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "butcher-of-the-sands.add-energy",
          op: "effect.resources",
          // [Add] :rb_energy_2:：向控制者 Rune Pool 加 2 Energy（430.1、168）。
          args: { energy: { kind: "constant", value: 2 } }
          // 「Spend this Energy only to …」的用途限制没有可表达形状（见 judgeReason 第 2 条），
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
