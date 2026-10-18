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
 *   Battlefield（143.4 / 359.2.c 允许单位打到基地或战场）。已合入的 card-played 事件在
 *   单位进场移动提交之后发出，事件对象就是刚打完的永久物并已带 location，因此位置条件用
 *   ObjectFilter 的 zone: "battlefield" 表达（layers/filter.ts / events/pipeline-match.ts 的
 *   zone 匹配把 battlefield 解释为 location.type），不再依赖事件 details。
 * - "deal 2 to an enemy unit here"：418.1.c 的 Deal Damage，数额是印刷值 2；418.6.a
 *   说明未指定来源时，描述该效果的对象（本卡）就是来源。"an enemy unit" 是单个由控制者
 *   选择的单位目标（355.9.a.1 的 "Unit" = Board 上的单位；740.1.b 的 enemy = 对手控制），
 *   "here" 是 053.3 的位置限定（比较时用契约 3.6 的 sameLocationAs 锚点指向来源，
 *   已合入的 ObjectFilter 锚点语义见 effects/interpreter/README.md）。
 *
 * status = judge-required（2026-10-18 逐项实测复核；缺口不近似实现）：
 * - [Hidden] 的 KeywordDef 与程序生命周期绑定已合入，但展开出的 static cost.hidden 在
 *   programs/statics.ts 的 layerFor 没有图层映射（实测 "Static ability kind cost.hidden has no
 *   layer mapping"），且 Hide 行动（支付 [A] 进入面朝下区域）与"忽略基础费用 + [Reaction]"的
 *   从面朝下打出（811.1.b / 811.1.d.1）在 cost/ 与 zones/ 中没有接线：cost/kinds/hidden.ts
 *   只锁定费用计划，不移动卡牌、不授予 Reaction、不创建面朝下区域，GameAction 也没有 hide 动作。
 * - 触发体的 "here" 锚点进不了生产目标管线：programs/filters.ts 的 translateObjectFilter 拒绝
 *   契约 3.6 的 sameLocationAs（实测 "Unsupported filter field sameLocationAs"），而
 *   TargetSpec.location 在冻结校验器里只接受具体 base/battlefield 引用或 LocationFilter 谓词，
 *   不能表达 source-relative 位置；解释器查询路径（effects/interpreter/selectors.ts）能解析该
 *   锚点，链的 Finalize 用的却是 layers 的过滤器，两者尚未打通。
 *
 * 已合入并真实执行的部分：触发订阅现在用已合入的事件对象位置表达（object 的 zone: battlefield
 * 与 player: self），实测打到战场命中、打到基地不命中；触发体的 effect.damage（418.1.c）
 * 用印刷数额 2、对手控制的 Board 单位与 sameLocationAs 锚点在 golden 中真实执行，并覆盖
 * 部分失效（359.3.e.8）。
 *
 * 依赖：cost.hidden 的 Hide/面朝下打出消费方（含面朝下区域）与生产目标过滤器的
 * source-relative 位置支持。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // "you play me"：事件对象是本卡、玩家是能力控制者（383.4.a.1 / 190.6.d）；
        // "to a battlefield"：事件对象已带 location，用 zone: "battlefield" 限定
        // （143.4 / 359.2.c 允许单位打到基地或战场，所以这不是"打出"的重复表述）。
        object: { type: "unit", controller: "self", zone: "battlefield" },
        player: "self"
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
            // 该锚点还没有生产消费方，见 judgeReason 第 2 条。
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
    "两处当前缺口（2026-10-18 逐项实测，均不近似实现）：" +
    "(1) [Hidden]（811）的 KeywordDef（effects/keywords/Hidden.ts）展开出 static cost.hidden，" +
    "但 programs/statics.ts 的 layerFor 不接受该 kind（实测 \"Static ability kind cost.hidden has no layer mapping\"），" +
    "且 cost/ 与 zones/ 仍没有 Hide 行动（811.1.b/811.1.c：支付 [A] 把此牌面朝下藏在你控制的战场）与从面朝下打出" +
    "（811.1.b 的忽略基础费用 + [Reaction]、811.1.d.1 的只能打回该战场）：cost/kinds/hidden.ts 只锁定费用计划，" +
    "不移动卡牌、不授予 Reaction、不创建面朝下区域，GameAction 里也没有 hide/面朝下动作。" +
    "(2) 触发体的 \"an enemy unit here\" 进不了生产目标管线：programs/filters.ts 的 translateObjectFilter 拒绝" +
    "契约 3.6 的 sameLocationAs 锚点（实测 \"Unsupported filter field sameLocationAs\"），而 TargetSpec.location 在冻结" +
    "校验器里只接受具体 base/battlefield 引用或 LocationFilter 谓词，无法表达 source-relative 位置；解释器查询路径" +
    "（effects/interpreter/selectors.ts 的 queryObjects）能解析该锚点，链的 Finalize 用的却是 layers 过滤器。" +
    "已合入且真实执行：触发条件 \"When you play me to a battlefield\" 现在用已合入的 card-played 事件对象位置表达" +
    "（object 的 zone: battlefield 与 player: self），实测打到战场命中、打到基地不命中；触发体 effect.damage" +
    "（418.1.c 印刷 2 点、740.1.b 的 enemy、053.3 的 here 锚点）在 golden 中用解释器 + 参考内核真实执行。" +
    "依赖：cost.hidden 的 Hide/面朝下打出消费方与生产目标过滤器的 source-relative 位置支持。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me to a battlefield, deal 2 to an enemy unit here."
} satisfies CardProgram;
