import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Starhound (unl-167-219) — Unit, Order, energy 5, power 1, Might 6,
 * tags Dog/Mount Targon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-167-219，逐字）:
 *   "When you play me, return a Bird, Cat, Dog, or Poro from your trash to your
 *    hand."
 *
 * 规则依据（CR v1.5）:
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect，时点 card-played、
 *   filter 指向本卡自身。
 * - 355.7 / 355.9.a / 355.10.a："a Bird, Cat, Dog, or Poro from your trash" 指名
 *   公共区域（108.2.d：Trash 是 Public Zone）里的一张具体牌，因此是选择 → 目标
 *   （355.9.a 的"Recycle a unit from your trash"同例）；"your trash" 用 owner: "self"
 *   限定为能力控制者的 Trash。
 * - 133.8 / 133.8.a：Bird / Cat / Dog / Poro 是标签，只在被文本引用时有效义；
 *   四选一是 OR，而 ObjectFilter 的 tags 是"全部命中"的合取（layers/filter.ts
 *   与 pipeline-match.ts 的 tags.every），IR 没有析取标签形态（见 judgeReason）。
 * - "return … to your hand"：448.2 的换区（不是 Move），用已合入的 effect.zone
 *   的 to: "hand"；目的是该牌拥有者的手牌（108.7.a，内核按拥有者路由）。
 *
 * status = judge-required（缺口不近似实现）:
 * 1. "Bird, Cat, Dog, or Poro" 的四选一标签过滤没有 IR 表达：ObjectFilter.tags 是
 *    合取，用单标签近似会把"某一种生物"当成"四者之一"实现成另一张卡；
 * 2. "your trash" 的 owner: "self" 归一化只在生产链的 query 覆盖里（chain/engine.ts
 *    把 self/opponent 归一化为能力控制者），reference 内核按字面比较，参考路径需要
 *    字面 owner 预置（与其他同型卡一致）；端到端接线属 RIFT-120 后继。
 * 已可执行部分：effect.zone 的 trash→hand 换区（golden 用锁定目标真实执行，含目标
 * 已离区的 ignored 边界）。
 *
 * 依赖：目标过滤的标签析取扩展（355.9.b / 133.8）与 RIFT-90 / RIFT-120 的归一化接线。
 */
const CARD_IN_TRASH = "starhound.card-in-trash";

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
        id: "starhound.return-to-hand",
        op: "effect.zone",
        args: {
          target: { kind: "constant", value: CARD_IN_TRASH },
          // 448.2：换区不是 Move；108.7.a：进入拥有者的手牌。
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: CARD_IN_TRASH,
            // 355.9.a / 355.10.a：Trash 是公共区域，"from your trash" 是目标选择；
            // 133.8 的四选一标签见 judgeReason（tags 只有合取形态），此处记录原文
            // 的候选标签集合，不声称已被消费方解析。
            filter: {
              zone: "trash",
              owner: "self",
              tagsAny: ["Bird", "Cat", "Dog", "Poro"]
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

const program = {
  canonicalCardId:
    "card.hash-71de133e390434f5d40d561542412b99992d3cba7c2705f3c6e156af8fa61a0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1)「a Bird, Cat, Dog, or Poro」是四选一的标签过滤（133.8：标签被文本引用时才有效义），" +
    "而 ObjectFilter.tags 是全部命中的合取（layers/filter.ts 与 events/pipeline-match.ts 的 tags.every），" +
    "IR 没有析取标签形态；用单标签近似会把「某一种生物」实现成另一张卡，故不近似。" +
    "(2)「from your trash」的 owner: \"self\" 归一化只在生产链的 query 覆盖里（chain/engine.ts 把 self/opponent " +
    "归一化为能力控制者），reference 内核按字面比较，参考路径需要字面 owner 预置；端到端接线属 RIFT-120 后继。" +
    "已可执行部分：effect.zone 的 trash→hand 换区（448.2 / 108.7.a），golden 用锁定目标真实执行，" +
    "并覆盖目标已离区时的 ignored（359.3.e.6）。依赖：目标过滤标签析取（355.9.b / 133.8）与 RIFT-90 / RIFT-120 归一化接线。",
  abilities,
  sourceText:
    "When you play me, return a Bird, Cat, Dog, or Poro from your trash to your hand."
} satisfies CardProgram;

export default program;
