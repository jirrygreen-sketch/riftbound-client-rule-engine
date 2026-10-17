import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ziggs, Explosive (rad-112-167) — Unit, 4 Energy, Might 4, Chaos,
 * tags Bandle City/Ziggs/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-112-167，逐字）：
 *   ":rb_energy_1:, :rb_exhaust:: Play a Bomb gear token to a battlefield. (It
 *    has [Deploy]. When it dies, deal 2 to an enemy there and kill your other
 *    Bombs there.)
 *    When I defend, you may kill a friendly gear to give me +2 :rb_might: this
 *    turn."
 *
 * 规则依据（CR v1.5）：
 * - 145.1 / 145.2 / 376 / 377：":rb_energy_1:, :rb_exhaust::" 是启动能力的费用
 *   （1 能量 + 横置自身）；时机默认 Action（381：只在合适的玩家回合与 Open State
 *   可启动）。契约 3.1 的 activated 形状用 cost + body 表达，费用在 Finalize 校验。
 * - 187.12：Bomb gear token 是域无关装备 token，带 [Deploy] 与
 *   "[Deathknell][>] Deal 2 to an enemy unit here and kill all other Bombs you
 *   control here."；830.1.b.1 Deploy 允许打到任意战场（包括敌方占据/开放战场）。
 * - 440.2.c / 185.2.a / 350.2 / 354：被“打出”的新 token 先在链上生成，再由 play
 *   动作接手；185.3 费用为空。
 * - 383.4.f / 383.4.f.1："When I defend…" 是 Defend Trigger，时点 defense-declared。
 * - 355.10.c / 355.10.c.1："you may kill a friendly gear to give me +2 [M] this
 *   turn" 是指令内费用（"[do X] to [do Y]"）。CR 自带的 "When I hold, you may
 *   kill another friendly unit here to draw 1" 例子明确该费用 "does not target
 *   anything"，所以被消灭的装备用 PickSpec（非目标选择）而不是 TargetSpec，
 *   并由契约 3.9 的 choice.optional 包住被选指令；"未付出成本就不给 +2" 由
 *   linkedTo 表达。
 * - 143.2.a.1 / 478.1.a："give me +2 [M] this turn" 是 arithmetic 图层的临时 Might
 *   修改，由已合入的 continuous.might（RIFT-258）注册；317.2.c / 468.7.c 的
 *   "this turn" 由 end-of-turn 到期处理。
 *
 * status = judge-required（README 第 2 节）。本次复核后：两条能力里可执行的部分已
 * 拿到真实执行证据，未合入的缺口逐条保留。
 * 已合入（golden 用解释器 + 参考内核真实执行）：
 * - effect.kill 的 picks 路径执行指令内费用（355.10.c.1）；
 * - continuous.might 注册 "+2 [M] this turn" 的 arithmetic 图层效果（RIFT-258），
 *   并由 layers 引擎求值。
 * 未合入（不近似实现）：
 * 1. Bomb gear token 定义（187.12）：effect.token 的冻结定义表只有 recruit /
 *    sand-soldier / mech / reflection / tentacle，且 TokenSpec 只能承载印制的统计
 *   与 keywords，无法携带 Bomb 自己的 [Deploy] / [Deathknell] 能力文本；对 "bomb"
 *   执行返回 negated(impossible, blockedReason
 *   "token-definition-or-abilities-judge-required")。定义表在 engine-core（不在本
 *   任务写域），不自行扩展或近似。
 * 2. 「Play a Bomb gear token to a battlefield」的目的地：effect.token 的 location
 *    必须是字面 LocationRef，locations + choiceId 需要作者侧给出完整的合法地点列表，
 *    而静态 IR 没有「当前所有战场」这样的集合表达式（355.2.a）；「to a battlefield」
 *    是打出位置的许可/限制而不是目标（355.10.b），由打出流程在 Finalize 解析，
 *    目标/地点提供方（进行中的 RIFT-357 location selection）。
 * 3. Deploy 与 Bomb 的 Deathknell 展开都不完整：Deploy KeywordDef（830.1，RIFT-264）
 *    已合入，但其头注明的消费方仍未合入——continuous.location 的 Finalize 目的地
 *    校验、cleanup 的非单位 Deploy 免召回、hold 触发注册（需要评分事件携带战场身份）；
 *    Deathknell KeywordDef（808）已合入，但其 [Effect] 正文需要的 trigger.leave 原语仍
 *    未注册（effects/keywords/Deathknell.ts 只声明 op id），"deal 2 to an enemy unit
 *    here and kill all other Bombs you control here" 的 "here" 与集合消灭形态没有展开。
 * 4. defense-declared 时点没有产生方：events/action-adapter.ts 只为已提交游戏动作
 *    派生时点（ACTION_TIMINGS 无 defense-declared），combat/flow.ts 在 combat 开启
 *    路径上抛 TurnCombatBlockedError('combat-start-transaction')，
 *    docs/rules/timing-point-producers.md 把该时点标为「待后续」；Defend Trigger 目前
 *    无法入链（383.4.f.2）。
 * 5.（已合入）CardProgram 绑定：src/programs/ 的 createProgramBinding /
 *    attachProgramLifecycle 会把 executable 程序的 activated / triggered / static
 *    能力注册进链与事件管线；golden 已用它做端到端执行证据。card-played 生产方
 *    （chain/engine.ts 打出 spell/unit/gear 时发射）同样已合入。
 * 依赖：effect.token 定义表扩展（承载自带能力的 token）、RIFT-357（进行中：
 * location selection / 当前战场枚举）、RIFT-82（Deathknell trigger.leave 展开）、
 * Deploy 消费方（830.1.b）、RIFT-33/RIFT-124（combat 身份指派与 defense-declared
 * 时点发射）。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    cost: {
      energy: { kind: "constant", value: 1 },
      payments: [
        // 415.5 / 415.3.a：横置符号 = cost.exhaust（“Exhaust me”）。
        { kind: "exhaust" }
      ]
    },
    timing: "action",
    body: [
      {
        id: "ziggs.play-bomb-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bomb" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：新 token 的“打出”先在链上生成。
          mode: { kind: "constant", value: "play" },
          // 355.10.b / 830.1.b.1："to a battlefield" 是打出位置的许可，不是目标；
          // 具体战场由打出流程在 Finalize 选定（355.2.a）。静态 IR 没有「当前所有
          // 战场」的集合表达式，故这里是地点提供方（进行中的 RIFT-357）必须替换成真实
          // LocationRef 列表的占位 id：它不是合法战场，不会被当成目的地使用。
          locations: {
            kind: "constant",
            value: [{ type: "battlefield", id: "battlefields-from-finalize" }]
          },
          choiceId: { kind: "constant", value: "bomb-token-battlefield" },
          linkKey: { kind: "constant", value: "bombToken" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      filter: { event: "defense-declared", filter: { source: "self" } }
    },
    // 印刷为 "you may kill …" 的可选决定（见上方结构说明）。
    optional: false,
    body: [
      {
        id: "ziggs.may-kill-gear",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Kill a friendly gear for +2 Might?" },
          body: {
            kind: "constant",
            value: [
              {
                // 355.10.c.1 的成本部分：CR 自带的 "you may kill another friendly
                // unit here to draw 1" 例子明确该费用 "does not target anything"，
                // 所以用非目标选择（picks）而不是 TargetSpec。选择在 Finalize
                // 锁定（355.8），结算时重验（359.3.e）。
                id: "ziggs.kill-gear",
                op: "effect.kill",
                args: { picks: { kind: "constant", value: "ziggs.friendly-gear" } },
                picks: [
                  {
                    id: "ziggs.friendly-gear",
                    options: ["friendly-gear-you-control"],
                    filter: { type: "gear", controller: "controller" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              },
              {
                // 143.2.a.1 / 478.1.a：本回合 +2 Might 是 arithmetic 图层的临时修改；
                // RIFT-258 的 continuous.might 已能注册该效果，"me" 用 appliesTo self
                // 绑定能力宿主。linkedTo 实现「未付出费用就不给 +2」。
                id: "ziggs.grant-plus-two",
                op: "continuous.might",
                linkedTo: "ziggs.kill-gear",
                args: {
                  amount: { kind: "constant", value: 2 },
                  duration: { kind: "constant", value: "this-turn" },
                  appliesTo: { kind: "constant", value: "self" }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-a4dcf84569e39376034bcb5b5816e3361ee7d9b6fd2439ec78f018cb3c3ec4d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "本次复核后仍缺五个依赖，均不近似实现：" +
    "(1) CR 187.12 的 Bomb gear token 定义不在 effect.token 的冻结定义表内（只有 recruit / sand-soldier / mech / reflection / tentacle），" +
    "TokenSpec 也只承载印制统计与 keywords，无法携带 Bomb 自己的 [Deploy] / [Deathknell] 能力文本；对 \"bomb\" 执行返回 " +
    "negated(impossible, blockedReason \"token-definition-or-abilities-judge-required\")。" +
    "(2) 「Play a Bomb gear token to a battlefield」的目的地不可由静态 IR 生成：effect.token 的 location 必须是字面 LocationRef，" +
    "locations + choiceId 需要作者侧完整的合法地点列表，而 IR 没有「当前所有战场」的集合表达式（355.2.a）；" +
    "「to a battlefield」是打出位置许可而非目标（355.10.b），由 Finalize 地点提供方解析，" +
    "进行中的 RIFT-357（location selection）是其依赖。" +
    "(3) Deploy（830.1，RIFT-264）与 Deathknell（808）的 KeywordDef 已合入，但消费方仍不完整：" +
    "continuous.location 的 Finalize 目的地校验、cleanup 的非单位 Deploy 免召回（830.1.b.3）、需要评分事件携带战场身份的 hold 触发，" +
    "以及 Deathknell [Effect] 正文所需的 trigger.leave 原语（effects/keywords/Deathknell.ts 只声明 op id），" +
    "因此「deal 2 to an enemy unit here and kill all other Bombs you control here」的 here 地点与集合消灭形态都没有展开。" +
    "(4) defense-declared 时点没有产生方：events/action-adapter.ts 只为已提交游戏动作派生时点（ACTION_TIMINGS 无 defense-declared），" +
    "combat/flow.ts 在 combat 开启路径抛 TurnCombatBlockedError('combat-start-transaction')，docs/rules/timing-point-producers.md 标为待后续，" +
    "383.4.f.2 的 Defend Trigger 无法入链。" +
    "(5) 位置枚举依赖进行中的 RIFT-357（location selection）：静态 IR 没有「当前所有战场」的集合表达式。" +
    "已合入并有真实执行证据的部分：启动能力费用形状（145.1/145.2/376/381）、choice.optional 包住 effect.kill 的 picks 路径" +
    "（355.10.c.1 的指令内费用）、continuous.might 注册本回合 +2 Might 的 arithmetic 图层效果（RIFT-258）并经 layers 求值。" +
    "依赖：effect.token 定义表扩展（承载自带能力的 token）、RIFT-357（进行中：location selection / 当前战场枚举）、" +
    "RIFT-82（Deathknell trigger.leave 展开）、" +
    "Deploy 消费方（830.1.b）、RIFT-33/RIFT-124（combat 身份指派与 defense-declared 时点发射）。" +
    "CardProgram 绑定（RIFT-257）与 card-played 生产方已合入。" ,
  abilities,
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Play a Bomb gear token to a battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
    "When I defend, you may kill a friendly gear to give me +2 :rb_might: this turn."
} satisfies CardProgram;

