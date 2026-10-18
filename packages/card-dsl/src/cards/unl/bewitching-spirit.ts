import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bewitching Spirit — CR v1.5 383.4.a (Play Effect), 355.7/355.9.a
 * (player target), 423.1/423.1.a/423.4 (chosen player discards).
 * Trigger registration and discard exist; the player-target contract and
 * binding remain incomplete. Unprinted energy/power values remain null.
 *
 * 复核后的真实缺口：355.7 的「choose a player」是玩家目标（355.9.a 允许玩家作为目标），
 * 但契约 3.6 的 TargetSpec 与 ResolveContext.targets() 只承载 ObjectRef[]，
 * ChoiceRequest 也只有 optional/mode/select-objects/order/number 五种形状，没有
 * 玩家目标请求。因此无法在 Finalize 锁定一名当前对局玩家并把它绑定到
 * effect.discard.player；`target.player` 不是已注册指令（实测解释器抛
 * Unregistered instruction opcode），本程序只保留该占位以记录印刷语义，
 * 不能以固定座位、所有玩家或静态 PickSpec.options 代替。card-played 触发绑定、
 * effect.discard 与链接值读取均已合入（golden 用真实原语执行）。
 *
 * 第三轮复核：RIFT-359 新增的是事件/结果谓词（played-from-hand、event-printed、
 * result），与本卡的玩家目标无关；RIFT-360 新增的是目标税成本计划，同样不提供
 * 玩家选择请求。玩家目标契约与结果绑定仍是唯一缺口。
 */
const chosenPlayer = "bewitching-spirit.chosen-player";

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        // 355.7 / 355.9.a：选出一名具体玩家 = 玩家目标。契约 3.6 的 targets() 只有
        // ObjectRef[]，没有玩家形状，故用 target.player 占位（注册表无该 op）。
        id: "bewitching-spirit.choose-player",
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          // 选项集合是当前所有玩家；静态 IR 无法列出玩家 id，由选择管线解析。
          options: { kind: "constant", value: "dynamic:players" },
          linkKey: { kind: "constant", value: "chosenPlayer" }
        }
      },
      {
        // "They discard 1"：423.1/423.1.a/423.4，弃牌者是被选中的那名玩家。
        id: "bewitching-spirit.chosen-discards-1",
        op: "effect.discard",
        linkedTo: "bewitching-spirit.choose-player",
        args: {
          amount: { kind: "constant", value: 1 },
          player: {
            kind: "linked-value",
            instructionId: "bewitching-spirit.choose-player",
            key: "chosenPlayer"
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-50e54034f879028f4935bc194153081e4d10c422fae37e9dc5706755d4ecd302",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 355.7/355.9.a）：「choose a player」需要在 Finalize 锁定当前对局的一名玩家并把结果绑定到 effect.discard.player；" +
    "现有 TargetSpec 与 ResolveContext.targets() 只承载 ObjectRef[]，ChoiceRequest 的封闭集合（optional/mode/select-objects/order/number）没有玩家目标请求，" +
    "解释器对 target.player 抛 Unregistered instruction opcode（golden 已实证）。不能以固定座位、所有玩家或静态 PickSpec.options 代替该玩家目标。" +
    "card-played 触发绑定、effect.discard 与 linked-value 读取已合入，golden 用真实原语执行弃牌（含空手 impossible 分支）；" +
    "RIFT-359（事件/结果谓词）与 RIFT-360（目标税成本计划）都不提供玩家选择请求，故仍需上游扩展玩家目标契约及其结果绑定。",
  abilities,
  sourceText: "When you play me, choose a player. They discard 1."
} satisfies CardProgram;
