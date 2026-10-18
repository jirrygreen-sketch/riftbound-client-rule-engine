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
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required。当前生产缺口：
 * 1. 事件名词汇：卡片 filter 的 `event: "cards-looked-at"` 经 translateTriggerFilter 原样保留，
 *    而 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭枚举（无该名称），
 *    validateTriggerSpec 实测返回 invalid-event-type，registerProgramTriggers 抛 TriggerSpecValidationError；
 * 2. `look` 动作的载荷是 `objects` 数组，events/action-adapter.ts 只取单个 `object`/`target`，
 *    实测 look 发射的 cards-looked-at 事件 `object` 为 null，嵌套 `{ object: { objectId: "self" } }`
 *    因此拿不到本卡身份（扁平 `objectId: "self"` 虽能被 translateTriggerFilter 绑定，但事件端没有对象可比）；
 * 3. 从秘密区域（牌库顶被查看时）打出卡牌的许可与位置/合法性（420.3.b、355.2）没有任何权限来源；
 * 4. 替代费用 “for [A]” 的费用计划生产接线（356.1.a）：`cost.modify` 原语能在 interpreter 里生成显式
 *    alternate CostPlan，但 chain/interpreter-adapter 的 LITERAL_FIELDS 没有解包 `id`/`cost`/`linkKey`，
 *    实测抛 "cost.modify id must be a non-empty string"；Finalize 也未把该计划接到从秘密区域打出的 effect.play；
 * 5. 370.1.c.1 的同刻生效语义：replacement/ 的通用事件拦截与注册面已合入，但 replacement/pattern.ts 的
 *    ACTION_KINDS 是封闭映射（无 look 动作）；且本卡的文字是触发式措辞（见文末冲突记录）。
 * 依赖：look 事件的注册词汇与 object 载荷、秘密区域打出许可、CardProgram→Finalize 的费用字面量解包，
 * 以及 370.1.c.1 文本的裁定。
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
                  // 356.1.a：“play me for [A]” 以一个六域均可支付的 Power
                  // CostSpec 替换印刷费用。cost.modify 的生产原语要求显式 id 与
                  // CostSpec；其字面量解包仍是当前 chain adapter 的缺口。
                  id: { kind: "constant", value: "nocturne-horrifying.alternate-cost" },
                  cost: {
                    kind: "constant",
                    value: {
                      payments: [
                        {
                          kind: "power",
                          amount: { kind: "constant", value: 1 },
                          allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
                        }
                      ]
                    }
                  },
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
    "仍不可执行，缺口按 2026-10-17 实测重列：(1) 文本/规则冲突——CR v1.5 370.1.c.1 把这段文本引为替代效果 " +
    "“As you look at or reveal me from the top of your deck, you may banish me. If you do, you may play me for [A].”，" +
    "而本地 sourceText 只有触发式 “look at … and see me, you may play me for :rb_rune_rainbow:.”，措辞不能同时成立，需裁定。" +
    "(2) 触发注册在第 4 点的事件名上失败：本卡 filter 的 event: \"cards-looked-at\" 被 translateTriggerFilter 保留，" +
    "events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭枚举（无该名称），validateTriggerSpec 实测返回 " +
    "trigger.filter.event/invalid-event-type，registerProgramTriggers 抛 TriggerSpecValidationError。" +
    "(3) 即使放行事件名，身份与载荷仍缺：look 动作（contract.ts）载荷是 objects 数组，" +
    "events/action-adapter.ts 只取单个 object/target，实测 look 发射的 cards-looked-at 事件 object 为 null，" +
    "所以嵌套 { object: { objectId: \"self\" } } 拿不到本卡身份（383.2.c / 432.1.c）；" +
    "换成扁平 objectId: \"self\" 虽能被 translateTriggerFilter 绑定为注册源对象，但事件端没有对象可比。" +
    "(4) 从被查看的牌库顶（秘密区域）打出卡牌的许可与位置校验没有生产来源（420.3.b / 355.2）；" +
    "chain/interpreter-adapter 的 LITERAL_FIELDS 也未解包 cost.modify 的 id/cost/linkKey，" +
    "按 CardProgram 运行实测在 “cost.modify id must be a non-empty string (or supply source)” 处失败，" +
    "即使补上也要把该 CostPlan 接到从秘密区域打出的 effect.play（effect.play 只接受调用方给的 finalized plan）。" +
    "(5) replacement/ 的通用事件拦截与注册面已合入，但 replacement/pattern.ts 的 ACTION_KINDS 是封闭映射" +
    "（只含 move-zone/kill/ready/exhaust/damage/score/play/reveal），没有 look 动作，370.1.c.1 的同刻生效语义仍缺。" +
    "依赖：look 事件的注册词汇与 object 载荷、秘密区域打出许可、CardProgram→Finalize 的费用字面量解包，以及 370.1.c.1 文本的裁定。不近似实现。",
  abilities,
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When you look at cards from the top of your deck (and don't draw them) and see me, " +
    "you may play me for :rb_rune_rainbow:."
} satisfies CardProgram;

export default program;
