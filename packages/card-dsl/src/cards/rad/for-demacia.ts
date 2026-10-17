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
 * 1. continuous.grant-keyword 原语已合入（RIFT-258），并且写在 args.objects 里的集合查询会
 *    经解释器解析 sameLocationAs 锚点（effects/interpreter/selectors.ts 的 queryObjects），
 *    因此「friendly units there」按所选战场筛选单位是可执行的——golden 用真实解释器
 *    执行该指令并断言只有该战场的友方单位拿到 [Shield 2]。
 * 2. 仍缺的是关键词授予之后的行为：Shield 的展开（effects/keywords/Shield.ts）是 continuous.might 静态效果
 *    + designation === "defender" 条件，而战斗系统尚未给 ObjectSnapshot 写入 defender 指定；
 *    即使授予已登记，+2 Might 也不会在任何战斗里生效（814.1.d）。
 * 3. CardProgram static 能力 → 图层注册的接线仍未合入（同 rad/packed-amphitheater），
 *    本卡作为 play 正文指令由链执行则不需要该接线。
 *
 * 依赖：RIFT-90（目标计划，本卡已用它锁定战场）、designation 特征与战斗指定（814.1.d）、RIFT-257（卡牌程序 static 注册）。
 * golden 真实执行战场筛选 + [Shield 2] 授予。
 */
const forDemacia = {
  canonicalCardId: "card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) [Shield 2] 的授予本身已可执行——continuous.grant-keyword（RIFT-258）" +
    "按 args.objects 的集合查询解析所选战场的 sameLocationAs 锚点，golden 用真实解释器执行并断言只有该战场的友方单位" +
    "拿到 Shield 2（814.1.c 的 this turn 用 end-of-turn 期限，317.2.c）。" +
    "(2) 仍未合入的是授予之后的行为：Shield 展开为 continuous.might 静态效果 + designation === \"defender\" 条件，" +
    "而战斗系统不给 ObjectSnapshot 写 defender 指定，因此该 +2 Might 在任何战斗里都不会生效（814.1.d）；" +
    "另有 CardProgram static → 图层注册接线缺口（同 rad/packed-amphitheater，RIFT-257）。" +
    "依赖：814.1.d 的 designation 特征与战斗指定、RIFT-257（卡牌程序 static 注册）。" +
    "战场按 170 / 170.7 / 355.10.a.1 是目标；受影响单位按 355.10.d 不是目标。[Reaction] 声明本身可校验。",
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
          // 按所选战场的地点筛选。集合查询走 args.objects（解释器会解析
          // sameLocationAs 锚点到运行期 Location），不是目标（355.10.d）。
          id: "for-demacia.grant-shield",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Shield" },
            value: { kind: "constant", value: 2 },
            // 814.1.c 的 "this turn"：end-of-turn 期限（317.2.c）。
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  // 190.6.d 的 "you"：契约的 PlayerSelector 拼写是 "self"，
                  // 由链上下文按能力控制者解析（"controller" 不是已合入的选择器值）。
                  controller: "self",
                  zone: "board",
                  sameLocationAs: { target: "for-demacia.battlefield" }
                }
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
