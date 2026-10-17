import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Zilean, Time Mage (unl-086-219) — Unit, 5 energy + 1 Mind power，Might 5，Mind，
 * 标签 Icathia/Zilean/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-086-219，逐字）：
 *   Once each turn, if you would play a token unit while I'm at a battlefield,
 *   you may play that token and an additional copy of it instead.
 *
 * 规则依据（CR v1.5）：
 * - “if you would play … instead”：替代效果（369.1 / 370.1–370.3：would…instead 的替代族），
 *   拦截的是“打出 token 单位”这个事件本身；CR 375 的示例（Treasure Hunter 的 Gold gear token
 *   与 “if you would play a token gear, play that token and an additional copy instead”）
 *   正是本类文本，说明替代后的额外副本继承原事件的修正（375 / 375.1）。
 * - “a token unit”：被替代事件的对象是 token 单位（181/185 的 token 定义）。
 * - “while I'm at a battlefield”：替代效果只在来源位于战场时适用（464.2.b 的 here 位置判定；
 *   她在基地时该替代不生效）。
 * - “Once each turn”（383.3.e / 386 / 386.1）：每回合只应用一次。
 * - “you may”：该替代是可选应用（383.3.e.2 的许可语义作用于替代的“may”，消费者按
 *   370.1 的替代应用规则处理）。
 *
 * status = judge-required（2026-10-17 复核）：
 * 替代绑定已经消费 condition，并支持 { linked: "replacement.object" } 事件对象绑定；
 * EventPipeline 已能用 actions 数组替代一个动作，也已支持 optional / oncePerTurn 注册。
 * 真正缺口是卡牌替代声明到每回合重置限次的桥接、来源 LocationRef.type 的可执行谓词，以及
 * 原 token + Chain 上的额外副本两次 play 的 planner / copy 支持，并继承 375 的原事件修正。
 * replacement.event 的 optional 已可声明，但其 window 只有 permanent / next-time-this-turn，
 * 不等于每回合一次；不把已合入的替代管线、费用、事件对象绑定再次列作缺失依赖。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // “if you would play a token unit”：替代一个 play 事件，对象是 token 单位。
    // 使用替代匹配器的 card-played 名称与真实 isToken 特征。
    replaces: {
      event: "card-played",
      filter: { type: "unit", characteristics: { isToken: true }, controller: "self" }
    },
    // 描述来源位置的意图；尚需可执行的 LocationRef.type Condition。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "source-at-a-battlefield" }
    },
    with: [
      {
        id: "zilean-time-mage.play-token-and-additional-copy",
        // “play that token and an additional copy of it instead”：把一次 token 打出改写为两次
        // （原 token + 一个副本）。事件对象绑定已存在，仍需 planner 的 copy/play 支持。
        op: "replacement.play-with-additional-copy",
        args: {
          original: {
            kind: "constant",
            value: { linked: "replacement.object" }
          },
          additional: {
            kind: "constant",
            value: { copyOf: { linked: "replacement.object" } }
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-0edf62a2fa247fc8feb7ea57978657018d5be55376452b2c4173a7170526aa61",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍缺：(1) 383.3.e/386.1 的「Once each turn」卡牌替代声明到每回合重置限次的绑定；" +
    "EventPipeline.oncePerTurn 已实现，但 ReplacementAbility/bindReplacement 尚无对应桥接，" +
    "replacement.event 的 next-time-this-turn 只是一回合的一次性窗口，不能替代每回合重置。" +
    "(2) replacement planner 尚需把「原 token + 额外副本」规划为两次 play，" +
    "包括 Chain 上创建副本和继承原事件修正（375）；effect.copy 的 play 模式仍 blocked。" +
    "(3)「while I'm at a battlefield」仍只有 source-at-a-battlefield 描述性常量，" +
    "Condition/evaluator/binder 没有可执行的 LocationRef.type 谓词；事件对象 replacement.object、" +
    "可选应用与多动作替代本身均已合入。",
  abilities,
  sourceText:
    "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token " +
    "and an additional copy of it instead."
} satisfies CardProgram;

export default program;
