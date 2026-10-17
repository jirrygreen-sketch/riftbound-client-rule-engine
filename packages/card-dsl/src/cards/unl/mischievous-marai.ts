import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mischievous Marai (unl-003-219) — Unit, 2 Energy, Might 2, Fury, tag Bilgewater.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-003-219，逐字）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n"
 *   "When you play me to a battlefield, deal 2 to an enemy unit here."
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）：811.1 是关键词，811.1.b 的功能文本是"在你的回合的 Open State，你可以
 *   支付 [A] 把此牌面朝下藏在你控制、且尚无面朝下牌的战场；从下一回合起此牌获得
 *   [Reaction]，并可以忽略其基础费用打出"；811.1.c 说明它允许玩家采取 Hide 这一
 *   Discretionary Action，811.1.d.1 要求藏起来的永久物只能打回该战场。按契约 3.7 只
 *   声明 keyword，展开（static cost.hidden）由 effects/keywords/Hidden.ts 提供，实际的
 *   藏牌/打出许可归 cost 与 chain。
 * - "When you play me to a battlefield"：383.4.a 的 Play Effect；这里额外要求打出位置是
 *   Battlefield（143.4 / 359.2.c 允许单位打到基地或战场），因此触发条件包含打出时的位置。
 * - "deal 2 to an enemy unit here"：418.1.c 的 Deal Damage，数额是印刷值 2；418.6.a
 *   说明未指定来源时，描述该效果的对象（本卡）就是来源。"an enemy unit" 是单个由控制者
 *   选择的单位目标（355.9.a.1 的 "Unit" = Board 上的单位；740.1.b 的 enemy = 对手控制），
 *   "here" 是 053.3 的位置限定（比较时用契约 3.6 的 sameLocationAs 锚点指向来源，
 *   已合入的 ObjectFilter 锚点语义见 effects/interpreter/README.md）。
 *
 * status = judge-required（按 2026-10-16 合入批次复核；缺口不近似实现）：
 * - [Hidden] 的 KeywordDef 已合入，但展开出的 static cost.hidden 没有消费方：programs/statics.ts
 *   缺省 noopStaticBinder（没有把卡牌 static 注册进图层的路径），Hide 行动
 *   （支付 [A] 进入 Facedown Zone）与"忽略基础费用 + [Reaction]"的从面朝下打出
 *   （811.1.b / 811.1.d.1）在 cost/ 与 zones/ 中没有接线（cost/README.md 第 3 条同款记录，
 *   与 teemo-scout、wages-of-pain、fox-fire-ahri 同一口径）。
 * - 触发条件 "play me to a battlefield"：card-played 事件的 details 里没有打出位置载荷，
 *   chain/engine.ts 只发 { object, player }（events/timing-points.ts 声明的 payloadFields 未填），
 *   EventPattern 也没有位置匹配字段；因此 [event, object, player, details.playedTo] 这一订阅
 *   经 programs/filters.ts 归一化后仍带 details.playedTo，pipeline-match 会拿不存在的事件细节比较而永不命中，
 *   不能把"打到战场"放宽成"以任意位置打出"（那会在打到基地时错误触发）。
 *
 * 已合入并真实执行的部分：触发体的 effect.damage（418.1.c）用印刷数额 2、对手控制的
 * Board 单位与 sameLocationAs 锚点在 golden 中真实执行，并覆盖部分失效（359.3.e.8）。
 *
 * 依赖：RIFT-84 / RIFT-89（cost.hidden 与 Facedown Zone 的 Hide/打出接线，含 zones 的
 * Champion/Facedown 区域）、RIFT-120（卡牌程序的触发注册适配）与打出事件的位置载荷。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // "you play me"：事件对象是本卡、玩家是能力控制者（383.4.a.1 / 190.6.d）。
        object: { type: "unit", controller: "self" },
        player: "self",
        // "to a battlefield"：打出位置是 Battlefield（143.4）。已合入的 card-played
        // 事件载荷不带位置字段（chain/engine.ts 只 emit object/player），因此该匹配
        // 目前不会命中——缺口本身写在 judgeReason，不把条件放宽成"打到任意位置"。
        details: { playedTo: "battlefield" }
      }
    },
    optional: false,
    body: [
      {
        id: "mischievous-marai.deal-2",
        op: "effect.damage",
        args: {
          // 418.1.c：印刷数额 2 点伤害；未指定来源即本卡（418.6.a 的 effect.damage 缺省）。
          amount: { kind: "constant", value: 2 },
          target: { kind: "constant", value: "mischievous-marai.enemy-unit-here" }
        },
        targets: [
          {
            id: "mischievous-marai.enemy-unit-here",
            // "an enemy unit here"：对手控制的 Board 单位，且与本卡同一位置
            // （355.9.a.1 / 740.1.b / 053.3；sameLocationAs 是契约 3.6 的锚点）。
            filter: {
              zone: "board",
              type: "unit",
              controller: "opponent",
              sameLocationAs: "self"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-4f529d5b9537795c6b9a9afa995ca33097983bdd25950e1c2a6b00ddfb5a5eb2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现（已按 2026-10-16 合入批次复核）：" +
    "(1) [Hidden]（811）的 KeywordDef（effects/keywords/Hidden.ts，static cost.hidden）已合入，" +
    "但没有消费方：programs/statics.ts 缺省 noopStaticBinder（卡牌 static → layers 无注册路径），" +
    "811.1.b / 811.1.c 的 Hide 行动（支付 [A] 把此牌面朝下藏在你控制的战场）与从面朝下打出" +
    "（811.1.b 的忽略基础费用 + [Reaction]、811.1.d.1 的只能打回该战场；本例费用为 :rb_energy_0:）在 cost/ 与 zones/ " +
    "中都没有接线（cost/README.md 第 3 条：zones/actions 尚不支持 Champion/Facedown 区域与 Hide）。" +
    "(2) 触发条件 “When you play me to a battlefield” 需要打出事件携带打出位置：chain/engine.ts 的 card-played 事件" +
    "只带 object/player，details 里没有位置载荷（timing-points.ts 声明的 payloadFields 未填），EventPattern 也没有位置匹配字段，" +
    "因此该订阅归一化后仍带 details.playedTo 而永不命中；把条件放宽为“打到任意位置”会在打到基地（143.4 允许）时错误触发，不采用。" +
    "已合入部分：card-played 触发注册（programs/filters.ts + programs/triggers.ts，RIFT-257）与触发体的 effect.damage" +
    "（418.1.c 印刷 2 点、740.1.b 的 enemy 与 053.3 的 here 写成 sameLocationAs 锚点）在 golden 中用链适配器 + 参考内核真实执行。" +
    "依赖：cost.hidden 与 Facedown Zone 的 Hide/打出接线（RIFT-89 后续）与 card-played 的位置载荷（RIFT-120 后续）。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me to a battlefield, deal 2 to an enemy unit here."
} satisfies CardProgram;
