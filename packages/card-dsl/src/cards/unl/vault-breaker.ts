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
 * status = judge-required（复核 2026-10-17；缺口不近似实现）：
 * - continuous.grant-keyword 已合入，卡内两条授予可通过解释器注册到 ability 层并在回合结束到期；
 *   golden 覆盖该半段。
 * - 即使授予落地，Assault 的展开（keywords/Assault.ts）是“宿主是 attacker 时 +X Might”的静态
 *   图层效果，门控是 compare(object-property self "designation" eq "attacker")。designation 事实本身
 *   已合入（ObjectSnapshot.combatRole，由 expr-ext 求值器读取），但默认条件/图层分派仍不接 expr-ext
 *   （condition.ts 的 evaluateCondition 只走 evaluateExpression、statics.ts 把条件异常吞成 false、
 *   layers/engine.ts 不调用 resolveLayerEffectExpressions），且战斗流程尚未授予 attacker designation。
 * - Ganking 的展开（keywords/Ganking.ts）是 continuous.movement 许可，移动系统不读该许可：
 *   layers/rules/query.ts 的 movement() 只认 effect.permission.routes，而展开写的是
 *   permission: "battlefield-to-battlefield"，golden 实测 canGank/battlefieldToBattlefield 仍为 false；
 *   combat/flow.ts 的标准移动也仍以 standard-move-transaction 阻断。
 * 本卡仍有 Assault/Ganking 消费缺口，golden 覆盖关键词授予与期限，不把授权近似成 Buff。
 */
const vaultBreaker = {
  canonicalCardId: "card.hash-b80a5751bd715a9eea06f849357e5792330b5cc9e83d549c928891740c31e9d8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give a unit [Assault 2] and [Ganking] this turn」的 continuous.grant-keyword 原语已合入，" +
    "可真实注册同一目标的两个 ability-layer 授予并在 end-of-turn 到期（golden 覆盖）。整卡仍缺：" +
    "Assault 的展开（keywords/Assault.ts，807.1.c）" +
    "是条件于宿主 attacker designation 的 static continuous.might：designation 事实已由 ObjectSnapshot.combatRole + " +
    "effects/interpreter/expr-ext/evaluate.ts 提供，但默认条件/图层分派仍不接 expr-ext（condition.ts 的 evaluateCondition " +
    "只走 evaluateExpression、programs/statics.ts 把条件异常吞成 false、layers/engine.ts 不调用 resolveLayerEffectExpressions），" +
    "且 combat/flow.ts 的战斗开始仍以 combat-start-transaction 阻断，没有为攻击单位授予 designation；" +
    "Ganking 的展开（keywords/Ganking.ts，810.1.b）是 continuous.movement 移动许可，移动系统没有该许可的消费方" +
    "（layers/rules/query.ts 的 movement() 只读 effect.permission.routes，展开写的是 permission: \"battlefield-to-battlefield\"，" +
    "golden 实测 canGank 仍为 false；combat/flow.ts 的标准移动也仍以 standard-move-transaction 阻断）。" +
    "本回合期限（317.2.c）由该原语记录；不近似实现（不写成 Buff 计数，也不省略 Ganking）。",
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
          // 授予的 Assault 2 与期限按 807.1.c / 317.2.c 声明；对象选择器指向
          // 同一 TargetSpec，供解释器在结算时读取已锁定的单位。
          id: "vault-breaker.grant-assault-2",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "vault-breaker.unit" }
            }
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
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "vault-breaker.unit" }
            }
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
