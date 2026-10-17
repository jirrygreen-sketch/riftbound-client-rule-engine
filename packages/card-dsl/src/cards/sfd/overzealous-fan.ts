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
 *   "to its base" 是该攻击者拥有者的 Base（198.1/198.2 的 Base Location；107.1.b）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处已合入缺口：
 * - defense-declared 时点没有发射方：events/action-adapter.ts 只为已提交游戏动作派生时点
 *   （ACTION_TIMINGS 无 defense-declared），combat/ 的 Defender 身份指派
 *   （466.2.c/323.2）尚未接入事件管线——combat/flow.ts 的 combat 开启路径直接抛
 *   TurnCombatBlockedError('combat-start-transaction')，全仓库没有 defense-declared 的 emit。
 * - "an attacking unit" 的目标合法性需要 Attacker 身份谓词（466.2.c）；ObjectFilter 的
 *   states 只有 ready/exhausted/stunned/attached/face-down，ObjectSnapshot 没有
 *   combatRole/designation（契约 3.8 只冻结了字段设计，实现属战斗批次），
 *   目标无法在 Finalize 按「正在攻击」筛选。
 * - "to its base" 需要该攻击者拥有者的 Base Location：effect.move 的 to 只接受静态
 *   LocationRef、controller-base 或静态候选列表；controller-base 会落到移动后控制者的
 *   Base（若控制者中途改变便不等价），而 198.2 要求的是拥有者的 Base，且该值要按所选
 *   目标在结算时派生（target.location 未合入）。
 * 依赖：combat 身份指派与事件管线发射、目标与目的地计划、
 * Attacker designation。不近似实现（不换时点、不用 controller-base 冒充
 * 拥有者 Base、不把「正在攻击」放宽成任意单位）。
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
                  // "to its base"：该攻击者**拥有者**的 Base（198.2）。effect.move 的
                  // controller-base 会按移动后的控制者取 Base，不等价；按所选目标在结算时
                  // 派生 LocationRef（target.location）尚未合入，故声明待接线的目的地。
                  to: { kind: "constant", value: { ownerBaseOf: { target: "overzealous-fan.attacking-unit" } } },
                  amount: { kind: "constant", value: 1 },
                  linkKey: { kind: "constant", value: "moved" }
                },
                targets: [
                  {
                    id: "overzealous-fan.attacking-unit",
                    // "an attacking unit"：必须是 466.2.c 的 Attacker。ObjectFilter 的
                    // states 没有该身份（契约 3.8 的 combatRole/designation 尚未实现），
                    // 这里用 attacking 谓词声明该缺失条件，fail-closed 而不是放宽成任意单位。
                    filter: { type: "unit", zone: "board", attacking: true },
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
    "三处当前缺口（kill/optional 部分已合入并有 golden）：(1) defense-declared 时点没有发射方——events/action-adapter.ts 只为已提交游戏动作派生时点" +
    "（ACTION_TIMINGS 无 defense-declared），combat/ 的 Defender 身份指派（466.2.c/323.2、383.4.f.2）尚未接入事件管线，" +
    "combat/flow.ts 的 combat 开启路径直接抛 TurnCombatBlockedError('combat-start-transaction')，全仓库没有该时点的 emit；" +
    "(2)「an attacking unit」的目标合法性需要 Attacker 身份谓词（466.2.c）——ObjectFilter 的 states 只有 " +
    "ready/exhausted/stunned/attached/face-down，ObjectSnapshot 没有 combatRole/designation（契约 3.8 只冻结字段设计，" +
    "实现属战斗批次），Finalize 无法按「正在攻击」筛选目标；" +
    "(3)「to its base」需要所选攻击者**拥有者**的 Base（198.2）：effect.move 的 to 只接受静态 LocationRef、" +
    "controller-base 或静态候选列表，controller-base 按移动后的控制者取 Base、不等价，按目标派生 LocationRef 的" +
    "target.location 未合入。" +
    "「kill me」的 effect.kill（self: true，429.1/429.1.a.1.a）与 choice.optional（403.1、契约 3.9）形状已合入，" +
    "golden 对 kill 体做真实执行。依赖：combat 身份指派与事件发射、目标与目的地计划、" +
    "Attacker designation。不近似实现（不换时点、不用 controller-base 冒充拥有者 Base、不放宽成任意单位）。",
  abilities,
  sourceText: "When I defend, you may kill me to move an attacking unit to its base."
} satisfies CardProgram;

export default program;
