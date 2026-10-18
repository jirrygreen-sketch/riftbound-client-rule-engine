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
 *   Might —— 479.2 的 Trait-Altering 图层设值，不是 479.4 算术图层的
 *   "Increase its Might to 5"；475 / 479.2 定义图层顺序。
 * - "this turn" = end-of-turn 期限，由时点驱动的期限清理负责（契约 3.5）。

 * status = judge-required（README 第 2 节，2026-10-17 复核）。缺口：
 * 1. 没有已注册的「把 Base Might 设为 N（本回合）」原语：instructionDefinitionsById
 *    没有 continuous.base-might，continuous.might 的 argsSchema 也拒绝显式 `layer` 参数；
 *    该原语无论 mode "add" 还是 "set" 都注册 layer: "arithmetic" 的效果
 *    （mode "set" 写 kind "set-might"，engine.ts 的 applyArithmetic 消费），
 *    仍是 479.4 的算术图层。trait 图层本身已有 set-property(might) 消费
 *    （实测可设值并在回合末到期），缺的只是从卡牌指令注册到该层的入口，
 *    把 Base Might 当有效 Might 处理会改变 143.2.a.1 与 479.2/479.4 的分层语义。
 * 下面保留有依据的形状：card-played 自发触发 + 目标式（己方单位）的
 * continuous.base-might 指令与本回合期限；golden 测试做结构断言，并单独用已合入原语
 * 做对照执行（continuous.might 的 arithmetic 设值真实生效、并在回合末到期），
 * 不把它当作本卡的 Base Might 语义。
 * 依赖：Trait-Altering 图层的 Base Might 设值原语（指令注册 + 参数形状）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        // 143.2.a.1 / 475 / 479.2：Trait-Altering 图层的 Base Might 设值；
        // 该图层的指令原语尚未注册（见 judgeReason 第 1 点），保留印刷语义。
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
    "缺把 Base Might 设为 5 并持续本回合的卡牌指令入口（143.2.a.1 / 479.2）：" +
    "instructionDefinitionsById 没有 continuous.base-might，continuous.might 的 argsSchema 拒绝 layer 参数；" +
    "layers/engine 的 trait 图层已支持 set-property(might) 并在回合末到期（实测），但没有已注册原语把卡牌正文绑定到它；" +
    "continuous.might 的 add/set 始终注册 arithmetic 图层（479.4），不能代替本卡的 Trait-Altering 语义。",
  abilities,
  sourceText: "When you play me, choose a friendly unit. Its base Might becomes 5 this turn."
} satisfies CardProgram;
