import type { CardProgram, TargetSpec } from "../../ir/index.js";

/**
 * For Demacia!（rad-117-167）— Spell，3 能量，无印刷力量，领域 Order。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-117-167，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Choose a battlefield. Give friendly units there [Shield 2] this turn.
 *    (+2 :rb_might: while they're defenders.)"
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「Choose a battlefield」是具体选择（355.5）；170 规定战场是游戏对象、170.7 允许被法术指定、
 *   355.10.a.1 规定战场区是公开区域，所以战场是目标（355.7 / 355.9.a.1）。
 * - 「Give friendly units there [Shield 2] this turn」不是目标：按 355.10.d 这是按特征程序化选定
 *   的集合（受影响的单位不参与选择），只有战场被指定。
 *   - 814.1 / 814.1.c：Shield 2 是「当我是防御者时 +2 [M]」的被动关键词；reminder 括号是同义释义，
 *     不是独立指令。
 *   - 本回合授予关键词需要带 end-of-turn 期限的 continuous.grant-keyword 持续效果
 *     （契约 3.4：关键词授予落在 ability 图层）。
 *
 * status = judge-required（不近似实现）：
 * 1. continuous.grant-keyword 原语未注册（effects/instructions 只有 effect.* 与解释器控制指令；
 *    forecaster / rumble-hotheaded / gem-jammer 同缺口），无法把 [Shield 2] 授予这些单位（依赖 RIFT-91）。
 * 2. Shield 的展开（effects/keywords/Shield.ts）是 continuous.might 静态效果 + 「designation === "defender"」
 *    条件；该条件依赖未合入的防御者指定特征与图层消费方（RIFT-91；Shield.ts 自述如此）。
 * 3. 「units there」的地点锚点缺运行期 Location：要按所选战场筛选单位，需要从战场对象取它的
 *    LocationRef（target.location 未合入）；本卡把 sameLocationAs 锚点写成待接线声明，不声称可执行。
 *
 * 依赖：RIFT-91（layers-continuous）、RIFT-90（目标/目的地计划）、RIFT-9（continuous.grant-keyword 原语）。
 * golden 只做校验、结构断言与缺口 todo（本卡没有可独立执行的正文指令）。
 */
const forDemacia = {
  canonicalCardId: "card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1) 本回合授予 [Shield 2] 需要 continuous.grant-keyword 持续效果，" +
    "该原语未注册（与 forecaster / rumble-hotheaded / gem-jammer 同缺口，依赖 RIFT-91 / RIFT-9）。" +
    "(2) Shield 的展开是 continuous.might 静态效果加 designation === \"defender\" 条件，防御者指定特征与图层消费方尚未合入" +
    "（effects/keywords/Shield.ts 自述，依赖 RIFT-91）。(3)「friendly units there」需要从所选战场对象取得它的运行期 " +
    "LocationRef（target.location 未合入）才能按地点筛选单位，本卡只保留待接线的 sameLocationAs 锚点" +
    "（依赖 RIFT-90）。战场按 170 / 170.7 / 355.10.a.1 是目标；受影响单位按 355.10.d 不是目标。[Reaction] 声明本身可校验。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // 「Give friendly units there [Shield 2] this turn」：本回合关键词授予 +
          // 按所选战场的地点筛选（两处都缺消费方，见 judgeReason）。
          id: "for-demacia.grant-shield",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Shield" },
            value: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            // 355.10.d：受影响单位是按特征程序化选定的集合，不是目标。
            filter: {
              kind: "constant",
              value: {
                type: "unit",
                controller: "controller",
                sameLocationAs: { target: "for-demacia.battlefield" }
              }
            }
          },
          targets: [
            {
              id: "for-demacia.battlefield",
              filter: { type: "battlefield" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a battlefield. Give friendly units there [Shield 2] this turn. " +
    "(+2 :rb_might: while they're defenders.)"
} satisfies CardProgram;

export default forDemacia;
