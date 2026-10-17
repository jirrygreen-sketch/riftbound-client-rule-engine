import type { CardProgram } from "../../ir/index.js";

/**
 * Siphoning Strike (ven-146-166) — Spell, 4 energy, no printed Power（power null 不改成 0）,
 * domains ["Calm", "Mind"], tags Nasus/Signature. Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-146-166，逐字）:
 *   "Deal 4 to a unit at a battlefield. If you control 7 or more runes, deal 7 to it instead. "
 *   "When it dies this turn, channel 1 rune exhausted."
 *
 * 规则依据（CR v1.5）：
 * - "Deal 4 to a unit at a battlefield"：418 的 Deal 动作，来源是该法术自身（418.6.a），
 *   非战斗伤害（418.1.c）。被点名的单位是目标（355.7/355.9.a.1），"at a battlefield" 是目标限制
 *   （355.10.b，用已合入的 location: "battlefield"），不是第二个目标。
 * - "If you control 7 or more runes, deal 7 to it instead"："if" 从句在 383.2.a.1 的意义上是
 *   条件从句（条件成立时改换数额），"instead" 表示两值互斥（158.2/367 的替代概念在此只是
 *   同一指令的取值替换）。符文计数按 431.1 的 Rune Zone 对象数（133.5.a.1 的符文即该区域的 OBJECT），
 *   用已合入的 count 表达式 + compare 判定；数额用同一条件的两个分支表达（4 / 7）。
 * - "When it dies this turn, channel 1 rune exhausted"："When … this turn" 是延迟触发能力
 *   （390/391.2/392：由结算中的法术创建、窗口为本回合 317.2.c），订阅的被消灭对象是本文的
 *   "it"（359.3.e.14 的结果引用：前一条伤害指令影响的那个单位），动作是 431.1/431.2 的
 *   Channel 1 rune exhausted（431.2.a：未另行规定则就绪进入，此处明写 exhausted）。
 *   838.x 的死亡时点在 events/timing-points.ts 为 object-killed（429.1/429.2）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。阻塞集中在延迟触发，不近似实现：
 * (1) 缺延迟触发注册："When it dies this turn" 是本法术创建的延迟触发能力（391.2/393），
 *     ResolveContext.registerDelayedTrigger 虽在契约 3.6 中，但 effects/instructions/ 没有
 *     卡牌可用的 trigger.delayed op，且 TriggerSpec.once 没有「该对象的这一次死亡」窗口；
 *     写成卡自身的触发能力会违反 393（同型记录见 rad/last-caress、rad/hexplosive-minefield）。
 * (2) 结算时对目标未来状态的订阅需要目标引用留存：object-killed 事件的对象与
 *     「that unit」的同一性需要在结算后仍能把锁定的目标引用与死亡事件对齐（程序触发
 *     注册 RIFT-257 已合入，缺的是上述 op 与一次性窗口）。
 * 已合入且可真实执行的部分：两条互斥 condition + count 已在 6/7 符文边界分别执行
 * 4/7 点伤害；不再把条件/链接管线视为缺口。effect.channel（431.1/431.2 的 exhausted
 * 进入）也有真实执行证据。待实现的是结算后保存同一个锁定目标的延迟死亡订阅。
 */
const siphoningStrike = {
  canonicalCardId: "card.hash-d47f05f65e0e87416c8e2c6dc0abce05f5a4a0bcb6855df1f6bf66a66acbaac6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "延迟触发仍有缺口，不近似实现：(1)「When it dies this turn, channel 1 rune exhausted」是本法术" +
    "创建的延迟触发能力（390/391.2/392/393，窗口为本回合 317.2.c）：ResolveContext.registerDelayedTrigger " +
    "虽在契约 3.6 中，但 effects/instructions/ 没有卡牌可用的 trigger.delayed op，" +
    "TriggerSpec.once 也没有「该锁定的这一次死亡」窗口；写成卡自身的触发能力会违反 393" +
    "（同型记录见 rad/last-caress、rad/hexplosive-minefield）。(2) 结算后把锁定的目标引用与" +
    "object-killed（429.1/429.2）事件的同一性对齐需要上述 op 与一次性窗口（程序触发注册 RIFT-257 已合入）。" +
    "已支持部分：「instead」用两条互斥 condition + count 表达 4 / 7（431.1/133.5.a.1），" +
    "golden 已在 6 与 7 符文边界执行并验证只有对应伤害分支生效；条件/链接管线不是剩余依赖。" +
    "effect.damage（418.1.c/418.6.a）与 effect.channel 1 rune exhausted（431.1/431.2/431.2.a）" +
    "均有真实解释器 + 参考内核执行证据。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Deal 4 to a unit at a battlefield. If you control 7 or more runes,
          // deal 7 to it instead."：条件不成立时的 4（431.1 的符文计数）。
          id: "siphoning-strike.deal-4",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: "siphoning-strike.unit" }
          },
          targets: [
            {
              id: "siphoning-strike.unit",
              filter: { type: "unit", zone: "board", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "runes",
              filter: { type: "rune", controller: "self", zone: "rune-zone" }
            },
            operator: "lte",
            right: { kind: "constant", value: 6 }
          }
        },
        {
          // "instead" 的另一分支：7 点；与第一分支互斥，引用同一个已锁定目标。
          id: "siphoning-strike.deal-7-instead",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 7 },
            target: { kind: "constant", value: "siphoning-strike.unit" }
          },
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "runes",
              filter: { type: "rune", controller: "self", zone: "rune-zone" }
            },
            operator: "gte",
            right: { kind: "constant", value: 7 }
          }
        },
        {
          // "When it dies this turn, channel 1 rune exhausted"：本法术创建的延迟触发能力，
          // 卡牌可用的 trigger.delayed op 未注册（见 judgeReason 第 1 点）；
          // 触发体是已合入的 effect.channel（431.1/431.2 的 exhausted 进入）。
          id: "siphoning-strike.delayed-channel",
          op: "trigger.delayed",
          linkedTo: "siphoning-strike.deal-4",
          args: {
            at: { kind: "constant", value: "object-killed" },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { target: "siphoning-strike.unit" } },
            body: {
              kind: "constant",
              value: [
                {
                  id: "siphoning-strike.channel-1",
                  op: "effect.channel",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    exhausted: { kind: "constant", value: true }
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
    "Deal 4 to a unit at a battlefield. If you control 7 or more runes, deal 7 to it instead. " +
    "When it dies this turn, channel 1 rune exhausted."
} satisfies CardProgram;

export default siphoningStrike;
