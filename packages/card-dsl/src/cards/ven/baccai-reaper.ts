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
 *   ruleRefs 323.2、383.4.e、466.2.c）。383.4.e.2.a 规定每次 Combat 只检查一次条件。
 * - 135.2.e.4 / 204.1.b：印刷的 :rb_rune_fury: 是 1 个 Fury Power（不带能量符号）；
 *   它在 "you may pay … to …" 里是可选费用，356.2.b.1 的 Optional Additional Cost。
 * - 契约 3.9：“可以……”一律写成 choice.optional，把被选指令包进 body。
 * - 807.1 / 807.1.b / 807.1.c：[Assault 2] 的功能文本是 "While I am an attacker, I have
 *   +2 [M]"；括号里是提醒文本，不构成第二条能力。卡文件只声明意图，不重写展开。
 *
 * status = judge-required（2026-10-18 复核，四处当前缺口，均为实测，不近似实现）：
 * 1. attack-declared 没有发射方：实测跑完真实回合不含该时点，把 staged Combat 推进到起点会从
 *    CombatFlow.advance() 抛 TurnCombatBlockedError('combat-start-transaction')（466.2），
 *    攻击时点不进入唯一事件管线。CardProgram 触发的静态注册本身已可用（实测
 *    registerProgramTriggers 成功注册本卡的 attack-declared 订阅）。
 * 2. 触发内的支付步没有生产接线：cost.pay 原语可用且 golden 产出 receipt，但参考内核的
 *    pay 动作只扣 energy/xp——实测持有 1 个 Fury Power 连续支付两次都返回 paid 且池不变；
 *    engine-runtime/host.ts 的 pay() 同样只处理 energy/xp/exhaust/recycle，Power 不被扣减。
 * 3. KeywordGrantLayerEngine 已能在独立 adapter 中重展开授予的 [Assault 2]，并按
 *    combatRole/designation 计算攻击者 Might；默认 CardProgram lifecycle 仍使用基础
 *    LayerEngine，所以生产触发结算只会看到关键词注册，不会消费该 Might 修正。
 * 4. 攻击身份读数缺失：ObjectSnapshot.combatRole 字段虽已声明，但没有生产写入方
 *    （engine-runtime/host.ts 恒定 combatRole: null），即使时点接通也无法判定本卡是攻击者。
 * 已支持部分：choice.optional 的“可以”语义（契约 3.9，拒绝时整条被选指令跳过）由 golden 用真实
 * 解释器 + 参考内核执行。
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
    "四处当前缺口（2026-10-18 复核，均为实测）：(1) attack-declared 没有发射方——实测跑完真实回合不含该时点，" +
    "把 staged Combat 推进到起点会从 CombatFlow.advance() 抛 TurnCombatBlockedError('combat-start-transaction')（466.2）；" +
    "CardProgram 触发的静态注册本身已可用（实测 registerProgramTriggers 注册成功），缺的是时点发射。" +
    "(2) 触发内的支付步没有生产接线：cost.pay 原语可用且 golden 产出 receipt，但参考内核 pay 只扣 energy/xp——" +
    "实测持有 1 个 Fury Power 连续支付两次都返回 paid 且池不变；engine-runtime/host.ts 的 pay() 同样不处理 Power，Power 不会被扣减。" +
    "(3) KeywordGrantLayerEngine 已能在独立 adapter 中把授予的 [Assault 2] 按 combatRole/designation " +
    "重展开并计算攻击者 Might；但默认 CardProgram lifecycle 仍使用基础 LayerEngine，生产触发结算只看到关键词注册，" +
    "不会消费该 Might 修正。" +
    "(4) 攻击身份读数缺失：ObjectSnapshot.combatRole 虽已声明，但没有生产写入方（engine-runtime/host.ts 恒定 null），无法判定攻击者。" +
    "已支持部分：choice.optional 的“可以”语义与 cost.pay receipt 由 golden 用真实解释器 + 参考内核执行。不近似实现。",
  abilities,
  sourceText:
    "When I attack, you may pay :rb_rune_fury: to give me [Assault 2] this turn. " +
    "(+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;
