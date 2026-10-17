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
 *   契约 3.6 规定取牌库顶必须用 zoneSlice（query 不保证区域顺序），但已合入的 effect.reveal
 *   只经 ctx.query 读取区域（文件头记录同一契约缺口：牌库顶 N 张必须由上游提供有序引用），
 *   因此这里写成 count: 1 的 reveal（结构正确），执行层缺口记录在 judgeReason。
 * - "If it's a gear, draw it. Otherwise, recycle it."：分支判定现在可以真实求值——
 *   compare 的 in 运算符以标量 "gear" 测试链接指向的展示牌 types 数组（effect.reveal 链接
 *   实际展示的 ref 列表，interpreter/expr.ts 的 object-property 读该 ref 的当前特征；
 *   展示不换区，展示到本条指令之间没有其他结算，读到的是同一张牌）。draw 分支带该条件，
 *   recycle 分支带取反条件，因此不需要把分支判定交给玩家。旧写法（choice.mode 占位）在
 *   本次复核中删除。
 *   「draw it」= 414.1 的「加入手牌」（把该张牌移入手牌，不是抽牌动作），走 effect.zone
 *   （to: "hand"）；「Otherwise, recycle it」= 417.1（回收 = 放到对应牌库底部），走
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
          zone: { kind: "constant", value: "deck" },
          count: { kind: "constant", value: 1 }
        }
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
          pick: { kind: "constant", value: "apprentice-smith.revealed-card" },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        picks: [
          {
            id: "apprentice-smith.revealed-card",
            options: [
              {
                kind: "linked-value",
                instructionId: "apprentice-smith.reveal-top",
                key: "revealed"
              }
            ],
            min: 1,
            max: 1,
            selection: "one"
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
    "“the top card of your Main Deck” 缺 effect.reveal 的有序 zoneSlice/pick 接线：该原语仍用 query 枚举，多张牌库取一张时拒绝真子集，不能保证牌库顶（425.1/425.3.a；RIFT-358 尚未合入当前 HEAD）。" +
    "object-moved 已有动作生产者和 programs/filters.ts 的 source:self 翻译，但 events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 不接受 object-moved，翻译后的事件过滤器无法注册。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it."
} satisfies CardProgram;

export default program;
