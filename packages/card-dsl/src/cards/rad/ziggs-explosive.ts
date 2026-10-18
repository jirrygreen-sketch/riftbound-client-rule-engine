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
 * status = judge-required（README 第 2 节）。2026-10-18 复核：两条能力里可执行的部分已
 * 拿到真实执行证据，未合入的缺口逐条保留（每条均实测）。
 * 已合入（golden 用解释器 + 参考内核真实执行）：
 * - effect.kill 的 picks 路径执行指令内费用（355.10.c.1）；
 * - continuous.might 注册 "+2 [M] this turn" 的 arithmetic 图层效果（RIFT-258），
 *   并由 layers 引擎求值。
 * - Deploy 的清洁期豁免（830.1.b.3）已接入 turn/flow.ts（按关键词 "deploy" 跳过 non-Unit
 *   Gear 的 Recall），实测带 Deploy 的装备留在战场、不带则该步抛 recall-action。
 * 未合入（不近似实现）：
 * 1. Bomb gear token 定义（187.12）：effect.token 的冻结定义表只有 recruit /
 *    sand-soldier / mech / reflection / tentacle，且 TokenSpec 只能承载印制的统计
 *    与 keywords，无法携带 Bomb 自己的 [Deploy] / [Deathknell] 能力文本；对 "bomb"
 *    执行返回 negated(impossible, blockedReason
 *    "token-definition-or-abilities-judge-required")。定义表在 engine-core（不在本
 *    任务写域），不自行扩展或近似。
 * 2. 「to a battlefield」的 LocationExpr 选择器已能解析当前战场，但 effect.token 的解释器
 *    分发仍把已求值参数交给只接受 Expr 的冻结 argsSchema（实测 argsSchema 拒绝
 *    { kind: "location", ... }：Invalid effect.token argument: location），动态地点
 *    尚未接到 token 原语；因此 token 执行边界仍需要一个具体 LocationRef。
 * 3. Deploy 与 Bomb 的 Deathknell 展开都不完整：Deploy KeywordDef（830.1）已合入，
 *    但其 static continuous.location 在生产静态绑定即被拒绝（实测 judge-required:
 *    Static ability kind continuous.location has no layer mapping），Finalize 目的地校验
 *    也仍缺；turn/flow.ts 已提供非单位 Deploy 的清理豁免，hold/conquer/score 事件也已
 *    携带 battlefieldId，但 TriggerSpec 还不能把 Deploy 的“here”绑定到该字段
 *    （实测 translateTriggerFilter 拒绝 { event: "hold", here: true }：
 *    Unsupported filter field here）；Deathknell KeywordDef（808）已合入，
 *    但其 [Effect] 正文需要的 trigger.leave 原语仍未注册
 *    （effects/keywords/Deathknell.ts 只声明 op id），“deal 2 to an enemy unit here and
 *    kill all other Bombs you control here”的 “here” 与集合消灭形态没有展开。
 * 4. defense-declared 时点没有产生方：timing-points.ts 已声明该时点，但 combat/flow.ts 在
 *    combat 开启路径抛 TurnCombatBlockedError('combat-start-transaction')，383.4.f.2 的
 *    Defend Trigger 无法入链。
 * CardProgram 绑定与 card-played 生产方均已有实现；本卡仍因上述四项
 * 规则缺口保持 judge-required。
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
          // LocationExpr 的 choose/filter 让 Finalize 从当前战场候选中给出具体 LocationRef。
          location: {
            kind: "location",
            value: {
              kind: "choose",
              id: "bomb-token-battlefield",
              filter: { type: "battlefield" }
            }
          },
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
    "2026-10-18 复核后仍缺四项真实依赖，均不近似实现：" +
    "(1) CR 187.12 的 Bomb gear token 定义不在 effect.token 的冻结定义表内（只有 recruit / sand-soldier / mech / reflection / tentacle），" +
    "TokenSpec 也只承载印制统计与 keywords，无法携带 Bomb 自己的 [Deploy] / [Deathknell] 能力文本；对 \"bomb\" 执行返回 " +
    "negated(impossible, blockedReason \"token-definition-or-abilities-judge-required\")。" +
    "(2) LocationExpr 选择器虽已能解析当前战场，但 effect.token 的解释器分发仍把已求值参数交给只接受 Expr 的冻结 argsSchema" +
    "（实测拒绝 { kind: \"location\", ... }：Invalid effect.token argument: location），" +
    "动态地点尚未接到 token 原语，执行边界仍需要具体 LocationRef。" +
    "(3) Deploy（830.1）与 Deathknell（808）的关键词展开仍缺消费方：" +
    "Deploy 的 static continuous.location 在生产静态绑定即被拒绝（实测 judge-required: Static ability kind " +
    "continuous.location has no layer mapping）、Finalize 目的地校验与 Deploy hold 触发的注册/地点过滤尚未接通" +
    "（实测 { event: \"hold\", here: true } 被拒：Unsupported filter field here）；" +
    "Deploy 的清洁期免召回（830.1.b.3）已合入 turn/flow.ts，实测带 Deploy 的非 Unit 装备留在战场、" +
    "不带该关键词则在该步抛 recall-action，故这一条不再是缺口；" +
    "Deathknell [Effect] 正文所需的 trigger.leave 原语仍未注册，" +
    "因此 \"deal 2 to an enemy unit here and kill all other Bombs you control here\" 的 here 地点与集合消灭形态都没有展开。" +
    "(4) defense-declared 时点虽已在 timing-points.ts 声明，但 combat/flow.ts 在 combat 开启路径抛出 " +
    "TurnCombatBlockedError('combat-start-transaction')，383.4.f.2 的 Defend Trigger 无法入链。" +
    "已合入并有真实执行证据的部分：启动能力费用形状（145.1/145.2/376/381）、choice.optional 包住 effect.kill 的 picks 路径" +
    "（355.10.c.1 的指令内费用）、continuous.might 注册本回合 +2 Might 的 arithmetic 图层效果并经 layers 求值；" +
    "CardProgram 绑定和 card-played 生产方也已可用。" ,
  abilities,
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Play a Bomb gear token to a battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
    "When I defend, you may kill a friendly gear to give me +2 :rb_might: this turn."
} satisfies CardProgram;

