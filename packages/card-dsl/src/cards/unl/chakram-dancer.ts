import type { CardProgram } from "../../ir/index.js";

/**
 * Chakram Dancer (unl-071-219) — Unit，3 能量、无印刷 Power、Might 3，Mind / Bilgewater。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-071-219，逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *   units.)\nWhen you play me, give your other units here [Shield] this turn.
 *   (+1 :rb_might: while they're defenders.)
 *
 * 规则依据（CR v1.5）：
 * - 822.1.b / 822.1.c：Ambush 是 Passive Ability keyword，功能上等于「可以向一个你
 *   控制着单位的战场打出」+「按此方式打出时获得 [Reaction]」，并为合法打出位置增加
 *   选项；按契约 3.1/3.7 只声明关键词，展开属关键词注册表。
 * - 383.4.a："When you play me" 是 Play Effect，时点 card-played，filter 指向自身。
 * - 814.1.c：「give … [Shield]」是授予 Shield 关键词；814.1.b.3 未写数值时 X 视为 1；
 *   期限 "this turn" 是 end-of-turn 的持续关键词授予（契约 3.4 的 ability 图层）。
 * - 355.7 / 355.10："your other units here" 是选目标：controller 为能力控制者、
 *   排除来源自身（other）、位置与来源相同（here，053.3）。用契约 3.6 的
 *   sameLocationAs + exclude 锚点表达；解释器的集合查询会解析这两个锚点。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. [Ambush]（822）没有关键词展开：effects/keywords 下没有 Ambush.ts，822.1.c 的
 *    打出位置许可 + 822.1.b 的 [Reaction] 时机需要 continuous.timing + 位置许可消费方
 *    （RIFT-9 的 continuous.timing / target.location 缺口）。
 * 2. 「give your other units here [Shield] this turn」需要带 end-of-turn 期限的
 *    continuous.grant-keyword 持续效果：effects/instructions 无该原语，图层也还没有
 *    消费卡牌 static/持续效果注册的路径（RIFT-91）；Shield 关键词展开文件虽已合入
 *    （keywords/Shield.ts），但其 consumer 同属 RIFT-91。
 * 依赖：RIFT-91（layers-continuous）、关键词工作流的 Ambush 展开、RIFT-9 的
 * continuous.timing / target.location 清单项。
 */
const chakramDancer = {
  canonicalCardId: "card.hash-932827b7cff5b4083f49ad39fa73a27896d400178b231d5a1952c9016f9dbaf3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) [Ambush]（822.1.b/822.1.c）没有关键词展开文件（effects/keywords 无 Ambush.ts），" +
    "其「可向有己方单位的战场打出」位置许可与「按此方式打出时获得 [Reaction]」需要 continuous.timing + 位置许可消费方；" +
    "(2)「give your other units here [Shield] this turn」需要带 end-of-turn 期限的 continuous.grant-keyword 持续效果，" +
    "effects/instructions 无该原语，且没有把卡牌持续效果注册进图层引擎的路径（RIFT-91）；Shield 的展开文件（keywords/Shield.ts）" +
    "已合入但其 consumer 同属 RIFT-91。依赖：RIFT-91、Ambush 关键词展开、RIFT-9 的 continuous.timing/target.location。" +
    "目标过滤（controller + other + here）用解释器已支持的 sameLocationAs/exclude 锚点书写，已在 golden 中按真实集合验证。",
  abilities: [
    { kind: "keyword", keyword: "ambush" },
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { event: "card-played", filter: { role: "self" } } },
      optional: false,
      body: [
        {
          id: "chakram-dancer.grant-shield",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Shield" },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "chakram-dancer.other-units-here",
              // "your other units here"（355.7 的目标选择）：友方单位、排除自身、
              // 与来源同地点。
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                sameLocationAs: "source",
                exclude: "self"
              },
              min: 0,
              selection: "all"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play me, give your other units here [Shield] this turn. (+1 :rb_might: while they're defenders.)"
} satisfies CardProgram;

export default chakramDancer;
