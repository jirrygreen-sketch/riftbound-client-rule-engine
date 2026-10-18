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
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
 */
const deceiver = {
  canonicalCardId:
    "card.hash-6ea8e63a198fef36cfbb65b0e39e0cf0f4206a9abd810a75bf107bcaad25da29",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) CR 383.3.b/383.3.b.1 要求在 Finalize 支付弃 1 与横置自身；TriggeredAbility 无基础费用槽位，programs/triggers.ts 未提取嵌套费用；当前 cost.pay 的 payments 数组也不是该原语接受的资源对象或 finalized CostPlan。" +
    "(2) effect.token 的 play 已存在，但无 ready 的 entry override（143.4/184.1）；conquered/held 对应的 conquer/hold 事件虽有 details.battlefieldId，IR 未暴露供 there 目的地及同地点目标限制使用的事件位置选择器。" +
    "(3) effect.copy 的 effect mode 仍返回 copy-layer-traits-exceptions-and-attachment-duration-unavailable（446.1/446.2/479.1），缺已存在 token 的复制特征与生命周期。" +
    "(4) programs/filters.ts 拒绝当前授予目标的 object:{linked:...} 过滤器，嵌套目标不能在 token 创建后绑定；" +
    "(5) Temporary 定义、一般触发注册与 continuous.grant-keyword 均已存在，但 programs/lifecycle.ts 未刷新新授予关键词的 beginning-start 订阅；KeywordGrantLayerEngine 对动态 triggered 展开仍 fail-closed（816.1.b/816.1.c）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 383.4.c.2.b：「引用执行征服的玩家」的 Conquer Effect。事件词汇写作
        // "conquered"：TriggerSpec 的 EVENT_PATTERN_TYPES 与 events/pipeline-match.ts
        // 的 EVENT_NAMES 把时点 conquer 映射到 "conquered"；写 "conquer" 会在
        // registerTrigger 的 assertTriggerSpec 处被拒（同 sfd/chem-baroness 的 "held"）。
        filter: { event: "conquered", player: "self" }
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
        // 383.4.d.2.b：「引用执行固守的玩家」的 Hold Effect。事件词汇写作 "held"
        // （见上；events/pipeline-match.ts 的 EVENT_NAMES: held → hold）。
        filter: { event: "held", player: "self" }
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
