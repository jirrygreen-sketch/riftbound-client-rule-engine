import type { CardProgram } from "../../ir/index.js";

/**
 * Deadly Flourish (unl-073-219) — Spell, 4 energy, no printed power, no Might,
 * Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-073-219，逐字）：
 *   "Deal 3 to an enemy unit. When it dies this turn, play a Gold gear token
 *    exhausted. (It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add]
 *    :rb_rune_rainbow:.\")"
 *
 * 规则依据（CR v1.5）：
 * - 「Deal 3 to an enemy unit」：被选敌方单位是目标（355.7 / 355.9.a.1，
 *   355.10 的豁免都不适用），已合入的 effect.damage（418.1）可执行，source 缺省
 *   为该效果本身（418.6.a）。
 * - 「When it dies this turn」是延迟触发能力（390 / 391.2：以指定时间窗为限制的
 *   触发式能力；392：只在窗口内结算）；「dies」= 429 的 Kill，对应封闭时点
 *   object-killed（429.1、808.1.d），"this turn" 是 317.2.c 的到期窗口。
 *   "it" 指前一句的伤害目标（359.3.f.3），需要触发事件的对象绑定。
 * - 「play a Gold gear token exhausted」：187.5 规定 Gold 是带自身启动能力
 *   （"[Reaction][>] Kill this, [E]: [Add] [A]"）的无领域装备 token；被「Play」的
 *   token 按 440.2.c / 185.2.a 先在链上创建再由 play 接手，"exhausted" 是 184.1 /
 *   185.2.d 的入场状态改写。
 *
 * status = judge-required（2026-10-17 逐条对源码复核；不近似实现）：
 * - 没有卡牌可用的延迟触发注册原语：ResolveContext.registerDelayedTrigger（契约
 *   3.6，chain/engine.ts 有实现）存在，但 instructions/registry.generated.ts 的 42 个已注册
 *   op 里没有 trigger.delayed（实测 has() 为 false；解释器对 body 直接抛 "Unregistered
 *   instruction opcode: trigger.delayed"），"this turn" 的窗口/到期与 object-killed 的事件
 *   对象绑定（"it"）都没有落地；把能力写成卡自身的 triggered ability 会违反 391.1/393
 *   （延迟能力由效果创建、不依附卡本体）。
 * - Gold token 定义（187.5，带自身能力）不在 effect.token 的定义表：实测执行 token
 *   "gold" 返回 negated/impossible（表内只有 recruit/sand-soldier/mech/reflection/tentacle），
 *   带自身能力的 token 被显式阻断。
 * - "exhausted" 入场改写（143.4 / 184.1 / 185.2.d）不被 create-token 支持：argsSchema
 *   实测以 "Invalid effect.token argument: entersExhausted" 拒绝该参数；先创建再补
 *   effect.exhaust 会产生错误的「成为横置」事件，不用它冒充。
 * 「Deal 3」一半只用已合入的 effect.damage，golden 用解释器 + 参考内核真实执行。
 * 依赖：trigger.delayed 指令、token 定义表扩充（Gold，187.5）与入场状态改写。
 */
const deadlyFlourish = {
  canonicalCardId: "card.hash-8d3c943cc6d7e5b38e8f84d12956e763e4a25f10bf52c0950221efe9a6381132",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「When it dies this turn」是延迟触发能力（CR 390/391.2/392，窗口为 317.2.c 的本回合），" +
    "但指令注册表没有卡牌可用的 trigger.delayed opcode——已注册的 42 个 op 里没有它（实测 has() 为 false），" +
    "解释器对 body 直接抛 「Unregistered instruction opcode: trigger.delayed」；ResolveContext.registerDelayedTrigger 仍没有指令消费者，" +
    "object-killed（429.1）的事件对象绑定（\"it\"）与到期窗口都没有落地；写成卡自身的 triggered ability 会违反 391.1/393。" +
    "(2) Gold gear token 定义（CR 187.5，带自身 \"[Reaction][>] Kill this, [E]: [Add] [A]\" 能力）不在 effect.token 的定义表，" +
    "实测执行 token \"gold\" 返回 negated/impossible（表内只有 recruit/sand-soldier/mech/reflection/tentacle），带自身能力的 token 被显式阻断。" +
    "(3)「exhausted」是入场状态改写（143.4 / 184.1 / 185.2.d），create-token 不支持 entry override（实测 argsSchema 抛 " +
    "\"Invalid effect.token argument: entersExhausted\"）；先创建再补 effect.exhaust " +
    "会产生错误的「成为横置」事件，不用它冒充。\"Deal 3 to an enemy unit\" 一半只用已合入的 effect.damage，golden 真实执行。" +
    "依赖：trigger.delayed 指令、token 定义表扩充（Gold，187.5）与入场状态改写。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "deadly-flourish.deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "deadly-flourish.enemy-unit" }
          },
          targets: [
            {
              id: "deadly-flourish.enemy-unit",
              filter: { zone: "board", type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 未注册 op：延迟触发的保留形状（见 judgeReason）。
          id: "deadly-flourish.delayed-gold",
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "object-killed" },
            // "it" = 前一条伤害指令的目标；事件对象选择器缺失（同 virtuoso 的 "it" 缺口）。
            filter: {
              kind: "constant",
              value: {
                event: "object-killed",
                object: { target: "deadly-flourish.enemy-unit" }
              }
            },
            duration: { kind: "constant", value: "this-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "deadly-flourish.play-gold",
                  op: "effect.token",
                  args: {
                    token: { kind: "constant", value: "gold" },
                    amount: { kind: "constant", value: 1 },
                    mode: { kind: "constant", value: "play" },
                    location: {
                      kind: "constant",
                      value: { type: "base", player: "controller" }
                    },
                    // 184.1 / 185.2.d 的入场状态：create-token 尚不支持（见 judgeReason）。
                    entersExhausted: { kind: "constant", value: true },
                    linkKey: { kind: "constant", value: "goldToken" }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Deal 3 to an enemy unit. When it dies this turn, play a Gold gear token exhausted. " +
    "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")"
} satisfies CardProgram;

export default deadlyFlourish;
