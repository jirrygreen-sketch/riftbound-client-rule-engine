import type { CardProgram } from "../../ir/index.js";

/**
 * Smite (unl-007-219) — Spell, 2 energy + 1 Fury power, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-007-219，逐字）：
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 3 to a unit at a battlefield. If it would die this turn, banish it instead.
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - “Deal 3 to a unit at a battlefield”：418.1 定义 Deal；355.10.b 明确 “at a battlefield”
 *   只是对单位的限制（目标是单位，不是战场）；355.9.a.1 的 “unit” 指 Board 上的单位，
 *   因此用一条带 location 过滤的 effect.damage + TargetSpec 声明，符合已合入 sfd/wages-of-pain /
 *   ogn/disintegrate 的写法（CR 418.6.a：未指定来源时来源即描述该效果的本卡）。
 * - “If it would die this turn, banish it instead”：369.1/370.1.b 的替代效果——把该单位
 *   本回合“将死”事件替换为放逐；“it”指前一指令选定的那个单位，不是新的选择
 *   （355.10.c.1 的正文内指代）。本卡按已经合入的 ogn/unlicensed-armory / ogn/highlander-yi 的
 *   同一形状，把替代写成 body 内的一条 replacement.event 指令，替代体用 effect.banish（428.1）。
 *
 * status = judge-required（缺口不近似实现）：
 * - replacement.event 的注册入口已合入，但它消费的是能力级 replacement 声明；本卡把声明放在
 *   play body 中，当前生产生命周期不会把它安装到 replacement registry。
 * - 替代体没有指向“被替代事件对象”的 ObjectSelector（该单位不是新目标选择，355.10.c.1），
 *   契约 3.1 的 replacement 能力也没有 duration 字段表达印刷的 “this turn” 窗口。
 * Deal 3 半段只用已合入的 effect.damage，放逐体只用已合入的 effect.banish；golden 用参考内核
 * 真实执行两条原语（含失效目标 ignored），替代的安装/生效留给上述依赖。
 */
const smite = {
  canonicalCardId: "card.hash-f2df74bd99eb5d2087462817264a1b9f0becc96353a67b98a7401ca7e5a5109a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「If it would die this turn, banish it instead」是替代效果（CR 369.1 / 370.1.b：把“将死”事件" +
    "替换为放逐），但本卡没有可执行路径：(1) replacement.event 的注册入口已合入，但当前 binder 只消费能力级 " +
    "replacement.with；本卡把它放在 play body，生产生命周期不会安装它；(2) 替代体无法绑定“被替代事件的对象" +
    "（355.10.c.1 的 it），ObjectSelector 只有 self/source/target/pick/linked；(3) 当前 replacement planner 不支持 " +
    "effect.banish，且 body 里的 this-turn 窗口没有进入 replacement binder 的 next-time-this-turn 语义。" +
    "Deal 3（effect.damage，418.1/355.10.b）与放逐体（effect.banish）本身已合入，但不构成整卡证据；不近似实现。",
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
          // （消费方未合入，见 judgeReason）。替代体里的 { target } 选择符指向同一 TargetSpec。
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
