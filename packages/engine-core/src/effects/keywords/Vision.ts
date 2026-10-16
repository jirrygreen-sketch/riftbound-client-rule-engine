import type { Ability } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

/**
 * Vision —— 触发式能力关键词（CR v1.5 817）。
 *
 * v1.5 规则依据（ruleRefs）：
 * - 817.1：Vision 是 Triggered Ability keyword（817.1.a 在永久物上；817.1.b 等价于
 *   "When this is played, [Predict]."；817.1.c 触发条件是该永久物进入 Board）。
 * - 817.2：多个 Vision 实例**各自独立触发**（stacking: "separate"；817.2.a 每个实例
 *   单独决定是否回收；817.2.b 若中间无其他动作，每个实例看到同一张牌）。
 * - 817.3：Vision 是永久物的 characteristic，可被其他游戏效果检查 / 引用。
 * - 437.1 / 437.3 / 437.4：Predict —— 看牌库顶一张并选择是否回收它；未带数值时
 *   X 默认为 1；超出牌库则尽可能多看、不触发 Burn Out。
 *
 * 展开结构：单个 triggered 能力——
 *   trigger.at: "object-enters-board"（events/timing-points.ts 中的时点 id；
 *     817.1.c "The trigger is the permanent entering the Board"），
 *     filter 限定进场者为本来源对象（事件过滤器 payload 的 objectId / object.id）。
 *   body（Predict 两步，选择回收哪张由执行玩家在看过的牌内作 choose）：
 *     1. effect.inspect { player: constant("A"), zone: "deck", amount: 1,
 *        choose: true, chooseCount: { min: 0, max: 1 },
 *        pickedKey: "vision-picked", choosePicksKey: "vision-recycle" }
 *        —— 437.1 的"look at a single card from the top of the Main Deck and
 *        choosing whether or not to Recycle it"。
 *     2. effect.recycle { objects: linked(vision-look, "vision-recycle") }
 *        —— 把被选中（选择回收）的牌回收；未选中时 linked 为空数组，
 *        effect.recycle 对空候选按 P0 3.6 语义执行零次回收。
 *   每个实例独立触发（817.2），故 expand 只返回**一个**能力；同一对象上的多个
 *   Vision 由注册表按 stacking "separate" 展开为多个独立 Ability。
 *
 *   player 参数：EffectIR 没有"控制者"字面量；object-property 的 object 字段在
 *   card-dsl 类型里是 ObjectRef，但 validateExpr 把它按 string 校验（已知不一致），
 *   linked 又要求指向先前指令。这里用 constant("A")——玩家 id "A" 是展开期占位，
 *   代表 host 的 controller（永久物打出 / 进场时 owner === controller）；装配层 /
 *   运行内核在解析时注入实际的 controller PlayerId。这满足 effect.inspect
 *   argsSchema 对 Expr 的要求，且能用参考测试内核（默认玩家 "A"）实际执行
 *   Predict 步骤，见 test/effects/keywords/Vision.test.mjs。
 *
 * 依赖尚未合入的部分（本文件只按契约写出引用，不近似实现、不改其他文件）：
 * - "object-enters-board" 时点的 payload 字段名（objectId / object.id）以
 *   timing-points.ts 的 zone-change payloadType 为准；触发器**匹配器**（把
 *   ObjectFilter 应用到事件 payload）属时点子系统，本关键词只提供 filter 形状。
 * - 无其他缺口：effect.inspect、effect.recycle 均已合入，可被解释器 + 参考测试
 *   内核实际执行（见 test/effects/keywords/Vision.test.mjs）。
 *
 * valued: false —— 817 中 Vision 从不带数值；Predict 的张数（437.3.a 默认 1）
 * 来自 Predict 关键词自身（kw-predict），不由 Vision 的 value 承载。expand 收到
 * value 时忽略之并仍返回单一实例。
 */

/** 437.3.a：未写数值的 [Predict] 按 1 张处理。 */
const PREDICT_AMOUNT = 1;

const HOST_ENTERED_BOARD_FILTER = Object.freeze({
  objectId: "self",
  "object.id": "self"
} as const);

function expand(input: { readonly value?: number; readonly host: { readonly canonicalCardId: string } }): readonly Ability[] {
  return [
    {
      kind: "triggered",
      optional: false,
      trigger: {
        at: "object-enters-board",
        filter: { ...HOST_ENTERED_BOARD_FILTER }
      },
      body: [
        {
          id: "vision-look",
          op: "effect.inspect",
          args: {
            player: { kind: "constant", value: "A" },
            zone: { kind: "constant", value: "deck" },
            amount: { kind: "constant", value: PREDICT_AMOUNT },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: PREDICT_AMOUNT } },
            pickedKey: { kind: "constant", value: "vision-picked" },
            choosePicksKey: { kind: "constant", value: "vision-recycle" }
          }
        },
        {
          id: "vision-recycle",
          op: "effect.recycle",
          args: {
            objects: { kind: "linked", instructionId: "vision-look", key: "vision-recycle" }
          },
          linkedTo: "vision-look"
        }
      ]
    }
  ];
}

export default {
  keyword: "Vision",
  valued: false,
  stacking: "separate",
  expand,
  ruleRefs: ["817", "817.1", "817.1.b", "817.1.c", "817.2", "817.3", "437.1", "437.3", "437.3.a", "437.4"]
} satisfies KeywordDef;
