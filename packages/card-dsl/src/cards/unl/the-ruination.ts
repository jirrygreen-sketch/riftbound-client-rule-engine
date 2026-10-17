import type { CardProgram } from "../../ir/index.js";

/**
 * The Ruination (unl-180-219) — Spell, 9 energy + 3 Order power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-180-219，逐字):
 *   Kill all units.
 *
 * 规则依据（CR v1.5）:
 * - 没有 [Action]/[Reaction] 印刷线：按 159.2.a 默认 Action 时机。
 * - 「Kill all units.」是 429.1.a.1.a 的消灭指令（Active Kill），但集合是
 *   355.10.d 的「按特征程序化选出」：该条规则的示例正是「Kill all units at
 *   battlefields」不指向任何目标，355.10.d.1 把该例外限定为「玩家从不做选择」的
 *   集合——「all units」没有任何选择步骤，因此不是 TargetSpec，也不得发出
 *   「成为目标」事件（355.7、754）。
 * - 429.6 的消灭格式与 178.3 确认受影响集合由特征决定（既是单位又是装备的对象
 *   同样受影响，本卡文本就是「all units」）。
 * - 消灭本身走 kill 行动（429.1/429.2.a），归因（429.5）与死亡时点由引擎处理。
 *
 * status: judge-required —— 缺无目标的 each/all 集合形态，复核实测确认该缺口仍在：
 * 已合入的 effect.kill 只能从 TargetSpec（ctx.targets）、PickSpec（ctx.picks）或来源自身
 * （self: true）解析对象（args 只接受 target/picks/self/count/reason；直接传 objects 会被
 * argsSchema 以 "effect.kill requires args.target, args.picks, or args.self: true" 拒绝）。
 * 用 selection: "all" 的 TargetSpec 会走目标锁定管线并发出 became-target 事件（与 355.10.d
 * 冲突），用 PickSpec 又要求控制者逐个选择（与 355.10.d.1 冲突），两者都不是如实编码。
 * effect.repeat 也不是替代方案：它的 action spec 只能读取 ctx.targets / ctx.picks 的
 * 已锁定引用，仍然要走同一条目标管线。故本文件把无目标集合查询记录成可审查的描述形状，
 * 整卡不宣称可执行；不近似实现。
 *
 * 依赖：effect.kill 增加可消费的无目标 each/all 集合选择；与 ogn-022-298
 * Thermo Beam「Kill all gear」是同一缺口。无契约变更请求。
 */
const program = {
  canonicalCardId: "card.hash-ba55ed991c377657c67727781733c33b7319e9f6e2abc066c541d2f9e83e7c5e",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Kill all units」是按特征程序化选出的集合（355.10.d：例「Kill all units at battlefields」不指向任何目标；" +
    "355.10.d.1 把该例外限定为玩家从不做选择的集合），但已合入的 effect.kill 只能从 TargetSpec（ctx.targets）、" +
    "PickSpec（ctx.picks）或来源自身（self: true）解析对象：argsSchema 只接受 target/picks/self/count/reason，" +
    "直接传 objects 会被拒绝（复核实测：effect.kill requires args.target, args.picks, or args.self: true）；用 selection: \"all\" 的 " +
    "TargetSpec 会走目标锁定管线并发出 became-target 事件（与 355.10.d 冲突），用 PickSpec 又要求控制者逐个选择（与 355.10.d.1 冲突）。" +
    "effect.repeat 同样不是替代路径——它的 action spec 只从 ctx.targets/ctx.picks 读取已锁定引用，仍走目标管线。" +
    "缺的是 effect.kill 可消费的无目标 each/all 集合选择（target.many 形态；与 ogn-022-298 Thermo Beam「Kill all gear」同一缺口）。" +
    "不近似实现，故本卡保持 judge-required。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 9 },
        power: { kind: "constant", value: 3 }
      },
      body: [
        {
          // 「Kill all units.」——无目标集合（355.10.d）：把特征查询记录成描述形状，
          // 已合入的 effect.kill 尚不能消费它（见 judgeReason）。
          id: "the-ruination.kill-all-units",
          op: "effect.kill",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "query", filter: { type: "unit", zone: "board" } }
            }
          }
        }
      ]
    }
  ],
  sourceText: "Kill all units."
} satisfies CardProgram;

export default program;

