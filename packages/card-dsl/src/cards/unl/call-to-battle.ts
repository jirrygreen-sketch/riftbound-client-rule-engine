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
 * status = judge-required（2026-10-17 复核；缺口均不近似实现）：
 * - RIFT-357 的位置选择面已合入：指令可声明 LocationTargetSpec，`to` 用
 *   Expr.kind "location" + { kind: "target-location", target: <spec id> } 读取运行期选定的
 *   LocationRef；同一能力内后续指令重复引用同一 spec id 时复用第一次的绑定
 *   （解释器的 locations 作用域），因此 "the same battlefield" 不再缺结果选择器。
 *   实测两条 effect.move 共用同一绑定各自成功移动一次，产生两条 move-location。
 * - 仍缺（355.4.a / 190.4 / 190.6）：候选集合没有「排除被移动单位当前位置」谓词
 *   （chooseLocations 不注入 LocationCandidateOptions.exclude），也无法从战场控制状态
 *   枚举「你控制但当前没有单位的战场」：queryLocationCandidates 只把活动对象的地点与
 *   基地计入候选，战场控制本身没有可查询的生产状态。实测 type:"any" 的候选包含单位
 *   当前所在战场。
 * - 仍缺（355.7 / 355.9.a）："choose an opponent" 是玩家选择；target.player 没有
 *   已注册指令（registry.generated 中不存在），执行到该指令会抛
 *   Unregistered instruction opcode: target.player；"由该玩家来选" 的 chooser 绑定
 *   同样没有已合入路径（PickSpec 的 chooser 键不被解释器消费）。
 * 依赖：355.4.a 的当前位置排除谓词、战场控制的生产查询、target.player 与 chooser 绑定。
 */
const callToBattle = {
  canonicalCardId: "card.hash-1d05a8db288bc071a9e9736106ed0815284bac8ec41b7795f5d4b43e4a75217c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「to a battlefield you control」的候选集合仍不完整（355.4 / 355.4.a / 190.4 / 190.6）：" +
    "已按合入的 LocationTargetSpec + target-location 绑定在结算选择阶段取值，但候选集合没有排除被移动单位当前位置的谓词" +
    "（解释器 chooseLocations 不注入 LocationCandidateOptions.exclude），也无法从战场控制状态枚举「你控制但当前无单位的战场」" +
    "（queryLocationCandidates 只把活动对象的地点与基地计入候选）；实测 type:\"any\" 的候选包含单位当前所在战场。" +
    "(2)「choose an opponent」按 355.7/355.9.a 是玩家选择：target.player 没有已注册指令（执行的实测报 " +
    "Unregistered instruction opcode: target.player），ChoiceRequest 也没有玩家选择形态，PickSpec 的 chooser 绑定不被解释器消费。" +
    "已合入并已实测：RIFT-357 位置选择面（LocationTargetSpec + Expr.kind location）、两条 effect.move 复用同一战场绑定完成 " +
    "359.3.f.3 的「the same battlefield」（各自产生 move-location），以及被移动单位的目标声明。" +
    "依赖：355.4.a 的当前位置排除谓词、战场控制的生产查询、target.player 与 chooser 绑定。",
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
            // 355.4 / 355.4.a：目的地由控制者在结算选择阶段选定（"你控制的战场"）；
            // 候选集合来自本指令的 LocationTargetSpec（controller 绑定能力控制者）。
            // 355.4.a 的当前位置排除仍缺（见 judgeReason）。
            to: { kind: "location", value: { kind: "target-location", target: "call-to-battle.destination" } }
          },
          locations: [
            {
              id: "call-to-battle.destination",
              type: "battlefield",
              controller: "controller",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
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
          // "They move a unit they control to the same battlefield"：目的地复用第一条
          // 指令选定的同一 LocationSpec 绑定（359.3.f.3）；被移动单位与 chooser 仍依赖
          // 未合入的 target.player（见 judgeReason），此处保留形状。
          id: "call-to-battle.opponent-moves-unit",
          op: "effect.move",
          linkedTo: "call-to-battle.choose-opponent",
          args: {
            objects: { kind: "constant", value: { pick: "call-to-battle.opponent-unit" } },
            to: { kind: "location", value: { kind: "target-location", target: "call-to-battle.destination" } }
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
