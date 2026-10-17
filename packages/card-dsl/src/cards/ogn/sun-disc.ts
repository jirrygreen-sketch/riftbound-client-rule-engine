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
 * status = judge-required（按当前已合入状态复核）：
 * - 指令注册表仍没有任何 opcode 消费 `ctx.registerDelayedTrigger`，RIFT-260 的
 *   replacement.enter 也只处理「已经登记到事件管线的入场移动」——把「本回合你打出的下一个单位」
 *   登记成入场替代的入口仍然缺失，且 RIFT-260 的 bindReplacement 只接受已在 body 里的
 *   with 体，没有可供卡牌数据使用的「下一个单位」窗口（RIFT-257 的程序绑定也未合入）；
 * - Legion 条件谓词依赖 812.1.c 的按卡身份排除（engine 的 HistoryQuery 目前只有
 *   scope/action/timingPoint/player/object，没有 exclude/objectFilter）与关键词展开接线。
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
    "缺「本回合你打出的下一个单位就绪进场」的登记路径：契约 3.6 的 ResolveContext 有 registerDelayedTrigger，" +
    "但指令注册表没有任何 opcode 消费它；RIFT-260 的 replacement.enter 只处理已登记到事件管线的入场移动，" +
    "且 bindReplacement 只吃 body 内的 with 体，没有卡牌数据可用的「下一个单位」窗口，RIFT-257 的 CardProgram 程序绑定也未合入。" +
    "（392 延迟被动能力、143.4/359.2.c 单位横置进场、805.6 就绪进场替代。）" +
    "Legion 条件还需要 812.1.c 的按卡身份排除：engine 的 HistoryQuery 只有 scope/action/timingPoint/player/object，" +
    "契约 3.8 的 exclude/objectFilter 未落地，关键词展开也没有运行时接线。" +
    "横置费用（cost.exhaust 费用计划）已可执行并有 golden。依赖：RIFT-257、RIFT-260 后续（延迟/入场替代窗口）、" +
    "HistoryQuery 消费方。不近似实现。",
  abilities,
  sourceText:
    ":rb_exhaust:: [Legion] — The next unit you play this turn enters ready. " +
    "(Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default program;
