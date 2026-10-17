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
 * Firebrand Raider — CR v1.5 369.3 (entry replacements), 383.4.a (play effect),
 * 355.10.d (non-target “all”), 315.1.b (Awaken readiness).
 * Self entry and readying enemy units have partial execution evidence.
 * Other-unit entry and the Awaken-only prohibition remain blocked; see judgeReason.
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // 143.4 / 359.2.c：默认横置进场；369.3 的入场状态改写。
    replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
    // RIFT-260 的 entry-orientation 形式：单一 self 目标的 effect.ready，由绑定层
    // 改写成“就绪进场”（不产生 object-readied 时点，805.6.a）。
    with: [
      {
        id: "firebrand-raider.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
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
    // 365.1 的持续能力：其他单位横置进场时改写为就绪进场。替代体必须指向
    // “被替代事件的对象”，合并 IR 的选择器词汇（self/source/target/pick/linked）
    // 没有该指代，绑定层的 replacement.object 链接值也只有经 replacement.event
    // 声明才可用（本卡的静态 replaces 形式拿不到）；故只保留可审查形状。
    replaces: { event: "object-enters-board", filter: { type: "unit", other: true, exhausted: true } },
    with: [
      {
        id: "firebrand-raider.others-enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "linked", key: "replacement.object" } } }
      }
    ]
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
    "CR 369.3 / 370.1.b.1：“Other units enter ready”缺其他入场对象的朝向替代绑定；replacement/bind.ts 把单条 effect.ready 的 constant linked replacement.object 当作入场声明在 bind 时求值并拒绝，replacement.enter 又只绑定宿主。replacement.event 的 args.instead 只读裸指令数组，与 IR 的 Expr 参数冲突。CR 315.1.b：“Units don't ready during the Awaken Phase”缺阶段限制消费；turn/flow.ts 的 Awaken 就绪任务未查询 continuous.restrict，静态登记本身也需保留 during: awaken-phase 的适用范围，不能变成全时段禁止就绪。",
  abilities,
  sourceText:
    "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\n" +
    "Units don't ready during the Awaken Phase."
} satisfies CardProgram;

export default program;
