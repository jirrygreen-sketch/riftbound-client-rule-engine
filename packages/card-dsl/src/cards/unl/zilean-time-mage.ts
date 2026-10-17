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
 * 当前缺口见 judgeReason：卡牌替代声明到每回合重置限次的桥接、替代 planner 的两次 play，
 * 以及来源位置的可执行谓词。不把已合入的替代管线、费用、事件对象绑定再次列作缺失依赖。
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
    // 描述来源位置的意图；仍缺可执行的来源位置谓词（见 judgeReason）。
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
    "仍缺（2026-10-17 复核；事件对象 replacement.object、可选应用与多动作替代本身均已合入）：" +
    "(1) 383.3.e/386.1 的「Once each turn」没有卡牌声明到每回合重置限次的桥接：EventPipeline 的 registration.oncePerTurn 已实现（按 turn 记 key），" +
    "但 ReplacementAbility（card-dsl IR）没有该字段，bindReplacement 产出的 registration 上 oncePerTurn 为 undefined（golden 实证），" +
    "replacement.event 的 window 只有 permanent / next-time-this-turn，不能替代每回合重置；alternatively「you may」的可选性同样没有卡牌侧声明通道。" +
    "(2) 替代体不可规划：binding 的 with 指令 op 是 replacement.play-with-additional-copy，replacement/planner.ts 没有该分支，" +
    "实测 createEngineStaticBinder(engine).bindReplacement 抛 \"Unsupported replacement opcode: replacement.play-with-additional-copy\"；" +
    "planner 也没有「原 token + 额外副本」的两次 play（含 Chain 上创建副本并继承原事件修正，CR 375）" +
    "——effect.copy 的 play 模式仍 blocked（\"copy-action-cannot-create-a-pending-chain-object\"，实测判 negated/impossible）。" +
    "(3)「while I'm at a battlefield」仍只有 source-at-a-battlefield 描述性常量：Condition/evaluator/binder 没有可执行的来源位置谓词。" +
    "该常量被 evaluateCondition 当作真值常量（实测战场与基地两种位置都判 true），因此不能用现有形状证明位置门槛；" +
    "ObjectFilter 的 location 键只表示对象自身的位置，不能读取「来源当前在哪」。",
  abilities,
  sourceText:
    "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token " +
    "and an additional copy of it instead."
} satisfies CardProgram;

export default program;
