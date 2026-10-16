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
 *        picksSpecId: "vision-top",
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
 *   player 参数 constant("A") 仍是展开期占位；装配层必须注入实际控制者，
 *   不能假设 owner 等于 controller。inspect 的表达式 schema 尚不接受静态
 *   ObjectSelector 特征读取，故不能在此用假 ObjectRef 获取控制者。
 *   上游还必须在每个实例结算时按真实牌库顺序绑定非目标 picks "vision-top"；
 *   inspect 不会从 query 集合顺序推导顶牌；空 picks 只能代表真实空牌库。
 *   ctx.picks 当前不区分未绑定与空集合，此边界必须由装配层保证。
 *
 * 依赖尚未合入的部分（本文件只按契约写出引用，不近似实现、不改其他文件）：
 * - "object-enters-board" 时点的 payload 字段名（objectId / object.id）以
 *   timing-points.ts 的 zone-change payloadType 为准；触发器**匹配器**（把
 *   ObjectFilter 应用到事件 payload）属时点子系统，本关键词只提供 filter 形状。
 * - effect.inspect、effect.recycle 已合入；测试通过现有 chain 参数适配器执行
 *   原始展开 body，并在内核中绑定真实有序 picks。生产控制者和顶牌绑定仍属装配层。
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
            picksSpecId: { kind: "constant", value: "vision-top" },
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
