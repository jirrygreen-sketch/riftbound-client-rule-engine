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
 * status = judge-required（缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 目前没有任何 Empower/Empowered KeywordDef，
 *    827.1.c.1 的启动费用 + “仅当未 Empowered”限制、以及 828.1.b.1 的依赖能力
 *    都无法展开；已合入的关键词批次（RIFT-81~88：Assault/Shield、Deathknell/
 *    Legion、Ganking/Vision、Deflect/Hidden、Action/Reaction、Repeat/Accelerate、
 *    Equip/Quick-Draw/Weaponmaster、Mighty）都不含 Empower/Empowered，需要新的
 *    关键词任务；
 * 2. Empower 费用里的 :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5.a、
 *    163.2.b）；内核 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，
 *    effect.resources 已记录 [A] 不可表达、绝不用某个域近似；且契约 3.8.3 的
 *    `params.cost` 只加在 KeywordDef.expand 的输入上，card-dsl 的 KeywordAbility
 *    没有 params 字段（见回复的契约变更请求），印刷费用只能写在本注释与
 *    judgeReason 里，不伪造第二条启动能力；
 * 3. “Ready 2 gear.” 的 Empowered 门槛需要 Empowered 状态谓词与依赖能力图层
 *    （RIFT-91 的 layers 引擎已合入，但卡牌侧入口缺失）。
 * 依赖：新的 Empower/Empowered 关键词任务（RIFT-81~88 批次未含）、
 * RIFT-89（费用/支付接线）、RIFT-91（图层/依赖能力）。
 *
 * 两条 “Ready … gear” 启动能力的费用与 effect.ready 本体已按契约写出；golden
 * 用解释器执行真实 body，Empowered 门槛与关键词展开保持 TODO。
 */
export default {
  canonicalCardId: "card.hash-a83f38e4a2af89564ecd6ceb9b9d1eb607e58af4d10927e697cd6eb4c95fe037",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Empower/Empowered KeywordDef：keywords/registry.generated.ts 没有 " +
    "\"empower\"/\"empowered\" 的展开（RIFT-81~88 关键词批次不含它们），" +
    "827.1.c.1 的「2 能量 + 2 [A]：Empower me，仅当未 Empowered 时启动」与 " +
    "828.1.b.1 的「拥有 Empowered 时获得 [Ready 2 gear]」都无执行路径；" +
    "费用中的 :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5.a、163.2.b），" +
    "六域封闭 Domain 集合无法表达（effect.resources 记录不可近似）；Empowered " +
    "状态谓词与依赖能力图层入口亦未接通。依赖新增 Empower/Empowered 关键词任务、" +
    "RIFT-89（费用/支付）、RIFT-91（图层/依赖能力）。不近似实现。",
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
