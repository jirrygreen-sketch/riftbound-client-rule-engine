import type { CardProgram } from "../../ir/index.js";

/**
 * Zed, From the Shadows (ven-023-166) — Unit, 4 Energy + 1 Fury Power, 4 Might,
 * Fury, Ionia/Zed/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-023-166，逐字）：
 *   You may discard 1 as an additional cost to play me.
 *   When you play me, if you paid the additional cost, play a 0 :rb_might: Shadow
 *   Clone unit token. (It has "When I attack, you may banish a unit from your trash.
 *   If you do, give me [Assault 4] this turn.")
 *
 * 规则依据（CR v1.5）：
 * - 356.2 / 356.2.a / 356.2.b.1：由打出之牌自身的被动能力指定的可选附加费用，在 Total Cost
 *   第 2 步收取；“You may discard 1” 没有字面 “may” 以外的条件，属 Optional Additional Cost。
 * - 423.1 / 423.1.a / 355.10.c：Discard 是把手牌直接放入其 Trash；作为费用的一部份，弃哪张牌由
 *   执行动作的玩家在结算期选择，该对象不是目标——因此写成费用组件里的非目标 pick，不写 TargetSpec。
 * - 356.4.f.1：“if you paid the additional cost” 以“玩家决定支付”为凭证，需要费用结果绑定。
 * - 383.4.a："When you play me" 是 Play Effect，时点为封闭的 "card-played"，filter 指向自身。
 * - 187.11 / 186 / 350.2 / 440.2.c / 185.2.a：0 Might 的 Shadow Clone 是**带自身能力的单位 token**，
 *   被“play”时先在链上生成再由 play 动作接手；440.2.b.1 规定未指定区域时创建到“可被打出的任意地点”。
 * - 807.1.c / 807.1.b.3：token 自带能力里的 [Assault 4] 是 token 特征，不是本卡的能力。
 *
 * status = judge-required（四处缺口均不近似实现）：
 * 1. 可选附加费用仍没有从 CardProgram 的 `cost.additional` 声明接入打出 Finalize；
 *    `programs/play.ts` 的 `translateCost` 会拒绝追加费用字段，且费用计划的非目标
 *    弃牌选择要求调用方提供具体 ObjectRef，当前没有把“控制者手牌”过滤器转成候选的适配器。
 * 2. “if you paid the additional cost” 没有可读取的费用回执绑定（冻结 IR 没有
 *    `condition.result`），不能用恒真条件近似；
 * 3. Shadow Clone 的定义不在 effect.token 的冻结 DEFINITIONS 表（表内只有 recruit/
 *    sand-soldier/mech/reflection/tentacle；187.11 带自身能力的 token 被该文件显式阻断为
 *    token-definition-or-abilities-judge-required），token 自身的 [Assault 4] 能力也无法由本卡数据表达；
 * 4. token 的打出地点是 Finalize 的 Location 选择（355.2/355.2.a、440.2.b.1），
 *    已合入原语只接受具体 LocationRef 列表，没有任何读数把“可被打出的地点集合”解析出来
 *    （费用/打出位置的动态候选生产器仍缺失）。
 * 本文件仍按契约 3.1/3.2 写出完整的触发与费用形状（含非目标 pick 的弃牌组件）；golden
 * 对已合入的费用修改原语保留真实执行证据，剩余待办继续覆盖未接线的打出与 token 场景。
 * 不伪造回执、不发明 token 特征、不写死地点。
 */
export default {
  canonicalCardId: "card.hash-d7b6ea328eac7b13a0a652c5d95b38895d7026cbb51f23007ecdce1f9a3d951c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) CardProgram 的 cost.additional 尚未接入打出 Finalize；programs/play.ts 的 " +
    "translateCost 会拒绝追加费用字段，且费用计划的非目标弃牌选择要求具体 ObjectRef，" +
    "当前没有把控制者手牌过滤器转换为候选的适配器；(2) “if you paid the additional cost”（356.4.f.1）" +
    "没有可读取的费用回执绑定（冻结 IR 没有 condition.result），不能用恒真条件近似；(3) Shadow Clone 不在 effect.token 的冻结 DEFINITIONS 表，" +
    "187.11 带自身能力的 token 被该文件显式阻断（token-definition-or-abilities-judge-required），" +
    "token 自带能力里的 [Assault 4] 也无法由本卡数据表达；(4) token 的打出地点是 Finalize 的 Location 选择" +
    "（355.2/355.2.a、440.2.b.1），已合入原语只接受具体 LocationRef 列表，没有读数能解析“可被打出的地点集合”" +
    "（动态合法地点候选生产器仍缺失）。费用对象按 355.10.c 记为非目标 pick，不写成 TargetSpec；" +
    "不伪造回执、不发明 token 特征、不写死地点。",
  abilities: [
    {
      // 356.2.b / 356.2.b.1：可选的附加费用（由打出之牌自身的被动能力指定）。
      kind: "static",
      effect: {
        kind: "cost.additional",
        id: "zed.additional-cost",
        appliesTo: "self",
        optional: true,
        stage: "optional-additional",
        payments: [
          {
            kind: "discard",
            amount: { kind: "constant", value: 1 },
            // 355.10.c / 423.1.a：作为费用的一部，弃哪张牌由执行动作的玩家在结算期选择，
            // 不是目标；候选由费用管线在运行时从控制者手牌给出。
            choice: {
              id: "zed.discarded-card",
              options: ["dynamic:card-in-controller-hand"],
              min: 1,
              max: 1,
              selection: "one",
              filter: { type: "card", zone: "hand", owner: "controller" }
            }
          }
        ]
      }
    },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } },
        // “if you paid the additional cost”：356.4.f.1 的费用回执门槛。该条件没有可求值的
        // 绑定（见 judgeReason 第 1 条），以描述性条件记录，不伪造一个恒真条件。
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "paid-additional-cost" }
        }
      },
      optional: false,
      body: [
        {
          id: "zed.play-shadow-clone",
          op: "effect.token",
          args: {
            // 187.11：0 Might 的 Shadow Clone 单位 token。定义表内没有该 id，
            // 原语会以 blockedReason token-definition-or-abilities-judge-required 阻断（见 judgeReason）。
            token: { kind: "constant", value: "shadow-clone" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c / 185.2.a / 350.2 / 354：被“打出”的新 token 先在链上创建再由 play 接手。
            mode: { kind: "constant", value: "play" },
            // 355.2/355.2.a + 440.2.b.1：卡面未指定地点，合法打出去处由 Finalize 选择；
            // 这里不写死任何 LocationRef（见 judgeReason 第 4 条）。
            linkKey: { kind: "constant", value: "shadowClone" }
          }
        }
      ]
    }
  ],
  sourceText:
    "You may discard 1 as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, play a 0 :rb_might: Shadow Clone unit token. " +
    "(It has \"When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.\")"
} satisfies CardProgram;
