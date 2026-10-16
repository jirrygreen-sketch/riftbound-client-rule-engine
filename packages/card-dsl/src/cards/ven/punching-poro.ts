import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Punching Poro (ven-007-166) — Unit, Fury, tags Poro / Ionia.
 * energy 2, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-007-166，逐字）：
 *   [Empower] — Discard 1 (Pay the cost: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have +1 :rb_might:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c：Empower 是启动能力关键词，格式为 “Empower [Cost]”；827.1.c.2
 *   明确 Empower 费用可以包含非资源费用，本卡的印刷费用是「弃 1 张牌」。
 *   827.1.c.1 的功能等价文本是 “[Cost]: Empower this。仅当未 Empowered 时启动”，
 *   827.1.b.1 规定来源本身不是目标。
 * - 423.1 / 423.1.a：Discard 是把牌从手牌放入其拥有者弃牌区的动作；作为费用时由费用
 *   管线在 Finalize 收取（356.2），费用里的对象不是目标（355.10.c）。
 * - 828.1 / 828.1.b / 828.1.b.1 / 828.1.c：“[Empowered][>]” 之后的整句是 Dependent
 *   Ability，持有 Empowered 状态时 Active，等价于 “While I have the Empowered
 *   status, this card gains '[Text]'”。
 * - "I have +1 :rb_might:." 是静态 Might 修正，属 arithmetic 图层（143.2.a、475–477），
 *   不是 Buff 计数器（702/703）。
 *
 * status = judge-required（三处依赖均不近似实现）：
 * 1. effects/keywords/ 没有 Empower/Empowered KeywordDef（RIFT-81~88 批次不含它们），
 *   827.1.c.1 的起动费用（含 “Discard 1”）与 827.1.c.5 的 “Use only if not Empowered”
 *   限制没有展开路径；卡程序只能按契约 3.1 声明 keyword 能力。
 * 2. cost/ 侧的 discard 费用组件存在（cost/plan-values.ts 支持 kind "discard"），但没有
 *    任何模块把卡程序声明的 Empower 费用接进 Finalize（RIFT-89 费用计划接线）。
 * 3. 828.1.c 的状态门控需要 empowered 谓词（condition.predicate）；当前 Condition 没有该
 *    谓词，layers 也没有把卡程序 static 效果注册进图层的入口（RIFT-91），因此这条 +1 Might
 *    既拿不到门控也进不了图层。
 * 依赖：新增 Empower/Empowered KeywordDef、RIFT-89（费用计划接线）、RIFT-91（图层与谓词）。
 * 本程序不把依赖能力写成无条件能力，也不手写 Empowered 判定。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower"
  },
  {
    // 828.1.b.1：持有 Empowered 时宿主获得 +1 Might，属算术图层的静态修正。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    // 828.1.c 的门控用显式谓词占位；本程序不手写状态判定。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-4e84bd06baa7f0981211f77e8859b781d223544ea2429070561399db373e5c6f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) 缺 Empower/Empowered 的 KeywordDef（RIFT-81~88 关键词批次不含它们），" +
    "827.1.c.1 的「Discard 1：Empower me」起动费用（827.1.c.2 允许非资源费用）与 827.1.c.5 的" +
    "「仅当未 Empowered 时启动」限制都没有展开路径，卡程序按契约 3.1 只能声明 keyword 能力；" +
    "(2) 费用侧虽有 discard 组件（cost/plan-values.ts 的 kind \"discard\"），但没有模块把卡程序声明的 Empower 费用" +
    "接进 Finalize（RIFT-89 费用计划接线）；(3) 828.1.c 的 Dependent Ability 门控需要 empowered 谓词" +
    "（condition.predicate）与图层注册入口，当前 Condition 没有该谓词、layers 也没有卡程序 static 效果入口（RIFT-91），" +
    "因此 +1 :rb_might: 既拿不到门控也进不了图层。依赖：新增 Empower/Empowered KeywordDef、RIFT-89、RIFT-91。" +
    "不把依赖能力写成无条件能力，也不手写 Empowered 判定。不近似实现。",
  abilities,
  sourceText:
    "[Empower] — Discard 1 (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
