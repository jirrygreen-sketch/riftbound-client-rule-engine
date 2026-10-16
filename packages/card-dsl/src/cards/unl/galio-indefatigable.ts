import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Galio, Indefatigable (unl-171-219) — Unit, Order, energy 3, power 1, Might 6,
 * tags Demacia/Galio/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-171-219，逐字）:
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or
 *    ability.)\n[Tank] (I must be assigned combat damage first.)\n"
 *   "I don't deal combat damage."
 *
 * 规则依据（CR v1.5）:
 * - [Deflect]（809）：Passive Ability 关键词；809.1.c / 809.1.c.1 规定对手选择我时
 *   须额外支付任意域 Power；卡程序按契约 3.7 只声明 keyword，展开归已合入的
 *   effects/keywords/Deflect.ts（static target.tax）。
 * - [Tank]（815）：Passive Ability 关键词；815.1.b 规定同一控制者下、没有 Tank 的
 *   单位必须先被分配致死伤害；只声明 keyword，展开归已合入的
 *   effects/keywords/Tank.ts（static continuous.combat）。
 * - "I don't deal combat damage."：467.2.a / 467.2.b 按单位 Might 汇总战斗伤害，
 *   本条是抑制本单位战斗伤害贡献的静态限制（467.2.c 的分配按各单位的 Might；
 *   与 424.1.b 的 Stunned 单位"不贡献 Might"同族的伤害贡献抑制），不是触发，也不
 *   能用 effect.buff/-Might 之类的数值改写近似（那是另一件事）。
 *
 * status = judge-required：
 * - 战斗伤害贡献抑制没有消费方：仓库里只有 effect.stun 的注释引用 continuous.combat，
 *   combat/base-combat-allocation.ts 明确写着 "No Tank/Backline/other
 *   assignment-priority requirement is bound here"，因此 467.2.a/467.2.b 的 Might
 *   汇总不会读这条限制（rad/ezreal-dashing、rad/graves-blasting-through 记录同一缺口）。
 * - [Deflect] / [Tank] 的展开文件已合入，但把持续效果接进目标税与战斗伤害分配顺序的
 *   生产接线未合入（ogn/pouty-poro 的金测试与 judgeReason 记录同一缺口：
 *   target.tax → TargetPlan 税 → 任意域 Power 支付，以及伤害分配的 Tank 顺序）。
 * 不近似实现（不把"不造成战斗伤害"写成触发器，也不改写 Might 数值）。
 *
 * golden 用已合入的 Deflect KeywordDef 展开与 TargetPlan 的 target.tax 路径真实执行
 * 目标税分支（ogn/pouty-poro 同型），关键词声明与原文逐字校验；其余写 test.todo。
 *
 * 依赖：RIFT-83/RIFT-91（持续效果接线）、RIFT-90（目标税与任意域 Power 支付）、
 * 战斗伤害贡献抑制（467 流程）。
 */
const abilities: Ability[] = [
  // 809：Deflect 只声明，展开归 effects/keywords/Deflect.ts（target.tax）。
  { kind: "keyword", keyword: "deflect" },
  // 815：Tank 只声明，展开归 effects/keywords/Tank.ts（continuous.combat）。
  { kind: "keyword", keyword: "tank" },
  {
    // 467.2.a / 467.2.b："I don't deal combat damage."＝抑制本单位在战斗伤害步骤的
    // Might 贡献。这是静态限制（与 Tank/Backline 的 continuous.combat 同族），由图层
    // 或战斗系统消费；当前没有消费方（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "continuous.combat",
      appliesTo: "self",
      restriction: "no-combat-damage"
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-0c05d1ff76277272f14ee7bb4bda6bb8d7a8d633932b28983770c8aa000f4d0d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1)「I don't deal combat damage.」没有已合入的消费方：467.2.a / 467.2.b 按单位 Might 汇总战斗伤害，" +
    "抑制本单位贡献需要战斗系统读取 continuous.combat 限制；仓库里 combat/base-combat-allocation.ts 明确写着" +
    "「No Tank/Backline/other assignment-priority requirement is bound here」，图层只算特征、不接战斗限制" +
    "（rad/ezreal-dashing、rad/graves-blasting-through 记录同一缺口）。(2) [Deflect]（809）与 [Tank]（815）的 KeywordDef " +
    "展开文件已合入，但生产接线未合入：target.tax 持续效果没有被任何生产方接进目标选择（target-plan 只在调用方显式传 tax 时追加，" +
    "而且已合入的 tax→费用换算按 Energy 记账而 809.1.c.1 要求任意域 Power），伤害分配也不读 Tank 顺序（ogn/pouty-poro、" +
    "sfd/xin-zhao-vigilant 的 judgeReason 记录同一缺口）。" +
    "golden 用已合入的 Deflect 展开与 TargetPlan 的 tax 路径真实执行目标税分支。不近似实现（不把伤害限制写成触发器，也不改 Might 数值）。" +
    "依赖：RIFT-83/RIFT-91（持续效果接线）、RIFT-90（目标税与任意域 Power 支付）、战斗伤害贡献抑制。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Tank] (I must be assigned combat damage first.)\n" +
    "I don't deal combat damage."
} satisfies CardProgram;

export default program;
