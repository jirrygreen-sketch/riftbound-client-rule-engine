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
    "缺「本回合你打出的下一个单位就绪进场」的延迟被动登记路径（392、143.4/359.2.c、805.6）：replacement.enter 仅由替代绑定器解析 with " +
    "体，不是启动能力 body 可调用的注册指令；缺一次性 next-unit-you-play 匹配、消费与回合到期窗口，registerDelayedTrigger " +
    "也不能替代此被动入场替代。Legion（812.1.b.1/812.1.c）仍缺声明式条件消费打出历史的路径：" +
    "HistoryQuery.exclude/objectFilter 与 condition.history 指令已合入，但当前 count 表达式只查询现存对象，不消费 " +
    "cards-finalized-this-turn subject；也不能将未绑定的 controller 当作历史玩家。cost.exhaust、程序绑定与关键词展开已合入，" +
    "横置费用有真实执行证据。不近似实现。",
  abilities,
  sourceText:
    ":rb_exhaust:: [Legion] — The next unit you play this turn enters ready. " +
    "(Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default program;
