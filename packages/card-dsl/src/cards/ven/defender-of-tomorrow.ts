import type { CardProgram } from "../../ir/index.js";

/**
 * Defender of Tomorrow (ven-149-166) — Legend, Mind/Body, Jayce.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-149-166，逐字）：
 *   [Empower] :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: (… Empower me.
 *   Use only if not Empowered.)
 *   :rb_energy_1:, :rb_exhaust:: Ready a gear.
 *   [Empowered][>] :rb_energy_1:, :rb_exhaust:: Ready 2 gear.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1/827.1.a：Empower 是启动能力关键词，通常印在永久物与传奇上；
 *   827.1.c.1 功能等价于 “[费用]：Empower 此对象。仅当未 Empowered 时启动。”
 *   827.1.b.1 明确 Empower 的来源本身不是目标。
 * - 828.1.a/828.1.b.1：[Empowered][>] 是依赖型关键词，从关键词到子句末尾整体是
 *   Empowered 能力，功能等价于 “当我拥有 Empowered 状态时，此牌获得 [Text]”。
 *
 * 复核（2026-10-17，第一轮 M2 覆盖率复核）：
 * - 旧第 2 条（[A] 不可表达）已不成立：合并费用管线的 payment 形状用
 *   `{ kind: "power", amount, allowedDomains }` 表达任意域 Power 需求（cost/plan-values.ts
 *   的 domains()；覆盖六域 = 135.2.e.5.a 的 [A]，与 dragon-roost / power-nexus 同形状）。
 *   Empower 的印刷费用因此能写成本卡注释里的「2 Energy + 两条 1 点任意域 Power」，
 *   golden 用真实 cost plan + payment 断言任意域 Power 付得起、单域/能量不足时拒绝。
 *   注意：契约 3.8.3 的 `params.cost` 只加在 KeywordDef.expand 的输入上，card-dsl 的
 *   KeywordAbility 仍然没有 params 字段——本卡没有把费用塞进 keyword 声明，费用语义
 *   仍由缺失的 Empower KeywordDef 承担（契约变更请求见下）。
 * - 「Ready a gear」/「Ready 2 gear」两条启动能力的费用与 effect.ready 本体已按契约写出，
 *   golden 用解释器执行真实 body。
 *
 * status = judge-required（缺口）：
 * 1. 没有 Empower / Empowered KeywordDef（keywords/registry.generated.ts 的 RIFT-81~88
 *    与 264~268 两批都不含它们）：827.1.c.1 的起动费用与「仅当未 Empowered」限制、
 *    828.1.b.1 的依赖能力都无法展开；
 * 2. 没有 442.1.a 的 Empowered 二元状态谓词：ObjectSnapshot / Condition 都没有该状态，
 *    layers/engine.ts 的 conditionMatches 对未知 condition kind 落回 true，`restriction:
 *    { kind: "dependent-keyword" }` 也没有消费方（programs/play.ts 的
 *    translateLegalityCondition 只接受 condition 或 CONDITION_KINDS），所以「Ready 2 gear」
 *    不能按依赖能力绑定。
 * 依赖新的 Empower/Empowered 关键词任务与 442.1.a 的状态谓词。不近似实现。
 */
export default {
  canonicalCardId: "card.hash-a83f38e4a2af89564ecd6ceb9b9d1eb607e58af4d10927e697cd6eb4c95fe037",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef" +
    "（已合入批次不含它们），827.1.c.1 的「2 能量 + 2 [A]：Empower me，仅当未 Empowered 时启动」" +
    "与 828.1.b.1 的「拥有 Empowered 时获得 [Ready 2 gear]」都无展开路径；" +
    "(2) 442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 中——" +
    "layers/engine.ts 的 conditionMatches 对未知 condition kind 落回 true，且程序里的 " +
    "restriction: { kind: \"dependent-keyword\" } 没有消费方（programs/play.ts 的 " +
    "translateLegalityCondition 只接受 condition 或 CONDITION_KINDS），所以「Ready 2 gear」" +
    "不能按依赖能力绑定。" +
    "费用本身已可执行：两个 :rb_rune_rainbow: 用两条 amount 1、allowedDomains 覆盖六域的 Power" +
    "需求表达（135.2.e.5.a；golden 用真实 cost plan + payment 断言任意域 Power 可付、" +
    "单域或能量不足时拒绝）。依赖新的 Empower/Empowered 关键词任务与 442.1.a 的状态谓词。不近似实现。",
  abilities: [
    {
      kind: "keyword",
      keyword: "empower"
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "defender-of-tomorrow.ready-gear",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "defender-of-tomorrow.gear" }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "defender-of-tomorrow.gear",
              filter: { type: "gear", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      // 828.1.b.1：依赖能力仅在宿主拥有 Empowered 状态时生效。该 restriction
      // 目前没有消费方（见 judgeReason），仅记录原文的依赖关系。
      restriction: { kind: "dependent-keyword", keyword: "empowered" },
      body: [
        {
          id: "defender-of-tomorrow.ready-2-gear",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "defender-of-tomorrow.gears" }
            },
            amount: { kind: "constant", value: 2 }
          },
          targets: [
            {
              id: "defender-of-tomorrow.gears",
              filter: { type: "gear", zone: "board" },
              min: 2,
              max: 2,
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Empower] :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: " +
    "(:rb_energy_2::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
    ":rb_energy_1:, :rb_exhaust:: Ready a gear.\n" +
    "[Empowered][>] :rb_energy_1:, :rb_exhaust:: Ready 2 gear."
} satisfies CardProgram;
