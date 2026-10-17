import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sun Disc (ogn-021-298) — Gear, 2 Energy + 1 Fury power, Fury.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-021-298):
 *   :rb_exhaust:: [Legion] — The next unit you play this turn enters ready.
 *   (Get the effect if you've played another card this turn.)
 *
 * 规则依据（CR v1.5）：
 * - “:rb_exhaust:: …” 是 Gear 的启动能力（151、151.2，Action 时机），费用是横置自身
 *   （415.3.a / 415.5）。
 * - “[Legion] —” 是依赖型关键词 Legion（812.1.a/b）：从关键词到子句结束的整句是该
 *   Legion 能力，条件为「你本回合已打出过另一张牌」（812.1.b.1 / 812.1.c）；条件门控
 *   本条能力，按 812.1.b.1 写成条件谓词（本回合打出计数、排除本卡自身）。
 * - “The next unit you play this turn enters ready.” 是延迟被动 / 入场状态改写
 *   （392 延迟能力、143.4 / 359.2.c 单位横置进场、805.6 的就绪进场替代）：需要为
 *   「本回合你打出的下一个单位」注册一个直到回合结束的入场替代。
 *
 * Status: judge-required.
 * Exhaust payment, program binding and history exclude/objectFilter are merged.
 * Still missing: an activated body that installs a one-use, this-turn delayed
 * entry replacement, and a Legion condition that actually consumes play history.
 * replacement.enter is a replacement-binding body shape, not a registered
 * instruction that installs the next-unit window.
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    timing: "action",
    body: [
      {
        id: "sun-disc.next-unit-ready",
        // “The next unit you play this turn enters ready.” — 延迟入场状态改写
        // （392 延迟被动能力 + 143.4 / 359.2.c 的单位进场状态）；消费方是入场替代管线
        // （replacement.enter），目前没有已注册原语（见 judgeReason）。
        op: "replacement.enter",
        args: {
          state: { kind: "constant", value: "ready" },
          duration: { kind: "constant", value: "end-of-turn" },
          appliesTo: { kind: "constant", value: "next-unit-you-play" }
        },
        // “[Legion] —” 门控本条能力（812.1.b.1）：本回合已打出另一张牌。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-b655d62fccecd79b856fc6c566229fc081413d7272a86745524d464c047c9356",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺启动能力登记一次性 next-unit-you-play 入场替代的指令及本回合匹配、消费、到期窗口（391.4/392、143.4/359.2.c、805.6）；" +
    "replacement.enter 仅用于 replacement.with，registerDelayedTrigger 只登记触发能力，不能在单位进场后才将其就绪。" +
    "Legion（812.1.b.1/812.1.c）仍缺声明式历史条件与当前控制者绑定：当前 count 只查询现存对象，忽略 " +
    "cards-finalized-this-turn subject；condition.history 的 query.player 是实际 PlayerId，不解析 controller。" +
    "关键词 condition.predicate 的 history/excluding 载荷也未被静态图层求值。不近似实现。",
  abilities,
  sourceText:
    ":rb_exhaust:: [Legion] — The next unit you play this turn enters ready. " +
    "(Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default program;
