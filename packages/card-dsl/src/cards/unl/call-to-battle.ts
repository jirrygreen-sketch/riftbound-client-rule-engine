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
 * status = judge-required（不近似实现）：
 * - 缺运行期 Location 选择：effect.move 的 to 只接受静态 LocationRef /
 *   controller-base / 静态候选列表，"a battlefield you control" 需要按控制状态在
 *   合法战场里筛选取一（355.4 / 355.4.a），本程序以描述性目的地标记保留形状
 *   （依赖 RIFT-90 / RIFT-91）。
 * - 缺玩家目标/选择：choice 请求没有选择玩家的类型，ctx.picks 虽允许 PlayerId，
 *   但"对手集合"的解析与锁定、以及把该玩家绑定为第二条移动的 chooser 都没有
 *   已合入路径（依赖 target.player）。
 * - 第二条移动's chooser 与目标应由所选对手决定，单一 ResolveContext 无法表达
 *   按玩家绑定的选择；"the same battlefield" 需要第一条移动的目的地结果绑定，
 *   也没有可用的地点选择器。
 * 依赖：运行期 Location 选择（RIFT-90/RIFT-91）、玩家目标/选择（target.player）。
 */
const callToBattle = {
  canonicalCardId: "card.hash-1d05a8db288bc071a9e9736106ed0815284bac8ec41b7795f5d4b43e4a75217c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1)「to a battlefield you control」是 CR 355.4/355.4.a 的 Finalize 目的地选择，" +
    "合法地点取决于运行时战场控制状态；effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表，" +
    "本卡以描述性目的地标记保留形状（依赖 RIFT-90/RIFT-91）。(2)「choose an opponent」按 CR 355.7/355.9.a 是玩家选择，" +
    "但契约 3.6 的 targets() 只返回 ObjectRef[]，ChoiceRequest 也没有选择玩家的类型（同 suave-negotiator、sabotage 的缺口），" +
    "对手集合的解析与锁定没有已合入路径。(3)「They move a unit they control to the same battlefield」需要把所选玩家绑定为" +
    "第二条移动的 chooser/控制者，并绑定与第一条相同的运行时目的地（359.3.f.3 的结果引用），两者都没有可用的选择器；" +
    "依赖 target.player 与 RIFT-90 的地点选择生命周期。",
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
