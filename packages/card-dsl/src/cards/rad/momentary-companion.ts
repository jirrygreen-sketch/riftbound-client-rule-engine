import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Momentary Companion (rad-095-167) — Unit, 4 energy, Might 4, Chaos。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   When you play me, if it's not your turn, give me [Temporary]. (Kill me at
 *   the start of my controller's Beginning Phase, before scoring.)
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）以 keyword 能力声明；811.1.c 的 Hide 权限、422 的面朝下放置与
 *   从面朝下状态打出的费用改写属 cost/zone 管线（本卡不手写）。
 * - "When you play me"：card-played（383.4.a），filter 指向自身。
 * - "if it's not your turn"：触发条件比较当前回合玩家与能力控制者（"your" = 190.6.d
 *   的控制器）。Condition 没有该谓词，卡内不凭空读取回合状态，不近似实现。
 * - "give me [Temporary]"：816 的触发式关键词授予。816.1.b 规定 [Temporary] 的功能等价于
 *   "At the start of this permanent's controller's Beginning Phase, before scoring, kill this."；
 *   授予用已合入的 continuous.grant-keyword（ability 图层），Temporary 的 KeywordDef
 *   已合入（816.2 的 single stacking + beginning-start 时点的 effect.kill self）。
 *
 * status = judge-required（README 第 2 节）。2026-10-17 复核：
 * 已解决（不再列为缺口）：continuous.grant-keyword（RIFT-258）与 Temporary KeywordDef
 * （RIFT-264～268）均已合入，本条授予有真实执行证据（golden 断言 ability 图层注册与
 * 关键词展开）。
 * 当前缺口，均不近似实现：
 * 1. 触发条件 "if it's not your turn" 无法求值：Condition/Expr 只读 self/source 等静态
 *    选择器与常量，没有「当前回合玩家是否为该能力的控制者」谓词；事件管线对带 condition
 *    的注册要求宿主提供 testTrigger 适配器（pipeline.ts 抛 "Trigger condition adapter
 *    required"），已合入宿主都不提供。
 * 2. 触发注册路径缺失：没有已合入路径把 CardProgram 的 triggered 能力注册进事件管线
 *    并订阅 card-played（引擎源码不读取卡牌程序能力；RIFT-257 卡牌程序绑定仍在进行）。
 * 3. [Hidden]（811）的 Hide/面朝下打出权限未接线：keywords/Hidden.ts 的展开只是
 *    cost.hidden 声明；cost/cost-plan.ts 的 buildHiddenCostPlan 没有调用方，契约 ZoneId
 *    也没有面朝下区域（RIFT-89 费用/区域接线）。
 * 依赖：RIFT-257（卡牌程序绑定）、RIFT-89（Hidden/费用管线）、回合谓词（condition 族）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { self: true },
      condition: {
        kind: "not",
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "current-turn-player-is-controller" }
        }
      }
    },
    optional: false,
    body: [
      {
        id: "momentary-companion.grant-temporary",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Temporary" },
          duration: { kind: "constant", value: "permanent" }
        },
        targets: [
          {
            id: "momentary-companion.self",
            filter: { type: "unit", object: "self" },
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
  canonicalCardId: "card.hash-acd7471a82a9a0d5caee4793bb24dd67313afca36a5e9b63e8e43bb188c5e0d4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-17 复核：continuous.grant-keyword 与 Temporary KeywordDef 已合入，" +
    "授予半段有真实执行证据；当前缺口是触发侧三处，均不近似实现：" +
    "(1) 条件 \"if it's not your turn\" 无法求值——Condition/Expr 没有「当前回合玩家是能力控制者」的谓词，" +
    "事件管线对带 condition 的注册要求宿主 testTrigger 适配器（pipeline.ts 抛 Trigger condition adapter required），" +
    "已合入宿主都不提供；" +
    "(2) 没有已合入路径把卡牌程序的 triggered 能力注册进事件管线并订阅 card-played（引擎不读取 CardProgram 能力，RIFT-257 进行中）；" +
    "(3) [Hidden]（811）的 Hide / 面朝下打出未接线：keywords/Hidden.ts 只声明 cost.hidden，" +
    "cost/cost-plan.ts 的 buildHiddenCostPlan 没有调用方，契约 ZoneId 也没有面朝下区域（RIFT-89）。" +
    "依赖：RIFT-257、RIFT-89、回合谓词（condition 族）。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, if it's not your turn, give me [Temporary]. (Kill me at the start of my controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
