import type { CardProgram } from "../../ir/index.js";

/**
 * Alpha Strike (unl-192-219) — Spell, 3 energy + 1 power, Calm/Body,
 * tags Master Yi / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-192-219，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "Choose a friendly unit. It deals damage equal to its Might split among enemy units at battlefields. "
 *   "Then for each unit this kills, do this: Gain 1 XP."
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806.1 / 806.1.b）是许可类关键词，卡牌只声明（契约 3.7）。
 * - "Choose a friendly unit"：具体对象选择（355.5 / 355.7），Board 单位在公开区域
 *   （355.9.a.1 / 355.10.a.1），因此是目标而不是 pick。CR 355.14.h.1 直接以本卡举例：
 *   该友方单位是“造成伤害的单位”，敌方单位才是分摊伤害的目标。
 * - "split among enemy units at battlefields"：355.14.a–g 的分摊——每个被选中的敌方单位
 *   都是目标（355.14.a），目标在 Finalize 选定（355.14.b），分摊数额到结算时才决定
 *   （355.14.e），每个目标必须收到 ≥1 的正整数伤害（355.14.f–g）。
 * - "It deals damage equal to its Might"：伤害来源是被选中的那个单位，数额在结算时读它的
 *   Might（418.6.b.3 的指定来源；143.2 的 Might 读取；359.3.f.1 的 referent）。
 * - "Then for each unit this kills, do this: Gain 1 XP"：CR 388（Reflexive Trigger）与
 *   429.5.d 的官方示例说明 "do this" 措辞表示反身触发——结算时把新能力作为链项加入链
 *   （389 / 389.1）；效果是每个被消灭单位获得 1 XP（730.1 的 Gain X XP）。
 *
 * status = judge-required（不近似实现）：
 * 1. 反身触发没有卡牌侧构造：IR 的六种 Ability 都不能表达"结算时把新能力作为链项加入链"
 *   （388 / 389），choice.optional 只在原地执行正文。
 * 2. "for each unit this kills" 没有可求值的按次计数：被本结算的伤害消灭属 Cleanup 的
 *   致命伤害被动死亡（429.1.a.2 / 429.4 / 323.4），不是 Kill Instruction，effect.kill 的
 *   killed 链接值不会被写入；仍缺本次伤害窗口的消灭计数与 429.5 归因。
 * 3. 355.14.h 在可用伤害少于目标数时，效果控制者重新裁撤目标的路径尚未接入 production chain adapter；
 *   参考内核可以验证已离开战场的目标被忽略，但不能证明完整的 Finalize/Resolve 重选流程。
 * 4. `chain/interpreter-adapter.ts` 的 LITERAL_FIELDS 尚未解码 `effect.damage` 的 literal divide
 *   标志，整个指令列表通过 production chain entry point 仍会被拒绝。
 * 依赖：反身触发与伤害→击杀归因/窗口、355.14.h 的目标重选管线，以及 divide literal 的 chain adapter 支持。
 *
 * 可执行部分：effect.damage 的 divide 形态（355.14.e 的结算期逐目标分配、355.14.f–g 的
 * 正整数约束）与"数额 = 被选友方单位的 Might、来源 = 该单位"的表达式，golden 用参考内核
 * 真实执行（含 359.3.e 的目标在结算前离开的边界）。
 */
export default {
  canonicalCardId: "card.hash-615c0725c9dee5568f8995d3c574c9270aea149c0f18dc1de8953693293494b2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入，均不近似实现：(1) “Then for each unit this kills, do this: Gain 1 XP” 是反身触发（CR 388、389 / 389.1；" +
    "429.5.d 的 “do this” 措辞正是反身触发的官方说明），结算时要把新能力作为链项加入链，" +
    "IR 的六种 Ability 与 choice.optional 都做不到。" +
    "(2) “for each unit this kills” 没有按本次结算/本次伤害的消灭计数：被本次伤害消灭属 Cleanup 的致命伤害被动死亡（429.1.a.2 / 429.4 / 323.4），" +
    "不是 Kill Instruction，effect.kill 的 killed 链接值不会被写入；仍缺本次伤害窗口的计数与 429.5/429.5.c 归因。" +
    "(3) 355.14.h 在可用伤害少于目标数时重选路径尚未接入 production chain adapter；参考内核只验证离场目标被忽略。" +
    "(4) chain/interpreter-adapter.ts 的 LITERAL_FIELDS 不解码 effect.damage 的 literal divide 标志，" +
    "因此完整指令列表不能通过 production chain entry point。" +
    "已合入并真实执行的部分：“Choose a friendly unit” 的目标声明（355.5 / 355.7 / 355.9.a.1）、" +
    "“It deals damage equal to its Might” 的数额与来源表达式（143.2 / 359.3.f.1 / 418.6.b.3）、" +
    "“split among … enemy units at battlefields” 的 divide 形态（355.14.a–g）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // “Choose a friendly unit. It deals damage equal to its Might split
          // among enemy units at battlefields.” 一条指令同时声明两个 TargetSpec：
          // 分摊目标（args.target 指向的敌方单位集合）与来源/数额所在的友方单位
          // （359.3.f.1 的 “it”）。
          id: "alpha-strike.deal-might-split",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "alpha-strike.friendly-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "alpha-strike.friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "alpha-strike.enemy-units" },
            // 355.14.e：分摊数额到结算时才由效果控制者决定。
            divide: { kind: "constant", value: true }
          },
          targets: [
            {
              id: "alpha-strike.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "alpha-strike.enemy-units",
              // “enemy units at battlefields”：每个被选中的敌方单位都是目标
              // （355.14.a），"at battlefields" 是它们的合法性限制（355.9.a.1、
              // 355.10.b：地点本身不被指定为目标）。
              filter: { type: "unit", controller: "opponent", location: "battlefield" },
              min: 1,
              max: null,
              selection: "any"
            }
          ]
        },
        {
          // “Then for each unit this kills, do this: Gain 1 XP.” 反身触发（388 /
          // 389.1）与按次击杀计数（429.1.a.2 / 429.4）两处缺口见 judgeReason；
          // XP 数额声明本次伤害的击杀计数链接，但该键目前没有生产者；这只是
          // 待接线的声明，不能代替反身触发。golden 只执行独立的 Gain 1 XP 子效果。
          id: "alpha-strike.gain-xp-per-kill",
          op: "effect.xp",
          linkedTo: "alpha-strike.deal-might-split",
          condition: {
            kind: "expression",
            value: {
              kind: "linked-value",
              instructionId: "alpha-strike.deal-might-split",
              key: "killed"
            }
          },
          args: {
            amount: {
              kind: "linked-value",
              instructionId: "alpha-strike.deal-might-split",
              key: "killedCount"
            },
            player: { kind: "constant", value: "controller" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a friendly unit. It deals damage equal to its Might split among enemy units at battlefields. " +
    "Then for each unit this kills, do this: Gain 1 XP."
} satisfies CardProgram;
