import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ashe, Focused — CR v1.5 383.4.a (Play Effect), 425.3 (reveal),
 * 428.1 (banish), 383.4.d/391.5 (delayed linked hold return).
 * 玩家目标与跨结算的放逐牌关联仍缺；普通在场触发不能替代延迟能力。
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
              // 展示的那些引用”，故这里记录形状（见 judgeReason 第 2 点）。
              filter: { zone: "hand", owner: "opponent" },
              chooser: "self",
              visibility: "public"
            }
          },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "asheBanished" }
        },
        linkedTo: REVEAL_HAND
      }
    ]
  },
  {
    // 383.4.d / 391.5：
    // “When they hold, return it to their hand”是绑定同一张牌的 Delayed Linked
    // Ability；固守者范围条件与延迟窗口都未合入（见 judgeReason 第 1、2 点），
    // 因此第二条触发只保留可审查形状，不写成无条件近似。
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
    "当前缺口（CR v1.5）：(1)「choose an opponent」是玩家目标（355.7/355.9.a），TargetSpec/ResolveContext.targets 仍只绑定 ObjectRef；缺玩家选择结果到 effect.reveal.player、弃放逐选择范围及后续 hold 条件的绑定。(2)「When they hold, return it」需要 391.5/391.5.a 的 Delayed Linked Ability：registerDelayedTrigger 已有引擎入口，但卡牌指令缺延迟触发声明及跨结算保存本次 banishedObjects 的关联窗口；普通在场 hold 订阅无法满足来源离场仍生效与只响应所选对手。玩家目标、延迟声明与关联窗口需上游扩展；不将任意 banishment 目标近似成该牌。",
  abilities,
  sourceText:
    "When you play me, choose an opponent. They reveal their hand. Choose a card revealed this way and banish it. " +
    "When they hold, return it to their hand (even if I'm no longer on the board)."
} satisfies CardProgram;

export default program;
