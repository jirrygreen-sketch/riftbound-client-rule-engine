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
 * 1. [Ambush] 的 KeywordDef（RIFT-266）与 continuous.timing、play-location-permission
 *    声明已合入，但 Finalize 尚未消费战场位置许可，也没有把该许可限定到 Ambush 打出的那一次。
 * 2. 「give your other units here [Shield] this turn」使用已合入的
 *    continuous.grant-keyword（RIFT-258），golden 真实注册 Shield；仍缺卡牌持续效果进入
 *    layers 的生产绑定，以及 Shield 的 defender 条件消费。
 * 依赖：RIFT-91（卡牌静态效果与 Shield 消费）、RIFT-9/RIFT-120（Ambush 位置/时机与接线）。
 */
const chakramDancer = {
  canonicalCardId: "card.hash-932827b7cff5b4083f49ad39fa73a27896d400178b231d5a1952c9016f9dbaf3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Ambush 的 KeywordDef（RIFT-266）与 continuous.timing、play-location-permission 声明已合入，但整卡仍有两处缺口，均不近似实现：(1) Finalize 尚未消费 Ambush 的战场位置许可，也没有把 Reaction 限定到该次打出；" +
    "(2)「give your other units here [Shield] this turn」使用已合入的 continuous.grant-keyword（RIFT-258），golden 可真实注册 Shield，但卡牌持续效果进入 layers 的生产绑定与 Shield 的 defender 条件消费仍缺失。依赖：RIFT-91、RIFT-9、RIFT-120。" +
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
            duration: { kind: "constant", value: "end-of-turn" },
            target: { kind: "constant", value: "chakram-dancer.other-units-here" }
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
