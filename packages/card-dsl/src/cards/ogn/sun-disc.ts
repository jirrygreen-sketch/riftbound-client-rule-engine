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
 * status = judge-required：
 * - 已合入的指令原语里没有任何一个消费 `ctx.registerDelayedTrigger` 或注册入场替代
 *   （effects/instructions/ 下没有对应实现），也没有 entry-ready 替代的消费者，因此延迟的
 *   「下一个单位就绪进场」无法登记；
 * - Legion 条件谓词依赖 812.1.c 的按卡身份排除（engine 的 HistoryQuery 目前只有
 *   scope/action/timingPoint/player/object，没有 excluding）与关键词展开接线。
 * 横置费用本身用已合入的 cost.exhaust 费用计划，golden 测试真实执行费用收取。
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
    "缺延迟入场替代登记原语：契约 3.6 的 ResolveContext 有 registerDelayedTrigger，但 " +
    "effects/instructions/ 下没有任何已注册原语消费它，也没有 entry-ready 入场替代 " +
    "(replacement.enter) 的消费者，因此「本回合你打出的下一个单位就绪进场」无法登记" +
    "（392 延迟被动能力、143.4 / 359.2.c 单位横置进场、805.6 就绪进场替代）；Legion 条件" +
    "还需要 812.1.c 的按卡身份排除（engine 的 HistoryQuery 只有 scope/action/timingPoint/" +
    "player/object，没有 excluding）与关键词展开接线。依赖：RIFT-120（替代注册管线）、" +
    "RIFT-82（kw-deathknell-legion）、RIFT-89（条件历史查询扩展）。不近似实现。",
  abilities,
  sourceText:
    ":rb_exhaust:: [Legion] — The next unit you play this turn enters ready. " +
    "(Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default program;
