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
 * - 缺 continuous.restrict 的指令/图层消费方：契约 3.6 的封闭 GameAction 集合没有
 *   「禁止 Scoring」动作，effects/instructions/ 下也没有注册的 continuous.restrict
 *   原语；已合入的 scoring/ 只在调用方传入 score 动作时执行 470 起的流程，没有读取
 *   持续禁止集合。
 * - "at a battlefield" 的持续条件需要一个 Location 谓词（self.location.type ===
 *   battlefield）；解释器的 object-property 能读 location，但持续效果没有落地路径。
 * - [Deflect] 的展开文件已合入（static target.tax），但没有任何生产方把永久物上的
 *   target.tax 接进目标选择与追加费用（target/target-plan.ts 只在调用方显式传入
 *   taxAdapter 时追加；chain 也不从特征派生），已合入的换算按 Energy 记账而
 *   809.1.c.1 要求任意域 Power（与已合入的 ogn/pouty-poro 同一记录）。
 * 依赖：continuous.restrict 原语与评分侧消费方（RIFT-9/RIFT-31）、Deflect 的
 * 目标税接线（RIFT-90/RIFT-89）。不近似实现（不把限制改写成伤害/扣分效果，也不把
 * [Deflect] 近似为其它时点或数值）。
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
    "两处依赖未合入：(1)「While I'm at a battlefield, opponents can't score points」需要 continuous.restrict 持续限制" +
    "（470/471 的 Scoring 过程禁止，非扣分）：契约 3.6 的封闭 GameAction 集合没有「禁止 Scoring」动作，" +
    "effects/instructions/ 下没有注册的 continuous.restrict 原语，scoring/ 也没有读取持续禁止集合；" +
    "「at a battlefield」的 363.2.a 条件需要 Location 谓词与持续效果落地路径（RIFT-9/RIFT-31）。" +
    "(2)[Deflect] 的展开（effects/keywords/Deflect.ts 的 static target.tax）已合入，但没有生产方把永久物上的 " +
    "target.tax 接进目标选择与追加费用（target/target-plan.ts 只在调用方显式传入时追加，chain 不从特征派生），" +
    "且已合入的换算按 Energy 记账而 809.1.c.1 要求任意域 Power（与 ogn/pouty-poro 记录同一缺口，RIFT-90/RIFT-89）。" +
    "不近似实现（不把限制改写成扣分/伤害效果）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "While I'm at a battlefield, opponents can't score points."
} satisfies CardProgram;

export default program;
