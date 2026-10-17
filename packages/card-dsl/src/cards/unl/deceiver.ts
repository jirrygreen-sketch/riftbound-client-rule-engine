import type { CardProgram } from "../../ir/index.js";

/**
 * Deceiver (unl-199-219) — Legend, Mind/Order, tag LeBlanc.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-199-219，逐字）：
 *   When you conquer or hold, you may discard 1 and exhaust me to play a ready
 *   Reflection unit token there. It becomes a copy of another unit there. Give
 *   it [Temporary].
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c.2.b / 383.4.d.2.b：「When you conquer or hold」是两个引用玩家的命名触发
 *   （Conquer Effect / Hold Effect），分别订阅封闭表的 conquer（refs 468.5.d / 471.1 /
 *   473.2.a）与 hold（refs 315.2.b.2 / 471.2 / 473.2.b）；两句写成两条 triggered 能力，
 *   不合并成自定义时点。383.4.c.2.c / 383.4.d.2.c：点数被否定或替代时照样触发。
 * - 383.3.a / 403.1：「you may」位于效果最开头，是触发能力自身的 Finalize 决定
 *   （拒绝则从链上移除），由 TriggeredAbility.optional 承载；契约 3.9 要求把被选指令
 *   包进 choice.optional 的 body，不使用 choice + linkedTo。
 * - 383.3.b / 204.3 / 355.10.c.1：「discard 1 and exhaust me」紧跟在效果开头的
 *   「you may」之后，是触发能力的基础费用（cost within instructions），按 415.4 /
 *   415.5 必须能完成才能把触发放进链；423.1.a / 355.10.a 规定弃 1 由弃牌者在手牌
 *   私下选择，是费用而非目标；355.10.c.1 明确费用部分不产生目标。
 * - 187.6：Reflection 是「0 [M] 无域单位 token」；185.2 / 440.2.c：「play … token」
 *   先在链上创建再交给打出流程；143.4 / 184.1：「ready」是入场状态改写，不是事后重置。
 * - 446.1-446.2 / 479.1.a-d：「It becomes a copy of another unit there」是复制游戏
 *   动作作用在已存在对象上；355.9 / 355.10：「another unit there」是文本指名的对象，
 *   属选目标，「there」指触发事件里的那个战场（359.3.f.1）。
 * - 816.1 / 816.1.a / 816.1.b：Temporary 是触发式关键词，功能等价于「在该永久物
 *   控制者的 Beginning Phase 开始时、计分前消灭它」，多个实例冗余。
 *
 * status = judge-required（四处缺口，均不近似实现）：
 * - `cost.pay` 与费用计划原语已经合入，但契约 3.1 的 TriggeredAbility 没有基础费用槽位，
 *   也没有把触发能力里的 discard 选择和 self exhaustion 接进生产 Finalize；保留
 *   cost.pay 形状不会把费用误写成两个效果。
 * - Reflection token 的 mode "play" 创建与交接已经合入，但「ready」入场改写
 *   （143.4 / 184.1）仍没有 entry override，且 conquer/hold 事件没有提供“there”的动态
 *   战场位置供 token destination 使用。
 * - 「It becomes a copy of another unit there」仍受 effect.copy 的 mode "effect" 阻断
 *   （copy-layer-traits-exceptions-and-attachment-duration-unavailable）；复制图层的
 *   已存在对象生命周期与嵌套目标选择尚未接线。
 * - Temporary KeywordDef 与 continuous.grant-keyword 原语已经合入，但关键词展开仍需要
 *   Beginning Phase 触发注册和层效果的生产生命周期，不能把 Temporary 改写成一次性 kill。
 * 本卡保留可审查的结构与已合入原语，整卡仍不能标记 executable。
 *
 * 依赖：触发能力基础费用的 Finalize 接线、token ready 入场覆盖与动态 battlefield 引用、
 * copy-layer 的 effect mode/嵌套目标生命周期、Temporary 的生产触发注册。
 */
const deceiver = {
  canonicalCardId:
    "card.hash-6ea8e63a198fef36cfbb65b0e39e0cf0f4206a9abd810a75bf107bcaad25da29",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处当前缺口，均不近似实现：(1) CR 383.3.b 的 cost.pay 与费用计划原语已经合入，但契约 3.1 的 TriggeredAbility 没有基础费用槽位，" +
    "生产 Finalize 尚未消费触发能力里的 discard 选择与 self exhaustion；(2) Reflection token 的 mode \"play\" 创建与交接已经合入，" +
    "但 ready 入场覆盖（143.4/184.1）和 conquer/hold 事件到 \"there\" battlefield 的动态引用仍缺失；(3) effect.copy 的 mode \"effect\" 仍被" +
    "copy-layer-traits-exceptions-and-attachment-duration-unavailable 阻断，嵌套目标与已存在对象复制生命周期未接线；" +
    "(4) Temporary KeywordDef 与 continuous.grant-keyword 已合入，但 Beginning Phase 触发注册和生产层生命周期仍缺失。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 383.4.c.2.b：「引用执行征服的玩家」的 Conquer Effect。
        filter: { event: "conquer", player: "self" }
      },
      // 383.3.a / 403.1：效果开头的「you may」是触发自身的 Finalize 决定。
      optional: true,
      body: [
        {
          id: "deceiver.conquer-may",
          // 契约 3.9：「可以……」把被选指令包进 choice.optional 的 body。
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Discard 1 and exhaust me to play a ready Reflection unit token there?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  // 383.3.b / 204.3 的基础费用形状（Finalize 支付，见 judgeReason）：
                  // 423.1.a 的弃 1 是弃牌者的私密费用选择，415.5 的「exhaust me」
                  // 是费用式横置，两者都不产生目标（355.10.c.1）。
                  id: "deceiver.conquer-pay",
                  op: "cost.pay",
                  args: {
                    payments: {
                      kind: "constant",
                      value: [
                        { kind: "discard", amount: 1 },
                        { kind: "exhaust", object: "self" }
                      ]
                    }
                  }
                },
                {
                  // 440.2.c / 185.2.a：被「打出」的 token 先在链上生成；「ready」是
                  // 入场状态改写（143.4 / 184.1），create-token 不支持。
                  id: "deceiver.conquer-play-token",
                  op: "effect.token",
                  linkedTo: "deceiver.conquer-pay",
                  args: {
                    token: { kind: "constant", value: "reflection" },
                    amount: { kind: "constant", value: 1 },
                    mode: { kind: "constant", value: "play" },
                    // 「there」= 触发事件里的那个战场（359.3.f.1）；conquer 载荷未暴露
                    // 战场身份，占位常量只是可审查的形状（见 judgeReason）。
                    location: {
                      kind: "constant",
                      value: { type: "battlefield", id: "that-battlefield" }
                    },
                    linkKey: { kind: "constant", value: "reflectionToken" }
                  }
                },
                {
                  // 446.1-446.2：让已存在的 token 成为另一个单位的复制；effect.copy
                  // 的 mode "effect" 被显式 blocked，不改成创建新对象。
                  id: "deceiver.conquer-copy",
                  op: "effect.copy",
                  linkedTo: "deceiver.conquer-play-token",
                  args: {
                    source: {
                      kind: "constant",
                      value: { target: "deceiver.conquer-other-unit" }
                    },
                    mode: { kind: "constant", value: "effect" },
                    onto: {
                      kind: "constant",
                      value: { linked: "deceiver.conquer-play-token" }
                    },
                    duration: { kind: "constant", value: "permanent" }
                  },
                  targets: [
                    {
                      // 355.9 / 355.10：「another unit there」是文本指名的对象，属选
                      // 目标；「there」是战场位置限制（触发载荷未给具体战场）。
                      id: "deceiver.conquer-other-unit",
                      filter: { type: "unit", zone: "board", location: "battlefield" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  // 816.1：把 [Temporary] 授予刚创建的 token；展开属关键词注册表。
                  id: "deceiver.conquer-grant-temporary",
                  op: "continuous.grant-keyword",
                  linkedTo: "deceiver.conquer-play-token",
                  args: {
                    keyword: { kind: "constant", value: "Temporary" },
                    duration: { kind: "constant", value: "permanent" }
                  },
                  targets: [
                    {
                      id: "deceiver.conquer-created-unit",
                      filter: {
                        type: "unit",
                        object: { linked: "deceiver.conquer-play-token" }
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 383.4.d.2.b：「引用执行固守的玩家」的 Hold Effect。
        filter: { event: "hold", player: "self" }
      },
      optional: true,
      body: [
        {
          id: "deceiver.hold-may",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Discard 1 and exhaust me to play a ready Reflection unit token there?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "deceiver.hold-pay",
                  op: "cost.pay",
                  args: {
                    payments: {
                      kind: "constant",
                      value: [
                        { kind: "discard", amount: 1 },
                        { kind: "exhaust", object: "self" }
                      ]
                    }
                  }
                },
                {
                  id: "deceiver.hold-play-token",
                  op: "effect.token",
                  linkedTo: "deceiver.hold-pay",
                  args: {
                    token: { kind: "constant", value: "reflection" },
                    amount: { kind: "constant", value: 1 },
                    mode: { kind: "constant", value: "play" },
                    location: {
                      kind: "constant",
                      value: { type: "battlefield", id: "that-battlefield" }
                    },
                    linkKey: { kind: "constant", value: "reflectionToken" }
                  }
                },
                {
                  id: "deceiver.hold-copy",
                  op: "effect.copy",
                  linkedTo: "deceiver.hold-play-token",
                  args: {
                    source: {
                      kind: "constant",
                      value: { target: "deceiver.hold-other-unit" }
                    },
                    mode: { kind: "constant", value: "effect" },
                    onto: {
                      kind: "constant",
                      value: { linked: "deceiver.hold-play-token" }
                    },
                    duration: { kind: "constant", value: "permanent" }
                  },
                  targets: [
                    {
                      id: "deceiver.hold-other-unit",
                      filter: { type: "unit", zone: "board", location: "battlefield" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "deceiver.hold-grant-temporary",
                  op: "continuous.grant-keyword",
                  linkedTo: "deceiver.hold-play-token",
                  args: {
                    keyword: { kind: "constant", value: "Temporary" },
                    duration: { kind: "constant", value: "permanent" }
                  },
                  targets: [
                    {
                      id: "deceiver.hold-created-unit",
                      filter: {
                        type: "unit",
                        object: { linked: "deceiver.hold-play-token" }
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you conquer or hold, you may discard 1 and exhaust me to play a ready Reflection unit token there. " +
    "It becomes a copy of another unit there. Give it [Temporary]."
} satisfies CardProgram;

export default deceiver;
