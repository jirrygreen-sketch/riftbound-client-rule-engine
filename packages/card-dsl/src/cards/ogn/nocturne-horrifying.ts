import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Nocturne, Horrifying (ogn-194-298) — Unit, 4 energy + 1 Chaos power, 4 Might.
 *
 * Printed text (local deck-catalog, ogn-194-298):
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   When you look at cards from the top of your deck (and don't draw them) and
 *   see me, you may play me for :rb_rune_rainbow:.
 *
 * 规则依据（CR v1.5）：
 * - [Ganking]（810）是被动关键词，810.1.b 等价于“may move to a battlefield from another
 *   battlefield with a standard move”，810.1.c 只是增加许可，810.2 多实例冗余。
 *   `effects/keywords/Ganking.ts` 已合入（静态 `continuous.movement`），本卡只声明关键词。
 * - “look at cards from the top of your deck … and see me”：时点 `cards-looked-at`
 *   （128.4 / 383.2.c / 432.1.c）已在 events/timing-points.ts 定义；本卡在牌库顶被查看时
 *   给出的是一个“从秘密区域打出”的许可（128.3 秘密区域的牌不得被读取）。
 * - “you may play me for :rb_rune_rainbow:”：355.1（Finalize 前做出选择）、356.1.a
 *   （“play for [Cost]” 替换 Base Cost）、420.3（游戏效果指示的打出是 Limited Action）。
 *
 * 数据/规则不一致（**不改数据，只记录**）：官方 v1.5 规则 370.1.c.1 的示例把 Nocturne 的
 * 这段文本引为 “As you look at or reveal me from the top of your deck, you may banish me.
 * If you do, you may play me for [A].”，并明确说明它是**替代效果**（替换“被查看/被展示”
 * 事件本身，秘密区域里同时发生）；本地 deck-catalog 的 sourceText 只写
 * “When you look at … and see me, you may play me for :rb_rune_rainbow:.”——既没有
 * “reveal”，也没有 “banish me / If you do” 的部分，且用触发式措辞。两者不能同时成立，
 * 该文本冲突属需要裁定的问题，本程序不改写官方数据，只按本地 sourceText 逐字保留。
 *
 * status 判定（README 第 2 节）：judge-required。复核 RIFT-260 后缺的原语是：
 * 1. 从秘密区域（牌库顶被查看时）打出卡牌的许可与打出位置/合法性（420.3.b、355.2 默认
 *    只有手牌能被正常打出；`effect.play` 只接受由调用方给出的 finalized cost plan，
 *    没有任何“从牌库打出”的权限来源）；
 * 2. 替代费用 “for [A]” 的费用计划生成（356.1.a 把 Base Cost 替换为 1 点任意域 Power）：
 *    `cost.modify` 原语已经合入，但本卡仍缺把该替代费用写成可由 Finalize 消费的有效
 *    CostPlan，并把计划写进 `effect.play` 的链接值；
 * 3. 370.1.c.1 要求的“秘密区域内的替代效果与事件同时生效”的替代管线：RIFT-260 的
 *    replacement/ 已合入事件拦截与注册面（bindReplacement/replacement.event，可匹配
 *    card-revealed/ reveal 动作），但没有“被查看（look）”这一秘密区域事件的匹配
 *    （ACTION_KINDS 无 look），也没有 370.1.c.1 的同刻生效语义；且本卡的文字是触发式措辞（见冲突）；
 * 4. `cards-looked-at` 的秘密区域事件仍缺少把牌库顶对象作为本卡许可来源的生产接线。
 * 依赖：RIFT-260 后续的秘密区域替代事件与 look 事件的许可/位置适配，以及 370.1.c.1 文本的裁定。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "ganking"
  },
  {
    kind: "triggered",
    trigger: {
      at: "cards-looked-at",
      filter: { event: "cards-looked-at", object: { objectId: "self" } }
    },
    optional: false,
    body: [
      {
        // “you may play me for [A]”：接受与否是玩家的决定（355.1），按契约 3.9 用
        // choice.optional 把两条被选指令包进 body。
        id: "nocturne-horrifying.may-play",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Play me for :rb_rune_rainbow:?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "nocturne-horrifying.alternate-cost",
                op: "cost.modify",
                args: {
                  mode: { kind: "constant", value: "replace" },
                  // 356.1.a：“play me for [A]” 以 1 个任意域 Power 替换印刷费用。
                  resource: { kind: "constant", value: "power" },
                  amount: { kind: "constant", value: 1 },
                  domains: { kind: "constant", value: ["rainbow"] },
                  linkKey: { kind: "constant", value: "plan" }
                }
              },
              {
                id: "nocturne-horrifying.play-self",
                op: "effect.play",
                linkedTo: "nocturne-horrifying.alternate-cost",
                args: {
                  object: {
                    kind: "object-property",
                    object: "self",
                    property: "ref"
                  },
                  cost: {
                    kind: "linked-value",
                    instructionId: "nocturne-horrifying.alternate-cost",
                    key: "plan"
                  },
                  linkKey: { kind: "constant", value: "played" }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-2d8f25416970f68a17656a4ad7384628767cc23866a689af4b1999391a436411",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "仍不可执行，缺口不近似实现：(1) 文本/规则冲突——CR v1.5 370.1.c.1 把这段文本引为替代效果 “As you look at or " +
    "reveal me from the top of your deck, you may banish me. If you do, you may play me for [A].”，" +
    "而本地 sourceText 只有触发式 “look at … and see me, you may play me for :rb_rune_rainbow:.”；" +
    "(2) 缺生产接线——从被查看的牌库顶（秘密区域）打出卡牌的许可与位置校验，以及把已合入的 cost.modify " +
    "替代费用原语产出的有效 CostPlan 写入 effect.play（effect.play 只接受调用方给的 finalized plan）；" +
    "(3) RIFT-260 的 replacement/ 已合入通用事件拦截与注册面（bindReplacement/replacement.event，" +
    "可匹配 card-revealed/reveal），但没有「被查看（look）」秘密区域事件的匹配（ACTION_KINDS 无 look），" +
    "370.1.c.1 的同刻生效语义仍缺；" +
    "(4) cards-looked-at 仍缺秘密区域许可/位置适配，把被查看牌库顶对象作为本卡的事件接收者。" +
    "依赖：RIFT-260 后续秘密区域替代事件与 look 事件的许可适配、以及 370.1.c.1 文本的裁定。不近似实现。",
  abilities,
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When you look at cards from the top of your deck (and don't draw them) and see me, " +
    "you may play me for :rb_rune_rainbow:."
} satisfies CardProgram;

export default program;
