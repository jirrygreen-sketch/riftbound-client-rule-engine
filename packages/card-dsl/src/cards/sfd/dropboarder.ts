import type { CardProgram } from "../../ir/index.js";

/**
 * Dropboarder (sfd-072-221) — Unit, Mind, Zaun.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-072-221，逐字）:
 *   "When you play me, if you control two or more gear, ready me."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"（383.4.a / 383.4.a.1、420.4.a）：Play Effect，在打出动作完成后进链；
 *   封闭时点 card-played，filter 用契约 3.6 的符号选择器 { source: "self" } 指称本卡。
 * - "if you control two or more gear"：383.2.a.1 规定紧跟在 Condition 之后的附加条件从句属于
 *   **Trigger Condition 本身**（不是 Effect），因此写在 TriggerSpec.condition 上，而不是 body
 *   里某条指令的 condition：条件不满足时整个触发不进链。
 * - 条件用 count + compare 表达：「你控制的 gear 数量 ≥ 2」；"you control" = 能力控制者
 *   （190.6.d），filter 的 controller 用 PlayerSelector "self"（chain/engine.ts 的
 *   Finalize/query 包装把它归一化为 item 的控制者）。gear 是 Board 上的永久物
 *   （355.9.a.1：未特别说明时 "gear" 指 Board 上的对象），故 zone: "board"。
 * - "ready me"（416.1）：{ kind: "source" } 缺省选择，交给已合入的 effect.ready 原语；
 *   单位在打出时横置入场（143.4），因此这是真实的「成为就绪」动作，不是入场替代。
 *
 * status 判定（cards/README.md 第 2 节）：executable。
 * effect.ready、count/compare 条件与 card-played 触发形状均已合入；golden 用
 * condition.predicate + 解释器真实求值触发条件（含 2 个/1 个/0 个 gear 与对手 gear 的边界），
 * 并用解释器 + 参考内核真实执行 "ready me" 的 body（RFC 416.1.b/c 的已就绪分支）。
 * 触发订阅进链的生产管线接线（TriggerSpec 的 source 锚点与事件词汇）与其它已合入触发卡一样
 * 记录为 test.todo（RIFT-120）。
 */
const abilities: CardProgram["abilities"] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "gear",
          filter: { type: "gear", controller: "self", zone: "board" }
        },
        operator: "gte",
        right: { kind: "constant", value: 2 }
      }
    },
    optional: false,
    body: [
      {
        id: "dropboarder.ready-me",
        op: "effect.ready",
        args: {}
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-cf5ebb526629cd42f5259346c00ea7f7b63c437d2818d06612a0ecedc887632d",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "When you play me, if you control two or more gear, ready me."
} satisfies CardProgram;
