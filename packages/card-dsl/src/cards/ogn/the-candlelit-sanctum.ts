import type { CardProgram } from "../../ir/index.js";

/**
 * The Candlelit Sanctum (ogn-291-298) — Battlefield, Colorless.
 *
 * sourceText:
 *   When you conquer here, look at the top two cards of your Main Deck. You may
 *   recycle one or both of them. Put those you don't back in any order.
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1 / 473.2.a: "When you conquer here" is a Conquer Effect,
 *   a triggered ability of this Battlefield; 053.3 makes "here" this Battlefield.
 * - 432.1.c: looking at more cards than the Main Deck holds looks at as many as
 *   possible and never Burns Out.
 * - 417.1 / 417.4: the chosen cards are Recycled to the bottom of their owner's
 *   Main Deck, and a shortfall still resolves.
 * - 437.1.a: putting the remaining cards back on top "in any order" is the
 *   looking player's own ordering.
 *
 * Status: judge-required. Every step is authored with merged ops
 * (effect.inspect / effect.recycle / effect.order) and the golden test really
 * executes the semantics once the two missing bindings are supplied, but the
 * ability cannot run as written:
 * - effect.inspect still validates object-property.object as a runtime ObjectRef
 *   instead of contract 3.6's ObjectSelector, so the looking player cannot be
 *   bound to this ability's controller ("your Main Deck"). Passing
 *   "self"/"source" makes the primitive's own schema throw, and hard-coding a
 *   player id would invent semantics, so no player is fabricated here;
 * - "the top two cards of your Main Deck" needs an ordered card list. Deck
 *   order is only reachable through zoneSlice (RIFT-66); effect.inspect's "top"
 *   scope is documented to need an upstream, ordered picksSpecId, and no merged
 *   producer turns the top two cards into those refs. Without it the look step
 *   is blocked as impossible, and a placeholder pick would silently look at
 *   zero cards instead, so none is written;
 * - "Put those you don't back in any order" is an at-resolution choice over
 *   cards that are still unknown while the chain item finalizes: effect.order
 *   receives its non-target selection from a Finalize-locked PickSpec (359.3.e.9
 *   re-selection) and can only order refs the instruction can already name. The
 *   instruction below offers the linked "looked" refs so the discarded recycled
 *   ones drop out as stale references, but the true "looked minus recycled"
 *   remainder is not expressible;
 * - the conquer timing point exists in events/timing-points.ts, yet scoring/
 *   (RIFT-76) is not bridged to the chain/events pipeline (RIFT-120), so nothing
 *   emits "conquer", and no merged subscriber turns a CardProgram's triggered
 *   ability into a TriggerRegistration;
 * - the trigger filter keeps the sibling battlefield spelling (here: true /
 *   player: "controller") for the 053.3 referent; the engine's trigger-spec
 *   validator currently rejects both fields (EventPattern has no "here",
 *   PlayerSelector has no "controller").
 * Nothing is approximated: the look is not rewritten as a public reveal, no
 * player id stands in for the controller, and no placeholder range is invented.
 */
export default {
  canonicalCardId: "card.hash-9cbd7ae406600f049622c2827bd155c0754bc7dee82570641d6f2eccff28654a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“看主牌库顶两张，可以回收其中任意张，其余任意顺序放回”三步都有已合入原语（effect.inspect / effect.recycle / effect.order），" +
    "golden 在补齐两处缺失绑定后真实执行了全部语义，但整条能力仍不可执行：" +
    "① effect.inspect 的 argsSchema 仍把 object-property.object 当运行时 ObjectRef 校验，未同步契约 3.6 的 ObjectSelector，" +
    "查看者无法绑定到本能力控制者（“your Main Deck”的 you）：传 self/source 会被原语 schema 直接抛错，写死玩家 id 属于发明语义，故不填（RIFT-64 原语与 3.6 契约未对齐）；" +
    "② “主牌库顶两张”需要有序牌表：牌库顶顺序只能经 zoneSlice 取得（RIFT-66），effect.inspect 的 top 作用域要求上游有序 picksSpecId，" +
    "而没有已合入提供者把顶两张解析成引用；缺提供者时该指令按 impossible 明确阻断（占位 pick 会静默变成看 0 张，故不写）；" +
    "③ “Put those you don't back in any order”（437.1.a）是对结算时才揭晓的“看过但未回收”集合做排序选择，而 effect.order 的非目标选择来自" +
    "Finalize 锁定的 PickSpec（359.3.e.9 重选），只能排序指令已能命名的集合；本程序让 order 的 pick 提供“看过的引用”（已回收者按陈旧引用丢弃），" +
    "真正的“看过减已回收”余集仍不可表达；" +
    "④ conquer 时点虽在 events/timing-points.ts 定义，但 scoring/（RIFT-76）未接入 chain/events 单管线（RIFT-120）：没有任何生产者发出 conquer，" +
    "也没有把 CardProgram 的 triggered ability 注册成 TriggerRegistration 的订阅方；" +
    "⑤ filter 的 here: true / player: controller 是同类战场卡占位（053.3 的 here 指代），trigger-spec 校验器当前不接受（EventPattern 无 here，" +
    "PlayerSelector 无 controller）。不近似实现。",
  sourceText:
    "When you conquer here, look at the top two cards of your Main Deck. " +
    "You may recycle one or both of them. Put those you don't back in any order.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          // 432.1.c / 437.1: look at the top two cards of the controller's Main
          // Deck and choose any number of them (0..2) to recycle. The choice is
          // a selection inside one instruction, not a "may" instruction, so it
          // is not written as choice.optional (contract 3.9).
          id: "candlelit-sanctum.look",
          op: "effect.inspect",
          args: {
            player: { kind: "object-property", object: "source", property: "controller" },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 2 },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
            pickedKey: { kind: "constant", value: "candlelit-sanctum-looked" },
            choosePicksKey: { kind: "constant", value: "candlelit-sanctum-recycled" }
          }
        },
        {
          // 417.1.a / 417.4: recycle each chosen card to the bottom of its
          // owner's Main Deck. Choosing none is an executed no-op, so the
          // instruction is not linked to a "if you do" consumer.
          id: "candlelit-sanctum.recycle",
          op: "effect.recycle",
          linkedTo: "candlelit-sanctum.look",
          args: {
            objects: {
              kind: "linked",
              instructionId: "candlelit-sanctum.look",
              key: "candlelit-sanctum-recycled"
            }
          }
        },
        {
          // 437.1.a: put the looked-at cards that were not recycled back on top
          // in any order. The pick offers the looked refs; cards already
          // recycled have left the deck, so effect.order drops their stale
          // references (359.3.e.4) and only the remainder is ordered by the
          // looking player (choice.order).
          id: "candlelit-sanctum.put-rest",
          op: "effect.order",
          linkedTo: "candlelit-sanctum.look",
          args: {
            destination: { kind: "constant", value: "top" },
            cardsPick: { kind: "constant", value: "candlelit-sanctum.put-back" },
            chooseOrder: { kind: "constant", value: true }
          },
          picks: [
            {
              id: "candlelit-sanctum.put-back",
              options: [
                {
                  kind: "linked-value",
                  instructionId: "candlelit-sanctum.look",
                  key: "candlelit-sanctum-looked"
                }
              ],
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
