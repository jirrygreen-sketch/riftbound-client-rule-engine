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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 「the top card of your Main Deck」的有序读取仍未接入：契约 3.6 规定牌库顶须用 zoneSlice
 *   （query 不保证区域顺序），已合入的 effect.reveal 只经 ctx.query 读取区域、对非手牌区域的
 *   真子集直接拒绝（其文件头记录该缺口），因此多张牌库下无法保证取到的是牌库顶那张（RIFT-66）。
 * - object-moved 触发缺可判定载荷与注册路径：move-location 生成的事件不填 toZone/toKind，
 *   内层锚点 source: "self" 也没有消费方（events/pipeline-match.ts 只读 EventPattern 的
 *   object/source/target/player/fromZone/toZone/amount/details），且没有把 CardProgram 的
 *   triggered 能力注册进管线的订阅方（RIFT-257）。
 * 依赖：RIFT-66（zoneSlice 在展示类原语的落地）、RIFT-257（卡牌程序触发注册）。展示牌类型
 * 判定（原缺口）已用已合入的 compare/in 解决，golden 覆盖两个分支。不近似实现（不把牌库顶
 * 有序读取近似成 query 顺序，也不用直接改区域代替 effect.zone/recycle）。
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
    "「the top card of your Main Deck」的有序读取未接入：契约 3.6 规定牌库顶须用 zoneSlice" +
    "（query 不保证区域顺序），已合入的 effect.reveal 只经 ctx.query 读取区域、对非手牌区域的真子集直接拒绝" +
    "（其文件头记录该缺口），因此多张牌库下无法保证取到的是牌库顶那张（RIFT-66）。" +
    "object-moved 触发缺可判定载荷与注册路径：move-location 生成的事件不填 toZone/toKind，" +
    "内层锚点 source: \"self\" 也没有消费方（events/pipeline-match.ts 只读 EventPattern 的 " +
    "object/source/target/player/fromZone/toZone/amount/details），且没有把 CardProgram 的 triggered 能力" +
    "注册进管线的订阅方（RIFT-257）。旧缺口「If it's a gear」已解决：draw 分支带 compare/in 条件、" +
    "recycle 分支带取反条件，以展示牌的 types 数组真实求值，golden 覆盖两个分支；effect.zone（到 owner 手牌）" +
    "与 effect.recycle 已合入。不近似实现（不把牌库顶有序读取近似成 query 顺序）。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it."
} satisfies CardProgram;

export default program;
