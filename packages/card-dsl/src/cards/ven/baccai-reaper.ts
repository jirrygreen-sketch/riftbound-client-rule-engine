import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Baccai Reaper (ven-009-166) — Unit, Fury, tag Shurima.
 * energy 3, power 1 (Fury), Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-009-166，逐字）：
 *   When I attack, you may pay :rb_rune_fury: to give me [Assault 2] this turn.
 *   (+2 :rb_might: while I'm an attacker.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.e / 383.4.e.1："When I attack …" 是 Attack Trigger，单位在本次 Combat 中首次
 *   取得 Attacker 身份时触发；对应封闭时点 attack-declared（events/timing-points.ts，
 *   ruleRefs 323.2、383.4.e、466.2.c）。383.4.e.2.a 规定每次 Combat 只检查一次条件，
 *   本卡只有一条攻击触发，不需要额外的 once 作用域。
 * - 135.2.e.4 / 204.1.b：印刷的 :rb_rune_fury: 是 1 个 Fury Power（不带能量符号）；
 *   它在 "you may pay … to …" 里是可选费用，356.2.b.1 的 Optional Additional Cost。
 * - 契约 3.9：“可以……”一律写成 choice.optional，把被选指令包进 body（不是 choice 加 linkedTo）。
 *   因此 「pay 1 Fury Power」与「give me [Assault 2] this turn」两条指令都放在该 body 内。
 * - 807.1 / 807.1.b / 807.1.c：[Assault 2] 的功能文本是 “While I am an attacker, I have
 *   +2 [M]”；括号里正是这句提醒文本，不构成第二条能力。授予一个带有限期限的关键词属
 *   continuous.grant-keyword 的图层授予（契约 3.7），卡文件只声明意图，不重写展开。
 * - 053.1/355.10.g："me" 是能力宿主自身，不是目标。
 *
 * status = judge-required（三处依赖均不近似实现）：
 * 1. cost.pay 指令已随 RIFT-258 合入（golden 真实执行支付并产出 receipt），但生产触发接线未合入：
 *    RIFT-89 的费用计划/触发接线仍在进行，攻击触发的支付步还没有 CardProgram → TriggerRegistration
 *    的执行入口（同 ven-162-166 Protective Sands 的记录）。参考测试内核的 pay 动作只扣
 *    energy/xp，Power 消费要等 engine-core 真实资源侧集成。
 * 2. attack-declared 没有已合入的发出方：combat/flow.ts 仍以 TurnCombatBlockedError
 *    ('combat-start-transaction') 阻塞宣告事务（466.2），攻击时点不进入唯一事件管线；
 *    CardProgram 触发的静态注册已随 RIFT-257 合入（programs/triggers.ts），缺的是时点发射。
 * 3. continuous.grant-keyword 指令已随 RIFT-258 合入且 golden 真实执行授予 [Assault 2]
 *    （end-of-turn 到期，经 layers 引擎投影出关键词），但触发接线（第 2 条）仍使整条
 *    攻击触发无法在生产管线中结算；Assault 自身的展开文件已合入。
 * 依赖：RIFT-89（费用计划接线）、RIFT-120（攻击时点发射与卡牌触发注册）。
 * 已支持部分：choice.optional 的“可以”语义（拒绝时整条被选指令跳过）由 golden 用真实解释器 +
 * 参考内核执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    // 383.4.e.2 / 403.1：触发句没有 "may" 放弃触发本身，"may" 只修饰支付与授予，
    // 由 body 内的 choice.optional 表达（契约 3.9）。
    optional: false,
    body: [
      {
        id: "baccai-reaper.opt-in",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Pay 1 Fury Power to give me [Assault 2] this turn?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "baccai-reaper.pay-fury",
                // cost.pay 已合入（RIFT-258）；payments 承载 1 点 Fury Power 的可选支付。
                op: "cost.pay",
                args: { payments: { kind: "constant", value: { power: ["Fury"] } } }
              },
              {
                id: "baccai-reaper.grant-assault",
                op: "continuous.grant-keyword",
                linkedTo: "baccai-reaper.pay-fury",
                args: {
                  keyword: { kind: "constant", value: "Assault" },
                  value: { kind: "constant", value: 2 },
                  duration: { kind: "constant", value: "end-of-turn" },
                  // "me"：053.1 的自身指代，能力宿主，不是目标（355.10.g）。
                  objects: { kind: "constant", value: { kind: "source" } }
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
  canonicalCardId: "card.hash-49effe3e8a2c9466ade25946a0f4067d8c9dbdadf4c04be9e0216bff858d3c3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "\u4e09\u5904\u4f9d\u8d56\u672a\u5408\u5165\uff1a(1) cost.pay \u6307\u4ee4\u5df2\u968f RIFT-258 \u5408\u5165\uff08golden \u771f\u5b9e\u6267\u884c 1 \u70b9 Fury Power \u652f\u4ed8\u5e76\u4ea7\u51fa receipt\uff1b" +
    "\u53c2\u8003\u6d4b\u8bd5\u5185\u6838\u7684 pay \u52a8\u4f5c\u53ea\u6263 energy/xp\uff0cPower \u6d88\u8d39\u8981\u7b49 engine-core \u771f\u5b9e\u8d44\u6e90\u4fa7\u96c6\u6210\uff09\uff0c" +
    "\u4f46 RIFT-89 \u7684\u8d39\u7528\u8ba1\u5212/\u89e6\u53d1\u63a5\u7ebf\u672a\u5408\u5165\uff0c\u751f\u4ea7\u7ba1\u7ebf\u8fd8\u6ca1\u6709\u628a\u653b\u51fb\u89e6\u53d1\u91cc\u7684\u652f\u4ed8\u6b65\u63a5\u5230 CardProgram \u7684\u6267\u884c\u5165\u53e3\uff1b" +
    "(2) attack-declared \u6ca1\u6709\u5df2\u5408\u5165\u7684\u53d1\u51fa\u65b9\u2014\u2014combat/flow.ts \u4ecd\u4ee5 TurnCombatBlockedError('combat-start-transaction') " +
    "\u963b\u585e\u5ba3\u544a\u4e8b\u52a1\uff08466.2\uff09\uff0c\u653b\u51fb\u65f6\u70b9\u4e0d\u8fdb\u5165\u552f\u4e00\u4e8b\u4ef6\u7ba1\u7ebf\uff1bCardProgram \u89e6\u53d1\u7684\u9759\u6001\u6ce8\u518c\u5df2\u968f RIFT-257 \u5408\u5165" +
    "\uff08programs/triggers.ts\uff09\uff0c\u7f3a\u7684\u662f\u65f6\u70b9\u53d1\u5c04\uff1b" +
    "(3) continuous.grant-keyword \u6307\u4ee4\u5df2\u968f RIFT-258 \u5408\u5165\u4e14 golden \u771f\u5b9e\u6267\u884c\u6388\u4e88 [Assault 2]\uff08end-of-turn \u5230\u671f\uff0c" +
    "\u7ecf layers \u5f15\u64ce\u6295\u5f71\u51fa\u5173\u952e\u8bcd\uff09\uff0c\u4f46\u89e6\u53d1\u63a5\u7ebf\uff08\u7b2c 2 \u6761\uff09\u4ecd\u4f7f\u6574\u6761\u653b\u51fb\u89e6\u53d1\u65e0\u6cd5\u5728\u751f\u4ea7\u7ba1\u7ebf\u4e2d\u7ed3\u7b97\uff1b" +
    "Assault \u81ea\u8eab\u7684\u5c55\u5f00\u6587\u4ef6\u5df2\u5408\u5165\u3002" +
    "\u5df2\u652f\u6301\u90e8\u5206\uff1achoice.optional \u7684\u300c\u53ef\u4ee5\u300d\u8bed\u4e49\uff08\u5951\u7ea6 3.9\uff0c\u62d2\u7edd\u65f6\u6574\u6761\u88ab\u9009\u6307\u4ee4\u8df3\u8fc7\uff09\u7531 golden \u7528\u771f\u5b9e\u89e3\u91ca\u5668 + " +
    "\u53c2\u8003\u5185\u6838\u6267\u884c\u3002\u4f9d\u8d56\uff1aRIFT-89\u3001RIFT-120\u4e0e Power \u8d44\u6e90\u6d88\u8d39\u7684\u5185\u6838\u96c6\u6210\u3002\u4e0d\u8fd1\u4f3c\u5b9e\u73b0\u3002",
  abilities,
  sourceText:
    "When I attack, you may pay :rb_rune_fury: to give me [Assault 2] this turn. " +
    "(+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;
