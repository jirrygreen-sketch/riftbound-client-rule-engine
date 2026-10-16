import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Herald of the Emperor (rad-118-167) — Unit, 5 Energy, Might 3, Order.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-118-167，逐字）：
 *   "When you play me, choose a friendly unit. Its base Might becomes 5 this turn."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 / 383.4.a.2："When you play me" 是 Play Effect，在本单位
 *   完成打出并进场后进链；时点 card-played，filter 指向本卡（"me"）。
 * - 355.5 / 355.9.b："choose a friendly unit" 指玩家必须选定一个己方单位；这是
 *   "choose a [Game Object]" 的目标选择（355.7 / 383.4.b.3 说明 "choose" 措辞在
 *   触发条件里也指 Targeted），因此写成 TargetSpec（controller: "controller"），
 *   不是 pick。
 * - 143.2.a / 143.2.a.1（例）："Its base Might becomes 5 this turn" 改的是 Base
 *   Might —— Trait-Altering 图层的设值，不是「Increase its Might to 5」那种算术图层
 *   写法；475 / 479.2 定义图层顺序。
 * - "this turn" = end-of-turn 期限，由时点驱动的期限清理负责（契约 3.5）。

 * status = judge-required（README 第 2 节）。两处缺口，均不近似实现：
 * 1. 没有已注册的「把 Base Might 设为 N（本回合）」原语：effects/instructions/ 里
 *    continuous.might / continuous.duration 都不存在（RIFT-91 layers-continuous
 *    未合入），effect.buff 的边界注释明确临时 Might 修改归 layers；把 Base Might 当
 *    有效 Might 处理会改变 143.2.a.1 的三层语义（Trait-Altering vs Arithmetic）。
 * 2. card-played 触发没有已合入订阅方：events/ 的 EventPipeline 有 registerTrigger，
 *    但没有已合入模块把 CardProgram 的 triggered ability 转成 TriggerRegistration
 *    （scoring/、打出路径与 chain/events 单管线尚未接通，契约 §7.2 批 4/5）。
 * 下面保留有依据的形状：card-played 自发触发 + 目标式（己方单位）的
 * continuous.base-might 指令与本回合期限；golden 测试做结构断言并真实执行可用于
 * 对照的已合入原语路径，其余写 test.todo。
 * 依赖：RIFT-91（layers-continuous，Trait-Altering 的 Base Might 设值与期限）、
 * RIFT-120（chain/events 触发注册）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        // 143.2.a.1 / 475 / 479.2：Trait-Altering 图层的 Base Might 设值；
        // continuous.* 指令尚未注册（见 judgeReason 第 1 点），保留印刷语义。
        id: "herald.set-base-might",
        op: "continuous.base-might",
        args: {
          amount: { kind: "constant", value: 5 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "herald.friendly-unit" }
        },
        targets: [
          {
            id: "herald.friendly-unit",
            filter: { type: "unit", controller: "controller", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-f31c457784f7a2bda7271b96edb7702e948e7047187f0226e77144f06ba40ce1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 缺少「把 Base Might 设为 5（本回合）」的原语——effects/instructions/ 没有 " +
    "continuous.might / continuous.duration（RIFT-91 layers-continuous 未合入），effect.buff 明确不含临时 Might 修改，" +
    "把 Base Might（Trait-Altering，143.2.a.1/475/479.2）当成有效 Might 处理会改变分层语义；" +
    "(2) card-played 触发没有已合入订阅方：EventPipeline 有 registerTrigger，但没有模块把 CardProgram 的 triggered " +
    "ability 转成 TriggerRegistration（打出路径与 chain/events 单管线未接通，契约 §7.2 批 4/5）。已写出的形状：" +
    "card-played 自发触发 + 目标式（己方单位）continuous.base-might 指令 + this-turn 期限。" +
    "依赖：RIFT-91（layers-continuous 的 Base Might 设值与期限）、RIFT-120（chain/events 触发注册）。",
  abilities,
  sourceText: "When you play me, choose a friendly unit. Its base Might becomes 5 this turn."
} satisfies CardProgram;

