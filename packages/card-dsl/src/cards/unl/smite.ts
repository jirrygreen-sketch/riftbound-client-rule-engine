import type { CardProgram } from "../../ir/index.js";

/**
 * Smite (unl-007-219) — Spell, 2 energy + 1 Fury power，Action。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-007-219，逐字）：
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 3 to a unit at a battlefield. If it would die this turn, banish it instead.
 *
 * 规则依据（CR v1.5）：
 * - "[Action]"：813.1.a / 813.1.b 的速度许可，声明为 keyword（spell 默认 Action，159.2.a）。
 * - "Deal 3 to a unit at a battlefield"：418.1 的 Deal；418.1 / 355.10.b 的 "unit" 指 Board 上的单位，
 *   "at a battlefield" 是目标限制，因此用一条带 location 过滤的 effect.damage + TargetSpec 声明
 *   （CR 418.6.a：未指定来源时来源即描述该效果的本卡）。
 * - "If it would die this turn, banish it instead"：369.1 / 370.1.b 的替代效果——把该单位
 *   本回合“将死”事件替换为放逐；"it" 指前一指令选定的那个单位，不是新的选择
 *   （355.10.c.1 的正文内指代）。替代写成 play body 内的 replacement.event 指令，
 *   替代体用 effect.banish（428.1）；replacement.event 原语（replacement/bind.ts、
 *   replacement/planner.ts）已合入。
 *
 * status = judge-required（2026-10-17 复核）：Deal 3 与放逐体本身已合入并有执行证据，
 * 但打印的死亡替代仍不可执行，当前缺口见 judgeReason（不近似实现）。
 */
const smite = {
  canonicalCardId: "card.hash-f2df74bd99eb5d2087462817264a1b9f0becc96353a67b98a7401ca7e5a5109a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "打印的死亡替代（CR 369.1 / 370.1.b）仍不可执行，三处当前缺口（均实测 fail-closed，不近似实现）：" +
    "(1) 结算期登记缺生产接线：replacement.event 原语已合入，但它调用 replacement/bind.ts 的 " +
    "replacementDependencies(ctx)，要求 ResolveContext 暴露 replacement/replacementDependencies（host + pipeline）；" +
    "ChainEngine.context 的 overrides 与 host.context（createActionPipelineHost）都不提供该字段，" +
    "结算本卡 body 会抛 \"replacement instruction requires ResolveContext.replacement dependencies (host + pipeline)\"。" +
    "(2) 被替代事件的对象绑定缺 Finalize 适配器：replacement.event 的 args.object 直接抛 " +
    "\"replacement.event object binding needs a Finalize target adapter; it is not approximated\"，" +
    "因此 355.10.c.1 的 \"it\"（已被选定的单位）无法作为对象绑定；planner 只解析 { linked: \"replacement.object\" } 与 self/source。" +
    "(3) 替代体不可规划：replacement/planner.ts 没有 effect.banish 分支（实测抛 " +
    "\"Unsupported replacement opcode: effect.banish\"），且嵌套的 { target: \"smite.unit\" } 没有结算期绑定通道。" +
    "duration 形状（window this-turn）只在 (1) 的生产接线上才生效；替代体里的 effect.banish 本身已合入（428.1，golden 实证）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "smite.deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "smite.unit" }
          },
          targets: [
            {
              id: "smite.unit",
              // “a unit at a battlefield”：单位是目标，“at a battlefield” 是目标限制（355.10.b）。
              filter: { type: "unit", zone: "board", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “If it would die this turn, banish it instead”：延迟替代的声明形状
          // （结算期登记与对象绑定未合入，见 judgeReason）。替代体里的 { target } 选择符指向同一 TargetSpec。
          id: "smite.banish-instead",
          op: "replacement.event",
          args: {
            event: { kind: "constant", value: "object-killed" },
            window: { kind: "constant", value: "this-turn" },
            object: { kind: "constant", value: { target: "smite.unit" } },
            instead: {
              kind: "constant",
              value: [
                {
                  id: "smite.banish",
                  op: "effect.banish",
                  // 嵌套在 constant 里的指令沿用同一 Expr 约定：对象选择符写在
                  // { kind: "constant", value: { target } } 里（对照 ogn/unlicensed-armory）。
                  args: {
                    objects: { kind: "constant", value: { target: "smite.unit" } }
                  }
                }
              ]
            }
          },
          targets: [
            {
              id: "smite.unit",
              filter: { type: "unit", zone: "board", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. If it would die this turn, banish it instead."
} satisfies CardProgram;

export default smite;
