import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Watchful Curator (rad-037-167) — Unit, 3 energy, 1 power (Calm), 4 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-037-167）：
 *   Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a
 *   spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - 809.1 / 809.1.a：Deflect 是被动能力关键词，通常出现在 Permanents 上；809.1.b.3：印刷省略
 *   数值时按 1；809.1.c：功能文本是“对手用咒语或能力选择我时要多支付 1 点任意域力量”。
 * - 809.2：同一对象上来自多个来源的 Deflect 数值相加（Deflect Value 求和）——本句给每个
 *   友方 gear 授予 1 点，与 gear 自身可能已有的 Deflect 相加。
 * - 809.3：是否拥有 Deflect 是永久物的特征，可被其他游戏效果检查/引用。
 * - “Your gear”：由本卡控制者控制的 gear（190 的控制定义）；授予本身是持续效果（把关键词
 *   附加到对象上），归图层/持续效果（Contract 3.4 的 ability 图层，continuous.grant-keyword）。
 *
 * status 判定（README 第 2 节）：executable。整卡只有这一条 static 授予，其生产绑定、
 * 结算执行与测试内核证据都已合入；不再把已合入的绑定接线（RIFT-257/258 落地部分）
 * 当作缺口。
 * - 生产绑定：ProgramRegistry 接受本卡程序（构造时 validateCardProgram 通过），
 *   .get(CANONICAL) 对 executable 程序返回程序本体（golden 断言）；
 *   createProgramBinding({ cardPrograms: [program] }).bindStatic 把 static 能力经
 *   bindStaticToLayers 注册为 ContinuousEffectSpec（layer = effect 声明的 ability 层；
 *   staticFilter 把 controller 占位符归一为来源控制者、type/zone 白名单透传），
 *   注册对象可直接进 LayerEngine。
 * - 结算形状：continuous.grant-keyword（RIFT-258）在结算期把 [Deflect] 写进匹配对象
 *   的关键词特征（809.3 可读、809.2 与已有 Deflect 求和）。
 * - 执行证据：golden 用解释器 + 图层引擎真实执行（含相加与可读性），并用上述生产
 *   注册路径把本卡 static 绑进真实图层引擎，断言匹配集。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      // “Your gear have [Deflect].” — 809.1.b.3 的省略数值按 1；授予范围是本控制者的 gear。
      kind: "continuous.grant-keyword",
      layer: "ability",
      keyword: "deflect",
      value: { kind: "constant", value: 1 },
      filter: { type: "gear", controller: "controller", zone: "board" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-dc5774a38ed543aac39bd40a45c96e08acddedf25a91e979a8a3576715ec1a5b",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a spell or ability.)"
} satisfies CardProgram;

export default program;
