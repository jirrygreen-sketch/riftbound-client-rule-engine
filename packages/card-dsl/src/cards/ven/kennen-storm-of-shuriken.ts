import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Kennen, Storm of Shuriken (ven-113-166) — Unit, 3 Energy + 1 Chaos Power,
 * Might 4, Chaos, tags Yordle / Kennen / Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-113-166，逐字）：
 *   When you play me, [Burn 2]. (Put the top 2 cards of your Main Deck into
 *   your trash.)
 *   When I conquer, give a spell in your trash [Flow] equal to its cost this
 *   turn. (You may play it from your trash for its Flow cost. Then banish it.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 / 420.4.a：「When you play me」是 Play Effect，封闭时点
 *   "card-played"，filter 用契约 3.6 的符号选择器 { source: "self" } 指向来源本体。
 * - 441.1 / 441.2 / 441.2.a / 441.4：Burning 是「把一名玩家主牌库顶的 X 张牌移到其
 *   弃牌区」；[Burn 2] 的 X = 2，牌库不足时尽可能多地烧。已合入原语 effect.mill
 *   就是该动作：用 zoneSlice 按真实区域顺序取主牌库顶、经 perform({type:
 *   "mill"}) 提交。括号里的文字是 [Burn 2] 的提示文本（441.2 的动作格式说明），
 *   不构成第二条能力；烧牌者缺省为能力控制者（190.6.d 的 "you"）。
 * - 383.4.c / 383.4.c.1 / 473.2.a：「When I conquer」是 Conquer Effect，封闭时点
 *   "conquer"。
 * - 829.1 / 829.1.a–c / 829.1.c.1：Flow 是「以备选费用替换基础费用」的关键词；
 *   "give a spell in your trash [Flow] equal to its cost this turn" 是授予该法术一个
 *   费用等于其自身费用的 Flow 实例（829.1.c.3 的多实例规则要求各自独立）。
 *   effects/keywords/Flow.ts 已合入 KeywordDef（flow.cost 静态效果 + 离链放逐替代），
 *   continuous.grant-keyword 也已合入，但该原语没有承载 Flow 实例的 params.cost；
 *   Flow 的备选费用与离链放逐仍缺生产消费接线。
 * - 355.7 / 355.10.a.1：Trash 是公开区域（Public Information），"a spell in your trash"
 *   是玩家选定的公开区域对象 → TargetSpec（非 pick）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 复核（2026-10-18，实测见 test.mjs 的 probe 用例）：
 * 1. [Burn 2] 半段可执行（effect.mill），golden 用真实解释器 + 参考内核执行；
 * 2. 「give a spell in your trash [Flow]」缺三处消费方/承载：
 *    (a) continuous.grant-keyword 的 argsSchema 拒绝 cost 参数（实测
 *        "Invalid continuous.grant-keyword argument: cost"），"equal to its cost"
 *        没有可承载的动态费用字段；
 *    (b) Flow.ts 展开出的 flow.cost 静态在 programs/statics.ts 被拒
 *        （"Static ability kind flow.cost has no layer mapping"）；
 *    (c) Flow.ts 展开出的 object-leaves-chain replacement 的 body 在
 *        replacement/planner.ts 被拒（BlockedReplacementError
 *        "Unsupported replacement opcode: effect.banish"），829.1.b.1 的离链放逐替代未接通；
 *    cost/cost-plan.ts 虽有 kind "flow" 的 base modification，但没有调用方把 flow.cost 送进去。
 * 3. conquer 触发的封闭事件名已改为 "conquered"，但 turn/flow.ts 的 conquer 发射只携带
 *    player/details，不带被征服战场上的本卡对象；匹配器因此无法用 source:self 命中本单位。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 441.1/441.2/441.4：主牌库顶 2 张进入弃牌区；烧牌者缺省为 ctx.controller。
        id: "kennen-storm-of-shuriken.burn-2",
        op: "effect.mill",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // EventPattern 的封闭事件名是 "conquered"；它由 pipeline-match 映射到 conquer 时点。
      filter: { event: "conquered", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 829.1：给被选法术一个 Flow 实例；"equal to its cost" 是其印刷费用
        // （829.1.c.1 的备选费用替换基础费用），用 { kind: "cost.printed" } 记录。
        // continuous.grant-keyword 已合入，但动态 Flow 费用字段仍缺（见 judgeReason）。
        id: "kennen-storm-of-shuriken.grant-flow",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Flow" },
          cost: { kind: "constant", value: { kind: "cost.printed" } },
          duration: { kind: "constant", value: "this-turn" }
        },
        targets: [
          {
            id: "kennen-storm-of-shuriken.spell-in-trash",
            // "a spell in your trash"：公开区域里的法术牌，由玩家选择（355.7/355.10.a.1）。
            filter: { type: "spell", zone: "trash", owner: "controller" },
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
    "card.hash-f8e2a3619f710bd235f910a96127e6c5f05eb8a3971f892d3d728bab7dc7d677",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，均不近似实现：(1) 829.1.c.1 的动态 Flow 费用没有承载或消费路径：" +
    "continuous.grant-keyword 的 argsSchema 拒绝 cost 参数（实测 \"Invalid continuous.grant-keyword argument: cost\"）；" +
    "Flow.ts 展开的 flow.cost 静态在 programs/statics.ts 被拒（\"Static ability kind flow.cost has no layer mapping\"），" +
    "其 object-leaves-chain replacement body 在 replacement/planner.ts 被拒（BlockedReplacementError " +
    "\"Unsupported replacement opcode: effect.banish\"），cost-plan.ts 虽有 flow base modification，仍没有调用方把" +
    "动态费用送入打出与离链放逐流程。(2) 383.4.c.1 的 conquer 模式现在使用合法事件名 \"conquered\"，" +
    "但 turn/flow.ts 的真实发射只有 player/details，没有被征服战场上的本卡 source/object；" +
    "matchesTriggerEvent 实测因此无法命中 source:self。Burn 2 已由 effect.mill 真实执行，整卡仍保持 judge-required。",
  abilities,
  sourceText:
    "When you play me, [Burn 2]. (Put the top 2 cards of your Main Deck into your trash.)\n" +
    "When I conquer, give a spell in your trash [Flow] equal to its cost this turn. " +
    "(You may play it from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
