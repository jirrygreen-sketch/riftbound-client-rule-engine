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
 * status 判定（cards/README.md 第 2 节）：judge-required。三处当前缺口：
 * - defense-declared 时点没有发射方：events/action-adapter.ts 只为已提交游戏动作派生时点
 *   （ACTION_TIMINGS 无 defense-declared），combat/ 的 Defender 身份指派
 *   （466.2.c/323.2）尚未接入事件管线——combat/flow.ts 的 combat 开启路径直接抛
 *   TurnCombatBlockedError('combat-start-transaction')，全仓库没有 defense-declared 的 emit。
 * - "an attacking unit" 的目标合法性需要 Attacker 身份谓词（466.2.c）。数据侧已用
 *   combatRole: "attacker" 表达（引擎快照与参考内核按该字段匹配），但生产程序绑定的
 *   programs/filters.ts 仍把该键 fail-closed 拒绝，且 combat/ 的战斗指派未接入事件管线，
 *   正式对局里该身份不会被赋值。
 * - "kill me to move..." 按 204.1.c 是触发能力的基础费用（官方示例即本卡），须在
 *   Finalize 支付；TriggerRegistration 已有 cost/mayAtFinalize 字段，但程序绑定
 *   （programs/triggers.ts）没有把印文费用提取成该字段的接线，正文里的
 *   choice.optional/kill 因此保留为待接线的结算期形状，不能作为费用流程证据。
 * 依赖：combat 身份指派与事件管线发射、目标计划消费方（含生产 filter 注册）、
 * Attacker designation。不近似实现（不换时点、不把「正在攻击」放宽成任意单位）。
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
                    // "an attacking unit"：必须是 466.2.c 的 Attacker；引擎快照已有
                    // combatRole 字段（战斗批次尚未把 Attacker 指派接入事件管线，且生产
                    // 程序绑定还没有注册该 filter 键）。
                    filter: { type: "unit", zone: "board", combatRole: "attacker" },
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
    "两处当前缺口（kill/optional、目标目的地均已合入并有 golden）：(1) defense-declared 时点没有发射方——events/action-adapter.ts 只为已提交游戏动作派生时点" +
    "（ACTION_TIMINGS 无 defense-declared），combat/ 的 Defender 身份指派（466.2.c/323.2、383.4.f.2）尚未接入事件管线，" +
    "combat/flow.ts 的 combat 开启路径直接抛 TurnCombatBlockedError('combat-start-transaction')，全仓库没有该时点的 emit；" +
    "(2)「an attacking unit」用 combatRole:'attacker'（466.2.c）声明，参考内核可匹配，但生产程序绑定的 " +
    "programs/filters.ts 未注册该键（fail-closed），且 combat/ 的 Attacker/Defender 指派尚未接入事件管线。" +
    "(3)「kill me to move...」按 CR 204.1.c（官方示例即本卡）是触发能力的基础费用：须在 Finalize 支付，" +
    "但当前程序绑定没有把印文费用提取成 TriggerRegistration.cost/mayAtFinalize（programs/triggers.ts 无该提取接线），" +
    "正文里的 choice.optional/kill 也未映射为 Finalize 决定与支付；" +
    "「to its base」用已合入的 target-controller-base 位置选择器按所选目标的控制者取 Base（107.1.c），" +
    "accept-branch golden 对 kill-self 与真实移动做端到端执行。" +
    "依赖：combat 身份指派与事件发射、生产目标计划消费方（含 filter 注册）。" +
    "不近似实现（不换时点、不放宽成任意单位）。",
  abilities,
  sourceText: "When I defend, you may kill me to move an attacking unit to its base."
} satisfies CardProgram;

export default program;
