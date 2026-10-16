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
 * 1. 缺 cost.pay 原语：effects/instructions/ 只注册了 effect.* 文件，RIFT-9 原语清单把 cost.pay
 *    列为必需（费用计划接线属 RIFT-89），因此 “you may pay :rb_rune_fury:” 的支付步没有已合入的
 *    执行路径（同 ven-162-166 Protective Sands 的记录）；程序里保留描述性 cost.pay 指令。
 * 2. attack-declared 没有已合入的发出方：该 id 只出现在封闭枚举与关键词展开里，combat/ 不把它
 *    发进唯一事件管线，也没有订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration
 *    （RIFT-120；同 ogn/crackshot-corsair 的记录）。
 * 3. “give me [Assault 2] this turn” 需要卡牌侧 continuous.grant-keyword 指令原语；
 *    effects/instructions/ 下没有该 op（RIFT-91 只合入图层引擎）。Assault 自身的展开文件
 *    effects/keywords/Assault.ts 已合入，但授予与注册入口未接通。
 * 依赖：RIFT-89（cost.pay 与费用计划）、RIFT-120（攻击时点发射与卡牌触发注册）、
 * RIFT-91（continuous.grant-keyword 卡牌侧入口）。
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
                // 描述性 cost.pay：RIFT-9 列为必需原语的支付指令，尚未有实现文件（见 judgeReason）。
                op: "cost.pay",
                args: { power: { kind: "constant", value: ["Fury"] } }
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
    "三处依赖未合入：(1) 缺 cost.pay 原语——effects/instructions/ 只注册了 effect.* 文件，RIFT-9 原语清单把 cost.pay 列为必需" +
    "（费用计划接线属 RIFT-89），所以「you may pay :rb_rune_fury:」的支付步没有已合入的执行路径，程序里保留描述性 cost.pay；" +
    "(2) attack-declared 没有已合入的发出方——该 id 只出现在封闭枚举与关键词展开里，combat/ 不把它发进唯一事件管线，" +
    "也没有订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-120，同 ogn/crackshot-corsair 的记录）；" +
    "(3)「give me [Assault 2] this turn」需要卡牌侧 continuous.grant-keyword 指令原语，effects/instructions/ 下没有该 op" +
    "（RIFT-91 只合入图层引擎；Assault 的展开文件虽已合入，但授予与静态注册入口未接通）。" +
    "已支持部分：choice.optional 的「可以」语义（契约 3.9，拒绝时整条被选指令跳过）由 golden 用真实解释器 + 参考内核执行。" +
    "依赖：RIFT-89、RIFT-120、RIFT-91。不近似实现。",
  abilities,
  sourceText:
    "When I attack, you may pay :rb_rune_fury: to give me [Assault 2] this turn. " +
    "(+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;
