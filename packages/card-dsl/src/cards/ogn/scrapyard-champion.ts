import type { CardProgram } from "../../ir/index.js";

/**
 * Scrapyard Champion (ogn-020-298) — Unit, Fury, Mech/Bandle City, energy 5, Power 1, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-020-298，逐字）:
 *   "[Legion] — When you play me, discard 2, then draw 2. (Get the effect if
 *    you've played another card this turn.)"
 *
 * 规则依据（Core Rules v1.5）:
 * - 812.1 / 812.1.b.1 / 812.1.b.2 / 812.1.c：Legion 是依赖型关键词，[Text] 是依赖能力，
 *   仅当"与本卡不同的一张牌本回合被你 Finalized"时获得；812.2 一张牌即可满足多个实例。
 * - 420.4.a："When you play me" 在打出动作完成时触发；对应时点 card-played。
 * - 423.1 / 423.4："discard 2" 从手牌进入 Trash，效果弃牌尽可能弃（不足 2 张时
 *   有几张弃几张）。
 * - 414.3："draw 2" 用 effect.draw，从 Main Deck 顶抽取；359.3.e.11 / 359.3.e.14.a-b：
 *   "then" 表明两条指令按序结算，弃牌不足不阻止后续抽牌（弃牌指令 negated，抽牌指令
 *   仍照常执行——两条指令不共享条件，也不需要 linkedTo）。
 *
 * 结构说明:
 * - abilities[0] 声明 legion 关键词能力；
 * - abilities[1] 是 Legion 依赖能力本体：card-played 触发（filter 指向自身），
 *   trigger.condition 用本回合 Finalized 的"另一张牌"计数表达 812.1.c 的闸门，
 *   body 依序为 effect.discard(2) 与 effect.draw(2)。
 *
 * 未合入依赖（不近似实现）:
 * - 812.1.c 的"与本卡不同"需要 HistoryQuery 的按卡身份排除维度；已合入的 history
 *   查询结构（scope/action/timingPoint/player/object）没有该字段，契约 3.8 增补的
 *   HistoryQuery.exclude/objectFilter 尚未落地，因此闸门无法求值。
 * - Legion 的 KeywordDef 展开（RIFT-82）与触发 → 进链的卡牌程序接线（RIFT-120）也
 *   没有消费方。body 两条指令本身只用已合入的 effect.discard / effect.draw。
 * 依赖：RIFT-82、RIFT-89/90（条件历史查询落地）、RIFT-120。
 */
const scrapyardChampion = {
  canonicalCardId: "card.hash-813e3cdd87747fd72b9679e715bca8af859194bf01e8160ea2b0bc3334d66ec7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『discard 2, then draw 2』本体只用已合入的 effect.discard / effect.draw（CR 423.1/423.4/414.3）并有执行测试；缺口是 [Legion] 闸门：" +
    "812.1.c 要求本回合已 Finalized『与本卡不同』的另一张牌，已合入的 HistoryQuery（scope/action/timingPoint/player/object）没有按卡身份排除的字段，" +
    "契约 3.8 的 exclude/objectFilter 未落地；Legion 展开（RIFT-82）与触发接线（RIFT-120）也无消费方。" +
    "依赖：RIFT-82、RIFT-89/90、RIFT-120。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "legion" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self", player: "controller" } },
        // 812.1.c：本回合被你 Finalized 的、与本卡不同的牌。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "scrapyard-champion.discard",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 2 } }
        },
        {
          id: "scrapyard-champion.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Legion] — When you play me, discard 2, then draw 2. (Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default scrapyardChampion;
