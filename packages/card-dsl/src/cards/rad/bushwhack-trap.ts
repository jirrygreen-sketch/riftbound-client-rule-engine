import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bushwhack Trap (rad-108-167) — Unit, 1 Energy, Might null, Fury, tag Device。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-108-167，逐字）：
 *   "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill
 *    this.)
 *    While you or an ally control this battlefield, that player may hide an
 *    additional card here."
 *
 * 数据观察（不改数据）：本印刷是 Unit、tags 含 Device、might = null（无印刷值），
 * 而 830.1.a 说 Deploy 出现在 Gear 上；同系列另有 rad-087-167 Portable Portal 与
 * rad-136-167 Dockside Lock-Up 两张 Device Unit。程序按卡面保留 [Deploy] 声明与
 * might = null，不把 null 改写成 0。
 *
 * 规则依据（CR v1.5）：
 * - 830.1 / 830.1.b：Deploy 同时是被动与触发式关键词，功能上等于「可以（且只能）
 *   打到任意战场」「非单位不因清理被召回」「对手在此固守时消灭此牌」；830.2 多个
 *   Deploy 冗余。卡牌只声明关键字（契约 3.1 / README 第 5 节）。
 * - 830.1.b.2 / 830.1.b.3：Deploy 装备可被移动，且不在 Cleanup 第 5 步被召回。
 * - 107.3.a / 107.3.b / 107.3.b.1：每个战场有一个 Facedown Zone，默认上限 1 张，
 *   上限可被效果提高或降低（"hide an additional card here" 即 +1 上限）。
 * - 422.1：Hide 是把牌面朝下放在你控制的战场上的动作；107.3.d 说明失去战场控制时
 *   Facedown Zone 里的牌如何处理。
 * - 190.6.a / 190.6.d：战场由控制者定义「you」，"you or an ally" 还涉及队友
 *   （2v2 模式）的战场控制判定。

 * status = judge-required（README 第 2 节）。复核后的三处缺口，均不近似实现：
 * 1. Deploy 的 KeywordDef 已合入（effects/keywords/Deploy.ts：continuous.location 的
 *    入场/移动许可 + 830.1.b 的「对手在此固守时消灭」触发），但它的展开依赖卡牌程序
 *    → 图层/触发注册已合入，但它的 hold 触发仍用未解决的 here 锚点。
 * 2. 「hide an additional card here」是 Facedown Zone 上限改写（107.3.b.1），需要
 *    Facedown Zone 的区域对象与 Hide 动作：合同 ZoneId 只含 hand/deck/rune-deck/
 *    trash/banishment/board/rune-zone/chain，没有 facedown-zone（effect.stun.ts 的
 *    边界注释记录了同一缺口，card-hidden 时点也尚未接入），
 *    layers 也没有读写 Facedown Zone 上限的消费方。
 * 3. 「you or an ally control this battlefield」需要按 190.6 解析战场控制者并支持
 *    队友口径；战场上「this battlefield」的指代（053.3）在静态 IR 里没有已合入的
 *    地点锚点（target.location 一族未合入）。
 * 依赖：Facedown Zone 区域模型与 Hide 动作、
 * 地点锚点与队友控制条件（RIFT-357 / RIFT-359）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deploy" },
  {
    kind: "static",
    effect: {
      // 830.1.b / 107.3.b.1 的 Facedown Zone 上限 +1；kind 是待实现的持续效果名
      // （continuous.* 家族尚无 Facedown Zone 语义），不是已注册原语。
      kind: "continuous.facedown-capacity",
      layer: "trait",
      value: { kind: "constant", value: 1 },
      zoneKind: "facedown-zone",
      // 「this battlefield」的指代（053.3 的 here）：占位标记，需要按 190.6 解析
      // 战场控制者与队友口径，已合入的静态能力没有该锚点。
      here: true,
      // 「that player」= 控制该战场的玩家（或队友）本人，可以多藏一张。
      permittedPlayer: "battlefield-controller"
    }
  }
];

export default {
  canonicalCardId: "card.hash-7dc2f2b5203681ffa7df7153d6be71e334c6fc0a355cb23adba138c9dd72e338",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) Deploy 的 KeywordDef 已合入（effects/keywords/Deploy.ts，830.1.b 的" +
    "入场/移动许可与「对手在此固守时消灭」触发），但 hold 触发的 here 锚点仍无法通过程序过滤器绑定，" +
    "且它的 hold 触发用 here 锚点、同样受第 3 点限制；" +
    "(2) 「hide an additional card here」是 Facedown Zone 上限改写（107.3.b.1），需要 Facedown Zone 区域对象与 " +
    "Hide 动作，而契约 ZoneId 没有 facedown-zone（同 effect.stun.ts 记录的缺口；card-hidden 时点也没有接入），" +
    "layers 也没有读写上限的消费方；" +
    "(3) 「you or an ally control this battlefield」（190.6.a/190.6.d、053.3）需要战场控制者与队友口径的地点锚点，" +
    "target.location 一族未合入。另注：本印刷是 Unit 且 might = null（无印刷值），程序保留 null 与 Device 标签，不改数据。" +
    "依赖：Facedown Zone 区域模型与 Hide 动作、地点锚点与队友控制条件（RIFT-357 / RIFT-359）。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "While you or an ally control this battlefield, that player may hide an additional card here."
} satisfies CardProgram;

