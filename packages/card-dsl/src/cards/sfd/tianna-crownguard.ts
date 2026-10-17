import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tianna Crownguard (sfd-060-221) — Unit, Calm, Elite/Demacia.
 * energy 7, power 2 (Calm), Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-060-221，逐字）:
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n"
 *   "While I'm at a battlefield, opponents can't score points."
 *
 * 规则依据（CR v1.5）:
 * - [Deflect]（809）：被动能力关键词；809.1.b.3 省略数值按 1，卡只声明 keyword，
 *   展开（static target.tax）归 effects/keywords/Deflect.ts。
 * - "While I'm at a battlefield, opponents can't score points"：静态限制
 *   （363.2.a 的 conditional continuous ability）。470/470.1 区分 Scoring 与 Gaining
 *   Points；471/471.1/471.2 规定 Scoring 只有 Conquer 与 Hold 两条路径，472 限制
 *   每个 battlefield 每回合一次。"opponents can't score points" 因此是「对手不能
 *   执行 Scoring 这一过程」，不是「得分后归零」也不是「防止获得分数」。它在
 *   363.2.a 意义上是一个条件持续限制，只在本卡位于 battlefield（107.1/198.1 的
 *   Location）时生效。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - continuous.restrict 原语已合入（RIFT-259），但 score 不是封闭 GameAction
 *   集合里的动作名，且 scoring/ 只在调用方传入 score 动作时执行 470 起的流程，
 *   没有任何生产方读取 layers/rules/query.ts 的 restrictions()——「对手不能执行
 *   Scoring」仍无消费方（RIFT-31 评分接线）。
 * - 卡牌 static 能力没有图层注册消费方：continuous.restrict 由指令执行时写图层，
 *   而本卡是一条 static 声明（programs/statics.ts 只转发给调用方提供的
 *   binder），所以声明本身无法进入注册表（RIFT-257 后续的 static 绑定）。
 * - 「at a battlefield」的 363.2.a 条件需要用 object-property 读 self 的 location
 *   type 并与 battlefield 比较；持续效果的 condition 评估器
 *   （layers/engine.ts 的 conditionMatches）只理解 always/never/type/has-tag/
 *   has-keyword，未知条件按 true，因此该条件不会被求值（RIFT-91 持续条件）。
 * - [Deflect] 的展开文件已合入（static target.tax），但没有任何生产方把永久物上的
 *   target.tax 接进目标选择与追加费用（target/target-plan.ts 只在调用方显式传入
 *   taxAdapter 时追加；chain 也不从特征派生），已合入的换算按 Energy 记账而
 *   809.1.c.1 要求任意域 Power（与已合入的 ogn/pouty-poro 同一记录）。
 * 依赖：评分侧的持续限制消费方（RIFT-31）、卡牌 static 绑定（RIFT-257）、
 * 持续条件词表（RIFT-91）、Deflect 的目标税接线（RIFT-90/RIFT-89）。
 * 不近似实现（不把限制改写成伤害/扣分效果，也不把 [Deflect] 近似为其它时点或数值）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      appliesTo: "opponents",
      operation: "score",
      forbidden: true
    },
    // 363.2.a：持续限制只在条件成立期间生效——本卡位于战场时。
    condition: {
      kind: "expression",
      value: {
        kind: "object-property",
        object: "self",
        property: "at-battlefield"
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-d4d3c7fbd236daf76867733cea0af3151a9d91e178cb072e3bbb88c4391fef22",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处当前缺口：(1) continuous.restrict 原语（RIFT-259）已合入，但「opponents can't score points」需要 score 动作的" +
    "禁止语义与 scoring/ 侧消费方：封闭 GameAction 集合没有「禁止 Scoring」动作，scoring/ 只在调用方传入 score 动作时" +
    "执行 470 起的流程，没有生产方读取 layers/rules/query.ts 的 restrictions()（RIFT-31）。" +
    "(2) 本卡的持续限制是一条 static 声明，而卡牌 static 能力没有图层注册消费方（programs/statics.ts 只转发给调用方提供的" +
    "binder；continuous.restrict 原语本身是给指令用的），声明无法进入注册表（RIFT-257 后续的 static 绑定）。" +
    "(3)「at a battlefield」的 363.2.a 条件要用 object-property 读 self 的 location type 并与 battlefield 比较，" +
    "而持续效果的 condition 评估器（layers/engine.ts 的 conditionMatches）只理解 always/never/type/has-tag/has-keyword，" +
    "未知条件按 true，条件不会被求值（RIFT-91）。" +
    "(4)[Deflect] 的展开（effects/keywords/Deflect.ts 的 static target.tax）已合入，但没有生产方把永久物上的 " +
    "target.tax 接进目标选择与追加费用（target/target-plan.ts 只在调用方显式传入时追加，chain 不从特征派生），" +
    "且已合入的换算按 Energy 记账而 809.1.c.1 要求任意域 Power（与 ogn/pouty-poro 记录同一缺口，RIFT-90/RIFT-89）。" +
    "不近似实现（不把限制改写成扣分/伤害效果）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "While I'm at a battlefield, opponents can't score points."
} satisfies CardProgram;

export default program;
