import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Overzealous Fan (sfd-128-221) — Unit, Chaos, tag Noxus.
 * energy 2, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-128-221，逐字）:
 *   "When I defend, you may kill me to move an attacking unit to its base."
 *
 * 规则依据（CR v1.5）：
 * - "When I defend"：383.4.f / 383.4.f.1 的 Defend Trigger，在本单位首次取得 Defender
 *   身份后进链（封闭时点 defense-declared，events/timing-points.ts，refs
 *   323.2/383.4.f/466.2.c）；383.4.f.2.a 规定每次战斗只检查一次触发条件。
 * - "you may kill me"：403.1 的 "you may" 是可选效果；契约 3.9 要求把被选指令包进
 *   choice.optional 的 body。"kill me" 是 429 的消灭动作（429.1/429.1.a.1.a：效果指令的
 *   主动消灭），已合入的 effect.kill 用 self: true 表达「消灭能力来源」（816.1.b 同型）。
 * - "to move an attacking unit to its base"：351/355.10.c.1 的「[do X] to [do Y]」费用式
 *   代价——消灭本单位是执行移动的代价；移动本身是 451 的效果移动，"an attacking unit"
 *   是选择的具体对象（355.10 / 355.9.a.1，"attacking" = 466.2.c 的 Attacker 身份），
 *   "to its base" 是该攻击者控制者的 Base：107.1.c 把被玩家控制的永久物置于该玩家
 *   的 Base，Base 隶属关系按控制权走（198.1/198.2 的 Base Location；107.1.b/c）。
 *
 * status 判定（cards/README.md 第 2 节，复核 2026-10-17）：judge-required。三处当前缺口：
 * - combat-start-transaction：combat/flow.ts 的 advance() 在把一个 staged battlefield
 *   转成 Combat 时直接抛 TurnCombatBlockedError('combat-start-transaction',
 *   "Combat start needs an atomic simultaneous timing wave + roles (CR 466.2)")，因此
 *   Defender/Attacker 身份（323.2/466.2.c）在生产中不会被指派，也没有 defense-declared
 *   的发射方（events/action-adapter.ts 的 ACTION_TIMINGS 只覆盖已提交游戏动作）。
 * - 嵌套目标："an attacking unit" 是印文里的具体目标（355.9.a.1），按契约 3.9 它随
 *   choice.optional 的 body 一起写；但 chain/engine.ts 的 assertFinalizationSurface 对
 *   嵌套 targets 抛 ChainContractBlockedError('Nested/repeated targets require an
 *   interpreter target-selection lifecycle adapter')，实测该正文在 Finalize 前就被拒绝，
 *   需要解释器侧的目标选择生命周期适配器。
 * - "kill me to move..." 按 204.1.c 是触发能力的基础费用（官方示例即本卡），须在
 *   Finalize 支付；TriggerRegistration 已有 cost/mayAtFinalize 字段，但程序绑定
 *   （programs/triggers.ts）没有把印文费用提取成该字段的接线，正文里的
 *   choice.optional/kill 因此保留为待接线的结算期形状，不能作为费用流程证据。
 * 已合入："an attacking unit" 用目标过滤器读取真实 ObjectSnapshot 的 combatRole
 * （characteristics: { combatRole: "attacker" }，466.2.c），生产 translateObjectFilter 与
 * layers/filter.ts 的 characteristicsMatch 都接受该拼写（golden 分别断言 attacker 命中、
 * defender/null 不命中），因此身份谓词本身不再是缺口。
 * 依赖：combat 的原子开始事务（角色指派 + 时点发射）、嵌套目标的生命周期适配器，
 * 与 Finalize 基础费用提取。
 * 不近似实现（不换时点、不把「正在攻击」放宽成任意单位）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      // "When I defend"：本卡取得 Defender 身份（466.2.c/323.2）。
      filter: { event: "defense-declared", source: "self" },
      // 383.4.f.2.a：每次战斗只检查一次。
      once: "per-combat"
    },
    optional: false,
    body: [
      {
        id: "overzealous-fan.may-kill",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Kill Overzealous Fan to move an attacking unit to its base?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // "kill me"：消灭能力来源（429.1/429.1.a.1.a），effect.kill 的 self 形态。
                id: "overzealous-fan.kill-self",
                op: "effect.kill",
                args: {
                  self: { kind: "constant", value: true },
                  reason: { kind: "constant", value: "kill-this" }
                }
              },
              {
                id: "overzealous-fan.move-attacker",
                op: "effect.move",
                linkedTo: "overzealous-fan.kill-self",
                args: {
                  objects: {
                    kind: "constant",
                    value: { target: "overzealous-fan.attacking-unit" }
                  },
                  // "to its base"：该攻击者**控制者**的 Base（107.1.c：被玩家控制的
                  // 永久物位于该玩家的 Base）。target-controller-base 位置选择器已
                  // 端到端合入（IR 校验、结算时按所选目标派生 {type:"base",
                  // player:controller}、effect.move 的目的地规范化）。
                  to: {
                    kind: "constant",
                    value: { kind: "target-controller-base", target: "overzealous-fan.attacking-unit" }
                  },
                  amount: { kind: "constant", value: 1 },
                  linkKey: { kind: "constant", value: "moved" }
                },
                targets: [
                  {
                    id: "overzealous-fan.attacking-unit",
                    // "an attacking unit"：必须是 466.2.c 的 Attacker。身份在已合入的
                    // ObjectSnapshot 里是 combatRole，用生产 filter 词汇的
                    // characteristics 读取（layers/filter.ts characteristicsMatch）。
                    filter: { type: "unit", zone: "board", characteristics: { combatRole: "attacker" } },
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
];

const program = {
  canonicalCardId: "card.hash-a6e0742278165d13dd6f68c8b8696d40709801c4e6c64fcdc4263f35d6edef38",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口（目标身份与目的地的拼写均已合入并有 golden）：" +
    "(1) combat 开始事务未合入：combat/flow.ts 的 advance() 把 staged battlefield 转成 Combat 时直接抛 " +
    "TurnCombatBlockedError('combat-start-transaction', \"Combat start needs an atomic simultaneous timing wave + roles (CR 466.2)\")，" +
    "因此 Defender/Attacker 身份指派（323.2/466.2.c）尚未接入事件管线，events/action-adapter.ts 的 ACTION_TIMINGS 也没有 defense-declared，" +
    "全仓库没有该时点的发射方（383.4.f.2）；" +
    "(2) 嵌套目标没有生命周期适配器：正文按契约 3.9 把 \"an attacking unit\" 的目标写在 choice.optional 的 body 内，" +
    "但 chain/engine.ts 的 assertFinalizationSurface 对嵌套 targets 抛 " +
    "ChainContractBlockedError('Nested/repeated targets require an interpreter target-selection lifecycle adapter')，" +
    "实测该正文在 Finalize 前被拒绝（同一正文以非嵌套形式执行时目标能正常锁定，见 golden）；" +
    "(3)「kill me to move...」按 CR 204.1.c（官方示例即本卡）是触发能力的基础费用：须在 Finalize 支付，" +
    "但当前程序绑定没有把印文费用提取成 TriggerRegistration.cost/mayAtFinalize（programs/triggers.ts 无该提取接线），" +
    "正文里的 choice.optional/kill 也未映射为 Finalize 决定与支付；" +
    "已合入部分：「an attacking unit」用 characteristics: { combatRole: 'attacker' } 读取真实 ObjectSnapshot 身份（466.2.c），" +
    "programs/filters.ts 的 translateObjectFilter 与 layers/filter.ts 的 characteristicsMatch 都接受该拼写，golden 以真实 Finalize 锁定目标；" +
    "「to its base」用已合入的 target-controller-base 位置选择器按所选目标的控制者取 Base（107.1.c），" +
    "accept-branch golden 对 kill-self 与真实移动做端到端执行。" +
    "依赖：combat 的原子开始事务（角色指派 + 时点发射）、嵌套目标的生命周期适配器与 Finalize 基础费用提取。" +
    "不近似实现（不换时点、不放宽成任意单位）。",
  abilities,
  sourceText: "When I defend, you may kill me to move an attacking unit to its base."
} satisfies CardProgram;

export default program;
