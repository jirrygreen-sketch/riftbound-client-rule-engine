import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Battle Mistress (sfd-203-221) — Legend, Body/Chaos, tag Sivir.
 * energy: null / power: null / might: null（传奇没有印刷费用与 Might；null 不是 0）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-203-221，逐字）:
 *   "When you recycle a rune, you may exhaust me to play a Gold gear token exhausted.\n"
 *   "When one or more enemy units die, ready me."
 *
 * 规则依据（CR v1.5）：
 * - "When you recycle a rune"：417.1/417.1.b 规定 Recycle 是"从某区域取牌放到对应牌库底"的动作，
 *   符文回到 Rune Deck（417.1.b）；事件管线为 recycle 动作发出 card-recycled 时点
 *   （events/action-adapter.ts 的 ACTION_TIMINGS，载荷含 fromZone/toDeck 与对象）。"you" =
 *   能力控制者（412.4：你负责的游戏动作）。符文不是卡（185.1），所以要用对象类型过滤出 rune。
 * - "you may exhaust me to play a Gold gear token exhausted."：[do X] to [do Y] 的代价式结构
 *   （740.4.a.2：触发能力效果首段的代价在 Finalization 支付）；415.5 说明能力里的 :rb_exhaust:
 *   是费用 "Exhaust me"，415.4 要求该动作必须能完成。"you may" 是效果首段的可选项（403.1/383.3.a），
 *   因此 optional = true，并按契约 3.9 把被选指令包进 choice.optional 的 body。
 * - "play a Gold gear token exhausted"：440.2.c / 185.2.a 的链上生成后打出；185.2.d / 143.4 的
 *   入场状态；187.5 的 Gold 定义（"A Gold gear token is a domainless gear token with
 *   \"[Reaction][>] Kill this, [E]: [Add] [A].\""，同 canonicalCardId 的 sfd-t03 / unl-t05）。
 *   effect.token 的 argsSchema 没有入场状态参数（文档记录 "Entry overrides are not supported"），
 *   所以打印的 "exhausted" 只写在理由里。
 * - "When one or more enemy units die, ready me." 是 383.4/429.1 的死亡触发（时点 object-killed，
 *   refs 429.1/429.2/808.1.d）。枚举里的 "one or more" 是按批次判一次的触发（383.1.b 的
 *   Nth-time 同时发生语义；370.1.a.2 规定同一游戏动作造成的多个死亡是同时事件）；
 *   "enemy" 用 740.1.b（一方是另一方的对手）表达为 controller: "opponent"。"ready me" 用已合入的
 *   effect.ready，缺省选择即能力来源（412.4/416.1）。
 *
 * 当前复核：保持 judge-required；具体未接通路径见 judgeReason。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    // "When you recycle a rune"：417.1/417.1.b 的回收事件；事件名 card-recycled 在封闭
    // EVENT_PATTERN_TYPES 之外，见 judgeReason。
    trigger: {
      at: "card-recycled",
      filter: {
        event: "card-recycled",
        player: "self",
        // "a rune"：符文不是卡（185.1），用对象类型过滤。
        object: { type: "rune" }
      }
    },
    optional: true,
    body: [
      {
        id: "battle-mistress.may-play-gold",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Exhaust Battle Mistress to play a Gold gear token exhausted?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // "exhaust me"：740.4.a.2 的费用在 Finalization 支付（415.4/415.5）；
                // 形状是费用计划，不是 effect.exhaust 的状态改变。
                id: "battle-mistress.pay-exhaust",
                op: "cost.pay",
                args: {
                  payments: {
                    kind: "constant",
                    value: [{ kind: "exhaust", object: "self" }]
                  }
                }
              },
              {
                // "play a Gold gear token exhausted"：187.5 的 Gold 定义 + 440.2.c/185.2.a 的
                // 链上生成后打出 + 185.2.d/143.4 的入场状态；两条依赖都不可执行，见 judgeReason。
                id: "battle-mistress.play-gold",
                op: "effect.token",
                linkedTo: "battle-mistress.pay-exhaust",
                args: {
                  token: { kind: "constant", value: "gold" },
                  amount: { kind: "constant", value: 1 },
                  mode: { kind: "constant", value: "play" },
                  // 打印的 "exhausted" 是 185.2.d/143.4 的入场状态规定；effect.token 的
                  // argsSchema 没有该参数（Entry overrides are not supported），故不写进 args。
                  linkKey: { kind: "constant", value: "goldToken" }
                }
              }
            ]
          }
        }
      }
    ]
  },
  {
    kind: "triggered",
    // "When one or more enemy units die"：429.1/429.2 的死亡触发；740.1.b 的 "enemy" 用
    // controller: "opponent" 表达。"one or more" 的批次语义见 judgeReason。
    trigger: {
      at: "object-killed",
      filter: {
        event: "object-killed",
        object: { type: "unit", zone: "board", controller: "opponent" }
      }
    },
    optional: false,
    body: [
      {
        // "ready me"：缺省选择即能力来源（412.4/416.1）。
        id: "battle-mistress.ready-self",
        op: "effect.ready",
        args: {}
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-01131fb927733e60c9009e61900d2495713b314af34ab00ef3cddc7512efe6be",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "card-recycled 仍不在 events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 中：action-adapter 确实为 recycle 发该时点，但本卡的事件过滤器过不了 validateTriggerSpec（invalid-event-type），programs/triggers.ts 无法注册。" +
    "187.5 的 Gold（带自身印刷能力的 gear token）不在 effect.token 的定义表：以 \"gold\" 请求会以 impossible + token-definition-or-abilities-judge-required 结束；143.4/185.2.d 的 exhausted 入场覆盖也没有参数（argsSchema 只接受 token/amount/mode/location/target/pick/locations/choiceId/linkKey），不能事后 exhaust 代替。" +
    "开头 “you may exhaust me to” 的基础费用无声明处：TriggeredAbility 没有 cost 字段，programs/triggers.ts 也不填 TriggerRegistration.cost（383.3.b.1/415.4/415.5）；付款对象另缺 legend-zone（107.4）——effects/contract.ts 的封闭 ZoneId 与 cost.payments 都不接受该区域。" +
    "“one or more enemy units die” 缺同一游戏动作的死亡批次聚合：object-killed 按对象各自发出（payload 的 simultaneousGroup 用对象 ref.id），没有按 370.1.a.2 合并同时死亡的批 id 供触发去重。",
  abilities,
  sourceText:
    "When you recycle a rune, you may exhaust me to play a Gold gear token exhausted.\n" +
    "When one or more enemy units die, ready me."
} satisfies CardProgram;

export default program;
