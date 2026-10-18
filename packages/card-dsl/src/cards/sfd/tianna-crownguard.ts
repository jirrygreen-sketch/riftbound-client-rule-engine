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
 * status 判定（cards/README.md 第 2 节，2026-10-18 复核）：judge-required，三处缺口均实测。
 * - (1) 本卡的静态声明首先过不了生产静态绑定器：appliesTo: "opponents" 实测被
 *   programs/statics.ts 以 ProgramBindingError "Unsupported static appliesTo \"opponents\"" 拒绝，
 *   而对手相对过滤同样被拒（effect.filter.controller: "opponent" 实测抛
 *   "Static controller:opponent filter needs a relative-player query"）；能绑定的只有 self 拼写，
 *   那会把限制挂到错误玩家上。即便注册成功，scoring 流程也没有消费方——
 *   layers/rules/query.ts 的 restrictions() 能返回 score 禁止项，
 *   但 turn/flow.ts 的计分步直接 commit({ type: 'score' })，ChainEngine 的规则查询只覆盖
 *   target/choose-as-target 与 draft 动作名，没有任何计分侧读取该限制的地方。
 * - (2)「at a battlefield」的 363.2.a 条件仍需把 self 的 location type 映射为
 *   battlefield 谓词：静态条件的求值环境实测以 "Unavailable characteristic: at-battlefield"
 *   失败，ObjectSnapshot 只有 location/zone，没有该派生谓词。
 * - (3) [Deflect] 的展开文件已合入（static target.tax），但静态绑定器实测以
 *   "Static ability kind target.tax has no layer mapping" 拒绝它，
 *   且没有任何生产方把永久物上的 target.tax 接进目标选择与追加费用
 *   （target/target-plan.ts 只在调用方显式传入 taxAdapter 时追加；chain 也不从特征派生）。
 * 依赖：评分侧读取 restrictions() 的消费方、`at-battlefield` 条件求值，
 * 以及 Deflect 的 target.tax 静态绑定与任意域 Power 目标税接线（809.1.c.1）。
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
    "三处当前缺口（2026-10-18 实测）：(1)「opponents can't score points」（CR 470/471 的 Scoring 过程）需要计分侧消费方。" +
    "continuous.restrict 原语与 layers/rules/query.ts 的 restrictions() 已合入，" +
    "但本卡的印刷声明先被生产 binder 拒绝：appliesTo: \"opponents\" 实测抛" +
    "ProgramBindingError「Unsupported static appliesTo \"opponents\"」，静态能力不进入图层；" +
    "对手相对过滤也不可绑定（effect.filter.controller: \"opponent\" 实测抛「Static controller:opponent filter needs a relative-player query」），" +
    "能绑定的 self 拼写只会把限制挂到错误玩家上；而且 turn/flow.ts 的计分步直接 commit({ type: 'score' })，" +
    "ChainEngine 的规则查询只覆盖 target/choose-as-target 与 draft 动作名，没有任何生产方读取该 score 禁止项。" +
    "(2)「at a battlefield」的 363.2.a 条件仍需派生谓词：静态条件求值实测抛" +
    "MissingInformation「Unavailable characteristic: at-battlefield」，ObjectSnapshot 只有 location/zone。" +
    "(3)[Deflect] 的展开（effects/keywords/Deflect.ts 的 static target.tax）已合入，" +
    "但生产静态绑定器实测以「Static ability kind target.tax has no layer mapping」拒绝它，" +
    "且没有生产方把永久物上的 target.tax 接进目标选择与追加费用" +
    "（target/target-plan.ts 只在调用方显式传入时追加，chain 不从特征派生），" +
    "chain/engine.ts::finalize 仍把税额折成 Energy 分量，而 809.1.c.1 要求任意域 Power。" +
    "不近似实现（不把限制改写成扣分/伤害效果）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "While I'm at a battlefield, opponents can't score points."
} satisfies CardProgram;

export default program;
