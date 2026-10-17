import type { CardProgram } from "../../ir/index.js";

/**
 * Call to Battle (unl-101-219) — Spell, 3 energy, no printed power, no Might,
 * Body.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-101-219，逐字）：
 *   "Move a unit you control to a battlefield you control. Then, choose an
 *    opponent. They move a unit they control to the same battlefield."
 *
 * 规则依据（CR v1.5）：
 * - 「Move a unit you control」：被移动的己方单位由玩家选择（355.5），是目标
 *   （355.7 / 355.9.a.1）；0 效果的移动不是 Standard Move（144）、也不是 Recall
 *   （457），用已合入的 effect.move（451）。
 * - 「to a battlefield you control」：目的地按 355.4 在 Finalize 选择，合法地点
 *   是「你控制且该单位可存在」的战场（355.4.a、451.1）；实现上是运行期 Location
 *   选择，静态 IR 无法列举（同 ride-the-wind 的缺口）。
 * - 「Then, choose an opponent」：355.7 / 355.9.a 把"玩家"列为可选目标；契约
 *   3.6 的 targets() 只返回 ObjectRef[]，没有玩家目标形状，也不能把玩家 id 传进
 *   后续指令的 player 实参（同 suave-negotiator / sabotage 的缺口）。
 * - 「They move a unit they control to the same battlefield」：第二个移动由所选
 *   对手决定，其 chooser/target 都是那名玩家（355.10.e：由其他玩家参与选定的集合
 *   不是目标），目的地与第一条移动相同（359.3.f.3 的结果绑定）。
 *
 * status = judge-required（RIFT-329 复核；三处缺口均不近似实现）：
 * - 运行期 Location 选择仍缺失：effect.move 的 to 只接受字面 LocationRef、
 *   "controller-base" 或字面 LocationRef 候选列表；把运行期才成立的
 *   "battlefields you control" 写成 { kind: "choose", options: [...] } 会在
 *   argsSchema 阶段被拒（RIFT-90/RIFT-91 的地点选择生命周期）。
 * - 玩家目标/选择仍缺失：ChoiceRequest 只有 optional/mode/select-objects/order/number，
 *   没有玩家选择；target.player 也没有指令文件，"对手集合"的解析、锁定与
 *   "由该玩家来选"的 chooser 绑定没有已合入路径。
 * - "the same battlefield" 的结果绑定不可用：effect.move 只把整份回执写进
 *   <linkKey>（默认 "moved"），解释器的 linked-value 逐字按 `<id>.<key>` 取值，
 *   既不支持 `movements.0.to` 这样的路径，回执本身也不是 LocationRef
 *   （把它当 to 传入会被原语拒绝，文件内的链接键只是保留形状）。
 * 依赖：运行期 Location 选择与结果绑定（RIFT-90/RIFT-91 后续）、玩家目标/选择（target.player）。
 */
const callToBattle = {
  canonicalCardId: "card.hash-1d05a8db288bc071a9e9736106ed0815284bac8ec41b7795f5d4b43e4a75217c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「to a battlefield you control」是 CR 355.4/355.4.a 的 Finalize 目的地选择，" +
    "合法地点取决于运行时战场控制状态；effect.move 的 to 只接受字面 LocationRef、controller-base 或字面 LocationRef 候选列表，" +
    "写成 { kind: \"choose\", options: [...] } 会在 argsSchema 阶段被拒（依赖 RIFT-90/RIFT-91 的地点选择生命周期）。" +
    "(2)「choose an opponent」按 CR 355.7/355.9.a 是玩家选择，但 ChoiceRequest 只有 optional/mode/select-objects/order/number，" +
    "没有玩家选择；target.player 也没有已注册指令文件，对手集合的解析、锁定与 chooser 绑定没有路径。" +
    "(3)「They move a unit they control to the same battlefield」的 359.3.f.3 结果绑定不可用：effect.move 只把整份回执写进 " +
    "<linkKey>，解释器的 linked-value 逐字按 <id>.<key> 取值（不支持 movements.0.to 这样的路径），回执本身也不是 LocationRef。" +
    "依赖：运行期 Location 选择与结果绑定（RIFT-90/RIFT-91 后续）、玩家目标/选择（target.player）。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "call-to-battle.move-own-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "call-to-battle.friendly-unit" }
            },
            // 355.4 / 355.4.a：目的地由控制者在 Finalize 选择（"你控制的战场"）。
            to: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "call-to-battle.destination",
                options: ["battlefields-you-control"]
              }
            }
          },
          targets: [
            {
              id: "call-to-battle.friendly-unit",
              filter: { zone: "board", type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 未注册 op："choose an opponent" 的玩家目标/选择形状（见 judgeReason）。
          id: "call-to-battle.choose-opponent",
          op: "target.player",
          args: {
            filter: { kind: "constant", value: { player: "opponent" } },
            linkKey: { kind: "constant", value: "chosen-opponent" }
          }
        },
        {
          // "They move a unit they control to the same battlefield"：移动的
          // objects（他们控制的单位）、chooser（所选对手）与目的地（同一战场）
          // 都需要未合入的绑定（见 judgeReason）；此处保留形状。
          id: "call-to-battle.opponent-moves-unit",
          op: "effect.move",
          linkedTo: "call-to-battle.choose-opponent",
          args: {
            objects: { kind: "constant", value: { pick: "call-to-battle.opponent-unit" } },
            to: {
              kind: "linked-value",
              instructionId: "call-to-battle.move-own-unit",
              key: "movements.0.to"
            }
          },
          picks: [
            {
              id: "call-to-battle.opponent-unit",
              options: ["dynamic:units-controlled-by-the-chosen-opponent"],
              filter: { zone: "board", type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one",
              chooser: "call-to-battle.chosen-opponent"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Move a unit you control to a battlefield you control. Then, choose an opponent. " +
    "They move a unit they control to the same battlefield."
} satisfies CardProgram;

export default callToBattle;
