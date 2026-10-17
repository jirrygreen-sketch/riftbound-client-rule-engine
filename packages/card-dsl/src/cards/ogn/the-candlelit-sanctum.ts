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
 * Status: judge-required. The look step is now executable through merged code:
 * the body binds "your Main Deck" with `condition.value` + a linked value (the
 * merged pattern used by stacked-deck / double-trouble, because effect.inspect's
 * schema still validates object-property.object as a runtime ObjectRef instead
 * of contract 3.6's ObjectSelector), and the golden test drives the full
 * look → recycle → put-back chain through the production adapter with an
 * ordered deck-top pick set. Remaining merged gaps, none approximated:
 * - the ordered "top two cards" pick set has no production lifecycle: the chain
 *   Finalize surface only locks instruction.targets TargetSpecs
 *   (chain/engine.ts assertFinalizationSurface) and never provisions ordered
 *   zone picks. Without the ordered source the look range is empty and the
 *   whole ability looks at nothing (the primitive refuses to guess deck order);
 * - "Put those you don't back in any order" is an at-resolution choice over
 *   cards that are still unknown while the chain item finalizes: effect.order
 *   reads its non-target selection from a Finalize-locked PickSpec (359.3.e.9
 *   re-selection), so the printed "looked minus recycled" remainder cannot be
 *   named; the program offers the linked "looked" refs and relies on the
 *   recycled ones going stale (359.3.e.4), which the golden exercises both ways;
 * - the conquer timing point is now really emitted (TurnFlow schedules the
 *   Score wave, combat/flow.ts commits the conquer), but no merged subscriber
 *   turns a CardProgram's triggered ability into a TriggerRegistration
 *   (RIFT-257, in progress), and the trigger filter keeps the sibling
 *   battlefield spelling (here: true / player: "controller") for the 053.3
 *   referent, which the merged translateTriggerFilter/trigger-spec layer does
 *   not resolve.
 */
export default {
  canonicalCardId: "card.hash-9cbd7ae406600f049622c2827bd155c0754bc7dee82570641d6f2eccff28654a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“看主牌库顶两张，可以回收其中任意张，其余任意顺序放回”三步在提供有序牌表后已可用已合入原语完整执行（golden 经生产适配器真实运行），“your Main Deck”的查看者已按已合入写法绑定" +
    "（condition.value + linked-value，因 effect.inspect 的 argsSchema 仍把 object-property.object 当运行时 ObjectRef 校验，见 RIFT-64 与契约 3.6 的未对齐）。" +
    "整条能力仍不可执行的生产缺口：" +
    "① 有序 picksSpecId 没有生产生命周期：链的 Finalize 只锁定 instruction.targets 的 TargetSpec（chain/engine.ts assertFinalizationSurface），" +
    "没有把牌库顶两张解析成有序引用；缺该来源时 effect.inspect 的 top 作用域按 impossible 明确阻断（占位 pick 会静默变成看 0 张，故不写假占位）；" +
    "② “Put those you don't back in any order”（437.1.a）是对结算时才揭晓的“看过但未回收”集合做排序选择，而 effect.order 的非目标选择来自 Finalize 锁定的 PickSpec（359.3.e.9 重选），" +
    "只能排序指令已能命名的集合；本程序提供“看过的引用”，已回收者按陈旧引用丢弃（359.3.e.4），真正的“看过减已回收”余集仍不可表达；" +
    "③ conquer 时点已由 TurnFlow 的 Score 波真实发出（combat/flow.ts 提交 conquer），但没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-257 进行中）；" +
    "④ filter 的 here: true / player: controller 是同类战场卡占位（053.3 的 here 指代），已合入的 translateTriggerFilter/trigger-spec 不解析这两个键。" +
    "依赖：有序区域 picks 的 Finalize 生命周期、RIFT-257（卡牌触发绑定与 here 指代）。不近似实现。",
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
              options: ["dynamic:top-two-cards-of-your-main-deck-in-zone-order"],
              min: 0,
              max: 2,
              selection: "up-to",
              filter: { owner: "self", zone: "deck" }
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
