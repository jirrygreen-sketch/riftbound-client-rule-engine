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
 * - "If it's a gear, draw it. Otherwise, recycle it."：分支判定读的**不是**当时牌面的特征，
 *   而是展示那一刻锁定的结果（契约 3.4 的 Show Off 口径：展示时把被引用的特征值锁定进链接值），
 *   即「展示时是不是 gear」；现有 Condition 只有 eq/ne/lt/lte/gt/gte/in，没有数组包含
 *   （types 数组无法判 "gear"），effect.reveal 也只链接 ref 列表、不落类型快照。
 *   因此这里用 choice.mode 保留两个分支的完整形状（与已合入 sfd/ravenbloom-conservatory 的
 *   "If it's a spell … Otherwise …" 同一占位写法），**不是**把分支判定交给玩家：真正的分支
 *   判别器（展示快照 + 数组包含）缺失，整卡据此保持 judge-required。
 *   「draw it」= 414.1 的「加入手牌」（把该张牌移入手牌，不是抽牌动作），走 effect.zone
 *   （to: "hand"）；「Otherwise, recycle it」= 417.1（回收 = 放到对应牌库底部），走
 *   effect.recycle。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 分支判定缺可求值形态（数组包含 / 展示快照）；牌库顶的有序读取（zoneSlice）也未接入
 *   effect.reveal（RIFT-66 契约变更只定义了 zoneSlice，reveal 文件头记录其未消费）。
 * - object-moved 触发缺可判定载荷（toZone/toKind 未填、内层锚点无消费方）。
 * 依赖：RIFT-66（zoneSlice 在展示类原语的落地）、数组包含/展示快照条件、RIFT-120（移动时点
 * 载荷与卡牌触发注册）。不近似实现（不把「是装备」近似成其它谓词，也不用直接改区域代替
 * effect.zone/recycle）。
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
        id: "apprentice-smith.mode",
        op: "choice.mode",
        linkedTo: "apprentice-smith.reveal-top",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "apprentice-smith.gear-mode",
                body: [
                  {
                    id: "apprentice-smith.draw-it",
                    op: "effect.zone",
                    linkedTo: "apprentice-smith.reveal-top",
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
                  }
                ]
              },
              {
                id: "apprentice-smith.other-mode",
                body: [
                  {
                    id: "apprentice-smith.recycle-it",
                    op: "effect.recycle",
                    linkedTo: "apprentice-smith.reveal-top",
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
            ]
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
    "分支判定「If it's a gear」缺可求值形态：Condition 只有 eq/ne/lt/lte/gt/gte/in（in 判左值是否属于右数组），" +
    "无法表达「展示锁定的卡类型含 gear」（契约 3.4 的 Show Off 口径要求锁定展示时的特征值），" +
    "effect.reveal 也只链接 ref 列表、不落类型快照。" +
    "另外「the top card of your Main Deck」的有序读取未接入：契约 3.6 规定牌库顶须用 zoneSlice（query 不保证区域顺序），" +
    "但已合入的 effect.reveal 只经 ctx.query 读取区域（其文件头记录该缺口），因此无法保证取到的是牌库顶那张。" +
    "object-moved 触发同样缺可判定载荷：move-location 生成的事件不填 toZone/toKind，内层锚点 source: \"self\" 也没有消费方" +
    "（events/pipeline-match.ts 只读 EventPattern 的 object/source/target/player/fromZone/toZone/amount/details）。" +
    "effect.zone（到 owner 手牌）与 effect.recycle 本身已合入。" +
    "依赖：RIFT-66（zoneSlice 在展示类原语的落地）、数组包含/展示快照条件、RIFT-120（移动时点载荷与卡牌触发注册）。不近似实现。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it."
} satisfies CardProgram;

export default program;
