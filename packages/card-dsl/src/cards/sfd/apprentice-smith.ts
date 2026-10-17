import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Apprentice Smith (sfd-041-221) — Unit, Calm, Freljord.
 * energy 2, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-041-221，逐字）:
 *   "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it."
 *
 * 规则依据（CR v1.5）:
 * - "When I move"（421.1、449.1/449.2、458/458.1）：封闭时点 object-moved 表示一次成功的
 *   Move，filter 用内层锚点 source: "self" 指称本卡（已合入 ogn/traveling-merchant 同型）。
 * - "reveal the top card of your Main Deck"（425.1/425.3.a）：reveal 把牌库顶的牌公开；
 *   契约 3.6 / picks/README.md 规定取牌库顶必须用 zoneSlice（query 不保证区域顺序，也不能
 *   用 set query 还原牌库）。已合入的有序 picks 生命周期（PickSpec.zoneSlice + ordered +
 *   selection: "all"）由链的 Finalize 在结算前锁定真实牌库顶引用，effect.reveal 经
 *   args.pick 读取该有序来源并链接实际展示的 ref 列表。
 * - "If it's a gear, draw it. Otherwise, recycle it."：分支判定可以真实求值——
 *   compare 的 in 运算符以标量 "gear" 测试链接指向的展示牌 types 数组（interpreter/expr.ts
 *   的 object-property 读该 ref 的当前特征；展示不换区，展示到本条指令之间没有其他结算，
 *   读到的是同一张牌）。draw 分支带该条件，recycle 分支带取反条件，因此不需要把分支判定
 *   交给玩家。旧写法（choice.mode 占位）已删除。
 *   「draw it」= 414.1 的「加入手牌」（把该张牌移入手牌，不是抽牌动作），走 effect.zone
 *   （to: "hand"）；该分支的选择是前序 reveal 的实际结果，按 picks/README.md 用
 *   linked 来源（options: [] + ordered + selection: "all"）绑定，解释器按结果顺序读，
 *   不重建缺失结果；「Otherwise, recycle it」= 417.1（回收 = 放到对应牌库底部），走
 *   effect.recycle。
 *
 * 当前复核：保持 judge-required；具体未接通路径见 judgeReason。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "apprentice-smith.reveal-top",
        op: "effect.reveal",
        args: {
          // 425.1/425.3.a：牌库顶由有序来源提供，reveal 只消费 pick 的实际结果。
          pick: { kind: "constant", value: "apprentice-smith.revealed-card" }
        },
        picks: [
          {
            id: "apprentice-smith.revealed-card",
            // 主牌库顶一张（保序）：Finalize 用 ctx.zoneSlice(controller, "deck", "top", 1)
            // 锁定真实牌库顶引用，绝不由 query 顺序推断（契约 3.6）。
            options: [],
            ordered: true,
            selection: "all",
            zoneSlice: {
              zone: "deck",
              from: "top",
              count: { kind: "constant", value: 1 }
            }
          }
        ]
      },
      {
        // 425.1 的展示结果 + 425.2 的分支：draw 分支只在该牌是 gear 时执行
        // （compare/in 以标量 "gear" 测试被展示牌的 types 数组）。
        id: "apprentice-smith.draw-it",
        op: "effect.zone",
        linkedTo: "apprentice-smith.reveal-top",
        condition: {
          kind: "compare",
          left: { kind: "constant", value: "gear" },
          operator: "in",
          right: {
            kind: "object-property",
            object: { linked: "apprentice-smith.reveal-top" },
            property: "types"
          }
        },
        args: {
          pick: { kind: "constant", value: "apprentice-smith.revealed-card-into-hand" },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        picks: [
          {
            id: "apprentice-smith.revealed-card-into-hand",
            // "it" = 前序 reveal 的实际展示结果（359.3.e.14）；linked 来源在 Resolve 读取
            // 该结果，顺序与引用按展示结果原样保留。
            options: [],
            ordered: true,
            selection: "all",
            linked: {
              kind: "linked-value",
              instructionId: "apprentice-smith.reveal-top",
              key: "revealed"
            }
          }
        ]
      },
      {
        // "Otherwise, recycle it."：取反条件，非 gear 时回收到牌库底（417.1）。
        id: "apprentice-smith.recycle-it",
        op: "effect.recycle",
        linkedTo: "apprentice-smith.reveal-top",
        condition: {
          kind: "not",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "gear" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { linked: "apprentice-smith.reveal-top" },
              property: "types"
            }
          }
        },
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "apprentice-smith.reveal-top",
            key: "revealed"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-3d95fd18b92dc4a0dc9393e066e851d61c9f5d05119ba24e56141fb10179c79f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "整卡只剩「When I move」触发注册这一处缺口：object-moved 已有动作生产者（events/action-adapter.ts 把 move-location 映射到该时点），" +
    "programs/filters.ts 也能把 source:self 翻译成 { event: \"object-moved\", object: { objectId } }，" +
    "但 events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 不含 object-moved，translateTriggerFilter 的结果过不了 validateTriggerSpec，" +
    "programs/triggers.ts 注册时（pipeline.registerTrigger）被拒绝，卡牌的触发无法挂上事件管线（421.1/449.1/458.1）。" +
    "「reveal the top card of your Main Deck」与两条分支已用已合入的有序 picks 生命周期真实执行（PickSpec.zoneSlice 由 Finalize 锁定牌库顶，linked 来源读 reveal 的实际结果），" +
    "不再是缺口。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it."
} satisfies CardProgram;

export default program;
