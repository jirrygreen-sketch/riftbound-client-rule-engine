import type { CardProgram } from "../../ir/index.js";

/**
 * Vault Breaker (unl-010-219) — Spell, 1 energy + 1 Fury power, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-010-219，逐字）：
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit [Assault 2] and [Ganking] this turn. (+2 :rb_might: while it's an attacker.
 *   It can move from battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）许可关键词，卡牌只声明（展开归 effects/keywords/Action.ts）。
 * - “Give a unit [Assault 2] and [Ganking] this turn”：把两个关键词授予同一个被选单位，
 *   期限为本回合（317.2.c：所有 “this turn” 效果在回合结束清理时同时到期）。
 *   807.1.c（Assault = 攻击时 +X Might）与 810.1.b（Ganking = 可在战场之间标准移动）的展开
 *   都是关键词自己的责任；reminder 括号只是同义释义，不是独立指令。
 * - “a unit” 是目标（355.9.a.1：未特别说明时指 Board 上的单位），两条授予指令引用同一个
 *   TargetSpec id，Finalize 只做一次选择（对照已合入 ogn/solari-chief 的两条分支共用 same spec）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 没有任何已注册原语能由卡牌 body 注册带 end-of-turn 期限的关键词授予：
 *   effects/instructions/ 没有 continuous.grant-keyword（或 continuous.keyword）文件
 *   （与 ogn/cleave、ven/heart-of-the-tempest、sfd/gem-jammer 同缺口，依赖 RIFT-91 / RIFT-9）。
 * - 即使授予落地，Assault 的展开（keywords/Assault.ts）是“宿主是 attacker 时 +X Might”的静态
 *   图层效果，需要 ObjectSnapshot 的 attacker designation；Ganking 的展开（keywords/Ganking.ts）
 *   是 continuous.movement 许可，也没有消费方（移动系统尚未读该许可）。
 * 本卡没有可独立执行的正文指令，golden 只做校验、结构断言与缺口 todo。
 */
const vaultBreaker = {
  canonicalCardId: "card.hash-b80a5751bd715a9eea06f849357e5792330b5cc9e83d549c928891740c31e9d8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give a unit [Assault 2] and [Ganking] this turn」需要带 end-of-turn 期限的连续关键词授予，" +
    "但 effects/instructions/ 没有任何已注册原语能由卡牌 body 注册关键词授予（无 " +
    "continuous.grant-keyword / continuous.keyword 文件；同 cleave / heart-of-the-tempest / gem-jammer 的缺口，" +
    "依赖 RIFT-91 与 RIFT-9 原语清单）。即使授予落地：Assault 的展开（keywords/Assault.ts，807.1.c）" +
    "是条件于宿主 attacker designation 的 static continuous.might，而 designation 尚未进入 ObjectSnapshot；" +
    "Ganking 的展开（keywords/Ganking.ts，810.1.b）是 continuous.movement 移动许可，移动系统没有该许可的消费方。" +
    "本回合期限（317.2.c）同样需要 addContinuous 的卡牌侧入口。不近似实现（不写成 Buff 计数，也不省略 Ganking）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 授予的 Assault 2 与期限按 807.1.c / 317.2.c 声明；该 op 未注册（见 judgeReason）。
          id: "vault-breaker.grant-assault-2",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "vault-breaker.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 同一句 “and [Ganking]”：同一个被选单位（共用 TargetSpec id），Ganking 无数值。
          id: "vault-breaker.grant-ganking",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Ganking" },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "vault-breaker.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit [Assault 2] and [Ganking] this turn. (+2 :rb_might: while it's an attacker. " +
    "It can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default vaultBreaker;
