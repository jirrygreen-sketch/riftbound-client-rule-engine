import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Firebrand Raider (rad-019-167) — Unit, Fury, 6 energy / 1 power / 6 Might.
 *
 * 原文（deck-catalog rad-019-167，逐字）：
 *   "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\n" +
 *   "Units don't ready during the Awaken Phase."
 *
 * 规则依据（CR v1.5）：
 * - “I enter ready.”：143.4 默认横置进场 + 369.3 入场替代（同 rad-009-167）；
 * - “When you play me, ready all enemy units.”：Play Effect（383.4.a）+ 非目标集合重置
 *   （355.10.d “all …”，effect.ready 的 query 选择；敌方单位由 filter controller: opponent）；
 * - “Other units enter ready.”：对场上其他单位的入场替代（365.1 持续能力只在 Board 生效）；
 * - “Units don't ready during the Awaken Phase.”：Awaken 阶段常规重置（315.1.b）的静态限制，
 *   属 continuous.restrict（effect.ready 文件明确本原语不实现该限制）。
 *
 * status: judge-required（不近似实现）：
 * - 两处 “enter ready” 都依赖入场替代管线（replacement.enter），未合入；
 * - Awaken 阶段的就绪限制没有已注册的 continuous.restrict 消费者（图层/回合阶段接线未完成）；
 * - “ready all enemy units” 本身已可执行（effect.ready + query），golden 测试真实执行该指令。
 *
 * 依赖：RIFT-83/RIFT-84（replacement.enter）、RIFT-91（layers/continuous.restrict）与回合
 * 阶段接线（315.1.b）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
    with: [{ id: "firebrand-raider.enter-ready", op: "effect.ready", args: {} }]
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "firebrand-raider.ready-enemy-units",
        op: "effect.ready",
        args: {
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: { zone: "board", type: "unit", controller: "opponent" }
            }
          }
        }
      }
    ]
  },
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { type: "unit", other: true, exhausted: true } },
    with: [{ id: "firebrand-raider.others-enter-ready", op: "effect.ready", args: {} }]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      mode: "prevent",
      event: "ready",
      during: "awaken-phase",
      filter: { zone: "board", type: "unit" }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-f4847d9fdb97d7ccf7a9d4a296e64e63e5d8c219daa10d1016d79ae12591dc77",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三个缺口：(1) “I enter ready.” 与 “Other units enter ready.” 都是入场替代（143.4 + 369.3；" +
    "365.1），replacement.enter 管线未合入（依赖 RIFT-83/RIFT-84），effect.ready 不能事后模拟；" +
    "(2) “Units don't ready during the Awaken Phase.” 是 Awaken 阶段常规重置（315.1.b）的静态" +
    "限制，没有已注册的 continuous.restrict 消费者/阶段接线（依赖 RIFT-91 与回合阶段）。" +
    "“When you play me, ready all enemy units.” 已用 effect.ready + 非目标 query（355.10.d）声明，" +
    "并在 golden 测试真实执行。不近似实现。",
  abilities,
  sourceText:
    "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\n" +
    "Units don't ready during the Awaken Phase."
} satisfies CardProgram;

export default program;
