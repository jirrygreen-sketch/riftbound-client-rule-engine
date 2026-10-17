import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ashe, Focused — CR v1.5 383.4.a (Play Effect), 425.3 (reveal),
 * 428.1 (banish), 383.4.d/391.5 (delayed linked hold return).
 *
 * 复核后仍缺两处（均不近似实现）：
 * 1. 「choose an opponent」是玩家目标（355.7/355.9.a）。契约 3.6 的 TargetSpec 与
 *    ResolveContext.targets() 只承载 ObjectRef[]，ChoiceRequest 也只有 optional /
 *    mode / select-objects / order / number 五种形状，没有玩家目标请求；因此无法把
 *    选择结果绑定到 effect.reveal.player（对手手牌所有者）与后续弃放逐选择范围。
 * 2. 「When they hold, return it」是 383.4.d / 391.5 的 Delayed Linked Ability。
 *    引擎侧入口已合入：ResolveContext.registerDelayedTrigger 会把 delayed:true 的
 *    注册交给 pipeline（events/pipeline.ts 对 delayed 注册跳过 activeZones 过滤，
 *    来源离场仍触发）。缺的是卡牌指令侧的延迟触发声明与「本次 banished 的那一张」
 *    关联窗口：指令集没有 delayed-trigger 写入原语，IR 也没有跨能力读取 effect.banish
 *    的 linkKey 回执的形状，所以无法把返回限定到本次放逐牌，也无法把它绑到所选对手。
 *    本程序第二条触发的 trigger.filter.player 是 "chosen-opponent" 占位，不是已解析的
 *    玩家选择结果；普通在场触发不能替代延迟能力，也不把任意 banishment 目标近似成该牌。
 */
const REVEAL_HAND = "ashe-focused.reveal-hand";
const BANISH_CHOSEN = "ashe-focused.banish-chosen";
const RETURN_BANISHED = "ashe-focused.return-banished";

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: REVEAL_HAND,
        op: "effect.reveal",
        args: {
          // “They reveal their hand”：被选对手公开整手牌（425.3.a：不带 count＝
          // 展示区域当前全部牌）；玩家绑定缺口见 judgeReason 第 1 点，这里的
          // “opponent” 是占位（golden 用具体对手 B 执行）。
          player: { kind: "constant", value: "opponent" },
          zone: { kind: "constant", value: "hand" }
        }
      },
      {
        id: BANISH_CHOSEN,
        op: "effect.banish",
        args: {
          objects: {
            kind: "constant",
            value: {
              // 355.10.a：手牌不是公共区域 → 结算期非目标选择；428.1：放逐。
              choose: "ashe-focused.banish-choice",
              // 候选来源是刚才展示的手牌；choose 只接受 filter，无法收窄到“本次
              // 展示的那些引用”，故这里按对手手牌记录范围（见 judgeReason 第 1 点）。
              filter: { zone: "hand", owner: "opponent" },
              chooser: "self",
              visibility: "public"
            }
          },
          amount: { kind: "constant", value: 1 },
          // 428.1 的回执供本卡第二条能力引用；跨结算保存该关联仍是延迟声明缺口
          // （见 judgeReason 第 2 点）。
          linkKey: { kind: "constant", value: "asheBanished" }
        },
        linkedTo: REVEAL_HAND
      }
    ]
  },
  {
    // 383.4.d / 391.5：
    // “When they hold, return it to their hand”是绑定同一张牌的 Delayed Linked
    // Ability；registerDelayedTrigger 的生产入口已合入，但卡牌指令侧还没有延迟触发
    // 声明与本次放逐牌的关联窗口（见 judgeReason 第 2 点），hold 的玩家范围也仍是
    // 占位（第 1 点）。因此第二条触发只保留可审查形状，不写成无条件近似。
    kind: "triggered",
    trigger: {
      at: "hold",
      filter: { event: "hold", player: "chosen-opponent" }
    },
    optional: false,
    body: [
      {
        id: RETURN_BANISHED,
        op: "effect.zone",
        args: {
          // 448.2：换区不是 Move；108.7.a：进入拥有者手牌——即使本卡已离场
          // （359.3.e.13 的最后已知信息）也不改变目的区域。
          target: { kind: "constant", value: "ashe-focused.banished-card" },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: "ashe-focused.banished-card",
            // 108.6 / 428.1：放逐区的牌；
            // “banished this way” 的关联窗口见 judgeReason 第 2 点。
            filter: { zone: "banishment" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-7f00252b4eaff7bcfcf3dff60f4ba8007ee573667f1912bed0ba0a6301e33a27",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1)「choose an opponent」是玩家目标（355.7/355.9.a）：契约 3.6 的 TargetSpec 与 " +
    "ResolveContext.targets() 只承载 ObjectRef[]，ChoiceRequest 也只有 optional/mode/select-objects/order/number " +
    "五种形状，没有玩家目标请求，故无法把选择结果绑定到 effect.reveal.player、弃放逐的候选范围与后续 hold 条件。" +
    "(2)「When they hold, return it」需要 383.4.d/391.5 的 Delayed Linked Ability：registerDelayedTrigger 的引擎入口已合入 " +
    "（events/pipeline.ts 对 delayed 注册跳过 activeZones 过滤，来源离场仍触发，已由 golden 实证），" +
    "但卡牌指令侧没有延迟触发声明原语，IR 也不能跨能力读取本卡 effect.banish 的 linkKey 回执来把返回限定为“本次放逐的那一张”；" +
    "普通在场 hold 订阅无法满足来源离场仍生效与只响应所选对手。玩家目标契约与延迟声明/关联窗口需上游扩展；" +
    "不将任意 banishment 目标近似成该牌。",
  abilities,
  sourceText:
    "When you play me, choose an opponent. They reveal their hand. Choose a card revealed this way and banish it. " +
    "When they hold, return it to their hand (even if I'm no longer on the board)."
} satisfies CardProgram;

export default program;
