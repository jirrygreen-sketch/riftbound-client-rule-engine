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
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - "recycle a rune" 的触发缺少可判定载荷与注册路径：events/trigger-spec.ts 的封闭
 *   EVENT_PATTERN_TYPES 没有 card-recycled 项（assertTriggerSpec 会拒绝该事件名），且该时点逐张
 *   发出、没有"你负责的这次回收"的批次谓词（ogn/karma-channeler 记录同一缺口）；"a rune" 需要
 *   对象类型过滤，而 417.1.b 的符文回收在合并载荷里只有 fromZone/toZone 字段。
 * - Gold token 定义不在 effect.token 的冻结定义表里（文件头记录：需要自身能力的定义包括 Gold 保持
 *   blocked/judge-required）；"exhausted" 是 143.4/185.2.d 的入场状态规定，create-token 明确不支持
 *   入场改写，事后补 effect.exhaust 不等价。
 * - 费用式 "exhaust me" 依赖 legend-zone 表达（契约 3.6 的 ZoneId 无 Legend Zone，CR 108.3）与
 *   卡牌侧的收费入口（cost.pay / cost.modify 属未合入的 RIFT-261）；没有把 CardProgram 的 triggered
 *   ability 注册成 TriggerRegistration 的订阅方（RIFT-257；同 darius-executioner/the-dreaming-tree）。
 * - "one or more enemy units die" 的批次与责任归因同样缺失：object-killed 逐单位发出，载荷 player
 *   是被消灭对象的控制者（events/action-adapter.ts），trigger.state 无批次分组，once 作用域也无 per-batch
 *   （ogn/radiant-dawn 记录同一缺口）；因此"一次战斗同时死两个敌方单位"会触发两次而不是一次。
 * 依赖：RIFT-257（链与事件单管线的卡程序触发注册）、RIFT-261（费用计划消费方），以及 legend-zone 与
 * Gold token 定义/入场状态的契约补充、object-killed 的批次与责任归因。
 * golden 测试用解释器 + 参考内核真实执行已合入的 effect.ready 与费用计划的 exhaust 收费；整卡仍不可执行。
 * 不近似实现（不用另一个 token 定义冒充 Gold，不把批次触发写成逐单位触发）。
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
    "（1）「When you recycle a rune」缺可判定载荷与注册路径：events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 没有 card-recycled 项" +
    "（assertTriggerSpec 会拒绝该事件名），该时点逐张发出且没有「你负责的这次回收」批次谓词，「a rune」的类型过滤（185.1 符文不是卡）也无消费方（同 ogn/karma-channeler）；" +
    "（2）Gold token 定义缺失：187.5 的 Gold 是带自身能力（\"Kill this, [E]: [Add] [A]\"）的 gear token，effect.token 的冻结定义表按设计保持 blocked/judge-required；" +
    "（3）「exhausted」是 143.4/185.2.d 的入场状态规定，但 create-token 明确不支持入场改写（effect.token），事后补 effect.exhaust 不等价；" +
    "（4）费用式「exhaust me」（415.4/415.5）依赖 legend-zone 表达（契约 3.6 的 ZoneId 无 Legend Zone，CR 108.3）与卡牌侧收费入口（cost.pay 属未合入的 RIFT-261）；" +
    "（5）没有已合入的订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（未合入的 RIFT-257；同 darius-executioner/the-dreaming-tree）；" +
    "（6）「one or more enemy units die」缺批次与责任归因：object-killed 逐单位发出且载荷 player 是被消灭对象的控制者（events/action-adapter.ts），" +
    "trigger.state 无批次分组、once 作用域无 per-batch（同 ogn/radiant-dawn），一次战斗同时消灭两个敌方单位会触发两次而不是一次，370.1.a.2/383.1.b 的同时事件语义无法表达。" +
    "依赖：RIFT-257、RIFT-261，以及 legend-zone 与 Gold token 定义/入场状态的契约补充、object-killed 的批次与责任归因。" +
    "effect.ready 与费用计划的 exhaust 支付已合入并单独测试；整卡不可执行，不近似实现。",
  abilities,
  sourceText:
    "When you recycle a rune, you may exhaust me to play a Gold gear token exhausted.\n" +
    "When one or more enemy units die, ready me."
} satisfies CardProgram;

export default program;
