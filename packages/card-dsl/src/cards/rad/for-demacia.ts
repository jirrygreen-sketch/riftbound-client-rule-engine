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
 * status = judge-required（2026-10-18 第五轮复核，逐项实测，不近似实现）：
 * 1. continuous.grant-keyword 原语已合入（RIFT-258），并且写在 args.objects 里的集合查询会
 *    经解释器解析 sameLocationAs 锚点（effects/interpreter/selectors.ts 的 queryObjects），
 *    因此「friendly units there」按所选战场筛选单位是可执行的——golden 用真实解释器
 *    执行该指令并断言只有该战场的友方单位拿到 [Shield 2]。
 * 2. 仍缺关键词授予之后的行为。生产默认的 LayerEngine 根本不展开被授予的关键词：
 *    实测经真实解释器授予后 Shield 只停在 object.keywords，Might 保持印刷值，
 *    814.1.c 的 +2 不生效。RIFT-710 的 KeywordGrantLayerEngine 会展开 Shield 并按
 *    designation 条件求值（实测 defender +2、attacker/无角色不加），但它不是生产默认
 *    （ChainEngine 仍构造 LayerEngine，programs/lifecycle.ts 也绑到该引擎）。
 * 3. 默认 LayerEngine 的 conditionMatches 对未实现的 compare 条件返回 true：实测把 Shield
 *    展开的条件 Might 直接注册到默认引擎时，defender/attacker/无角色都读到 +2，
 *    违反 814.1.d.1。若只把展开接进默认引擎而不接条件求值器，+2 会无条件生效。
 * 4. 战斗角色本身没有生产方：combat/flow.ts 在 staged combat 抛 combat-start-transaction，
 *    因此即便接线也没有真实 defender 可用于 814.1.d 的判定。
 * 5. 本卡是 play 正文指令，CardProgram static 能力的绑定不参与本卡结算。
 *
 * 依赖：授予关键词的再展开接线（生产 LayerEngine 或等价生命周期）、图层条件求值器、
 * 以及 combatRole 的战斗指定生产方（814.1.d）。
 * RIFT-681 的模板参数化 golden（test/cards/templates/
 * keyword-play-continuous-grant-keyword-681.test.mjs）经通用测试台真实执行 3 能量支付、
 * 战场筛选与 [Shield 2] 授予，并覆盖「所选战场没有友方单位」的边界。本卡 golden 另有
 * 一条同等路径的用例断言生产链真实锁定战场后才求值 sameLocationAs 集合。
 */
const forDemacia = {
  canonicalCardId: "card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(2026-10-18 第五轮复核实测) 战场筛选与本回合授予仍可执行：continuous.grant-keyword 原语经通用测试台真实支付 3 能量、" +
    "锁定所选战场，并由 sameLocationAs 集合查询断言只有该战场的友方单位在 ability 图层拿到 Shield 2 与 end-of-turn 期限（317.2.c）；" +
    "本卡 golden 另以生产 ProgramBinding + ChainEngine 路径复现同一结算（真实 3 能量支付、became-target 只锁战场、" +
    "其他战场友方单位与对手不变）。" +
    "仍缺的是 Shield 授予之后的行为（814.1.c/814.1.d.1）：" +
    "(1) 生产默认 LayerEngine 不展开被授予的关键词——实测授予后 Shield 只停在 object.keywords，Might 保持印刷值，+2 不生效；" +
    "RIFT-710 的 KeywordGrantLayerEngine 会展开并按 designation 求值（实测 defender +2、attacker/无角色不加），" +
    "但不是生产默认（ChainEngine 仍构造 LayerEngine，programs/lifecycle.ts 也绑到它）；" +
    "(2) 默认 LayerEngine 的 conditionMatches 对未实现的 compare 条件返回 true，实测把展开的条件 Might 注册到默认引擎时" +
    "defender/attacker/无角色都读到 +2，违反 814.1.d.1；" +
    "(3) combatRole 没有生产方（combat/flow.ts 抛 combat-start-transaction），即便接线也没有真实 defender。" +
    "战场按 170 / 170.7 / 355.10.a.1 是目标；受影响单位按 355.10.d 不是目标。[Reaction] 声明本身可校验，不近似实现。",
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
