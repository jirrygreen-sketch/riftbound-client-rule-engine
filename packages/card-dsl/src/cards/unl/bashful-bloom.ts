import type { CardProgram } from "../../ir/index.js";

/**
 * Bashful Bloom (unl-189-219) — Legend, Calm/Mind, tag Lillia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-189-219，逐字）：
 *   :rb_energy_4:, :rb_exhaust:: Play a ready 3 :rb_might: Sprite unit token
 *   with [Temporary]. This ability costs :rb_energy_1: less for each friendly
 *   unit with [Temporary].
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.5：“:” 之前是费用——4 Energy 加上横置来源；合并费用管线
 *   （cost/plan-values.ts、cost/payment.ts）支持 energy 与
 *   { kind: "exhaust", object: "self" }。
 * - 174.8 / 376：Legends 可以有启动能力；本卡没有 [Reaction]，默认 Action 时机。
 * - 187.2：3 [M] Sprite token 是“无域、3 Might、Fae 标签、带 [Temporary]”的单位
 *   token；876/816 的 Temporary 是触发式关键词（在自己的 Beginning Phase 计分前
 *   消灭该永久）。因此该 token 需要 definition + keyword，冻结的 effect.token
 *   定义表（recruit / sand-soldier / mech / reflection / tentacle）没有 sprite。
 * - 184.1：入场状态“ready”是相对默认（单位横置入场，143.4）的改写，需要
 *   create-token 支持入场状态，先创建再 ready 会产生错误的“成为就绪”事件。
 * - “This ability costs 1 less for each friendly unit with [Temporary]” 是启动费用的
 *   静态改写：需要 cost.modify，且“带 [Temporary] 的友方单位”计数依赖关键词特征
 *   过滤（817/713 式的特征读取）与关键词展开。
 *
 * status = judge-required（缺口不近似实现）：缺 sprite token 定义、Temporary 关键词
 * 展开、入场就绪改写与 cost.modify 的按计数减费；一次创建再横置/就绪都不可代替。
 *
 * 依赖：RIFT-89/90（cost.modify 与费用计划的减费阶段）、effect.token 的定义表扩展
 * （按 187.2 的官方 token）与 RIFT-83/84 系列的关键词展开。
 */
export default {
  canonicalCardId:
    "card.hash-7c38c7fbf3d002c5be05a68b52e8d74195df7d791f974e04b64a12b0a010fb46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 sprite token 与费用改写：187.2 的 3 [M] Sprite token 是“无域 + Fae 标签 + [Temporary]”的单位 token，" +
    "effect.token 的冻结定义表（recruit/sand-soldier/mech/reflection/tentacle）没有 sprite；[Temporary] 的关键词展开（816）也未合入。" +
    "“ready” 是入场状态改写（143.4 / 184.1），create-token 不支持，先创建再补一次 ready 会产生错误的“成为就绪”事件。" +
    "“This ability costs :rb_energy_1: less for each friendly unit with [Temporary]” 需要 cost.modify 的按计数减费阶段，" +
    "并依赖对 [Temporary] 关键词特征的过滤计数，合并 IR 的 count/ObjectFilter 都没有该维度。" +
    "依赖 RIFT-89/90（cost.modify 与费用计划）与 effect.token 的定义表扩展；不近似实现。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 4 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "bashful-bloom.play-sprite",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 1 },
            // 187.2 / 440.2.c：“Play … token” 需要链上创建再打出；合并内核的
            // create-token 只支持直接创建到棋盘。
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "spriteToken" }
            // 184.1 的入场状态改写（“ready”）：create-token 尚不支持
            // （见 judgeReason）。不新增 IR 参数键，也不会先创建再补一次
            // “成为就绪”的效应。
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_4:, :rb_exhaust:: Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
    "This ability costs :rb_energy_1: less for each friendly unit with [Temporary]."
} satisfies CardProgram;
