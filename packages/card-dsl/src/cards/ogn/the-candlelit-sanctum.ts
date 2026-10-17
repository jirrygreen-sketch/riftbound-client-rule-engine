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
 * Status: judge-required. The look and remainder steps use the merged ordered
 * pick lifecycle: the body binds "your Main Deck" with `condition.value` + a
 * linked value, Finalize captures the ordered top-two zone slice, and Resolve
 * computes the looked-minus-recycled remainder through a linked exclusion. The
 * golden test drives the full look → recycle → put-back chain through the
 * production adapter with both recycle choices. The remaining gap is the
 * conquer timing point's 053.3 "here" referent and Battlefield ability-controller
 * binding: the trigger filter keeps the battlefield spelling (here: true /
 * player: "controller"), which the merged programs/filters.ts and trigger-spec
 * layer do not resolve.
 */
export default {
  canonicalCardId: "card.hash-9cbd7ae406600f049622c2827bd155c0754bc7dee82570641d6f2eccff28654a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“看主牌库顶两张，可以回收其中任意张，其余任意顺序放回”三步已按有序 pick 契约编码并可由已合入原语完整执行：" +
    "zoneSlice 在 Finalize 锁定牌库顺序，linked + exclude 在 Resolve 计算“看过减已回收”的余集，golden 经生产适配器覆盖两种选择。" +
    "“your Main Deck”的查看者用 condition.value + linked-value 绑定；这是对 effect.inspect 参数校验形状的兼容写法，不是规则缺口。" +
    "整条能力仍不可执行的当前缺口是 conquer 触发的 053.3 “here” 位置锚点与 Battlefield 能力控制者绑定：filter 的 here: true / player: controller 仍无法由 programs/filters.ts / trigger-spec 解析，" +
    "因此无法把本战场的征服事件绑定到该 Battlefield 能力；不近似实现。",
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
          // "your Main Deck" = the ability controller's deck. effect.inspect's
          // schema still requires a runtime ObjectRef in object-property.object,
          // so the controller is bound once here and read back by the look
          // instruction (the merged stacked-deck / double-trouble pattern).
          id: "candlelit-sanctum.bind-controller",
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          // 432.1.c / 437.1: look at the top two cards of the controller's Main
          // Deck and choose any number of them (0..2) to recycle. The choice is
          // a selection inside one instruction, not a "may" instruction, so it
          // is not written as choice.optional (contract 3.9).
          id: "candlelit-sanctum.look",
          op: "effect.inspect",
          linkedTo: "candlelit-sanctum.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "candlelit-sanctum.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 2 },
            // 108.4.e / contract 3.6: deck order comes from zoneSlice through
            // the ordered pick set; effect.inspect refuses to guess it.
            picksSpecId: { kind: "constant", value: "candlelit-sanctum.top-two" },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
            pickedKey: { kind: "constant", value: "candlelit-sanctum-looked" },
            choosePicksKey: { kind: "constant", value: "candlelit-sanctum-recycled" }
          },
          picks: [
            {
              id: "candlelit-sanctum.top-two",
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
            }
          ]
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
              options: [],
              ordered: true,
              selection: "all",
              linked: {
                kind: "linked-value",
                instructionId: "candlelit-sanctum.look",
                key: "candlelit-sanctum-looked"
              },
              exclude: {
                kind: "linked-value",
                instructionId: "candlelit-sanctum.recycle",
                key: "recycled"
              }
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
