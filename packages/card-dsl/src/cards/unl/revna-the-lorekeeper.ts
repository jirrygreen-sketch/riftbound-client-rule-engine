import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Revna the Lorekeeper (unl-005-219) — Unit, 7 Energy + 1 Fury power, Might 7, Fury,
 * tag Freljord.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-005-219，逐字）：
 *   "[Ganking] (I can move from battlefield to battlefield.)\n"
 *   "When you play a spell, if you spent :rb_energy_4: or more, ready me."
 *
 * 规则依据（CR v1.5）：
 * - [Ganking]（810）：810.1 是被动能力关键词，810.1.b 功能上等价于 "I may move to a
 *   battlefield from another battlefield with a standard move."；810.1.c 说明它只是给
 *   单位的 Standard Move 增加许可（810.1.c.1 不移除原有选项、810.1.c.2 无启动费用、
 *   810.1.c.3 不提供额外移动次数）；810.2 多个实例冗余；810.3 这是可引用特征；
 *   144.4.c / 144.4.c.1 给出实际移动许可。卡按契约 3.7 只声明 keyword，展开
 *   （static continuous.movement）归 effects/keywords/Ganking.ts（RIFT-83）。
 * - "When you play a spell"：383.4.a.4 明确 "当另一个对象被打出时触发的能力不算 Play
 *   Effect"，因此这是一条按 card-played 时点订阅的触发能力（359 / 383.4.a / 407），
 *   事件对象是刚打出的法术（355.9.a.2 的 "Spell"），玩家是能力控制者（190.6.d）。
 * - 383.2.a.1："if you spent :rb_energy_4: or more" 紧跟在触发条件之后，属于触发条件
 *   本身（不是 body 里某条指令的条件），必须在触发时求值。
 * - "ready me"：416.1 / 355.10.g 的重置动作，已合入的 effect.ready 原语执行，
 *   对象是本能力的来源（416.1.b/416.1.c 规定已就绪对象没有额外效果）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 触发条件 "if you spent :rb_energy_4: or more" 无以可求值路径：合并 IR 的
 *   Expr/Condition 只能读对象特征、链接值与对象计数，没有读取“为这张刚打出的法术实际支付
 *   的 Energy 总量”的表达式；effects/interpreter/history.ts 的 HistoryQuery 只允许
 *   scope/action/timingPoint/player/object/exclude/objectFilter（没有金额维度），
 *   但 ResolveContext/history 没有把该 spell 的实际 Energy 支付金额作为触发条件输入。
 *   与 ogn/loose-cannon、unl/virtuoso 的同一缺口口径一致：不把金额条件近似成对象计数或恒真。
 * - [Ganking]（810）的 KeywordDef（effects/keywords/Ganking.ts）与消费侧（RIFT-259 的
 *   continuous.movement 原语、layers/rules/query.ts 的 movement() 查询）都已合入，但两边
 *   形状不通：Ganking 展开输出 { kind: "continuous.movement", permission: "battlefield-to-
 *   battlefield", source/destination/move, addsPermission: true }，而 movement() 只读取
 *   { kind: "movement", permission: { routes: [...] } } —— continuous.movement 指令自己
 *   归一化成 routes 形状，但关键词展开没有走该归一化；实测把展开原样注册进图层后
 *   canGank/battlefieldToBattlefield 仍为 false，只有归一化形状才为 true。
 *   programs/lifecycle.ts 已负责把卡牌 keyword 展开并绑定到图层；当前缺口是
 *   Ganking 展开输出与 movement() 查询所需的 routes 形状不一致，因此绑定后的许可仍然不能被消费。
 *
 * 已合入并真实执行的部分：触发体的 "ready me"（416.1）用 effect.ready 以 "source"
 * 选择器在 golden 中真实执行，并覆盖已就绪单位的 no-op 情况（416.1.b/c）。
 *
 * 依赖：played-spell 费用金额进入 ResolveContext/history，以及 Ganking 展开与
 * continuous.movement routes 归一化的对齐。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // "you play a spell"：事件对象是刚打出的法术（383.4.a.4，355.9.a.2），
        // 打出者是能力控制者（190.6.d）。
        object: { type: "spell", controller: "self" },
        player: "self"
      },
      // 383.2.a.1：紧跟触发条件的 "if you spent [4] or more" 属于触发条件。
      // count 表达式的 subject 记录该条件的意图；合并 IR 没有金额维度，见 judgeReason。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "energy-spent-on-the-played-spell",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 4 }
      }
    },
    optional: false,
    body: [
      {
        id: "revna-the-lorekeeper.ready-self",
        op: "effect.ready",
        args: {
          // "me"：能力宿主即能力来源（416.1，359.3.f.1 的 referent）。
          objects: { kind: "constant", value: { kind: "source" } },
          linkKey: { kind: "constant", value: "readied" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-5d3fba8de73d7d55f79675ba2f61ea15aa7cde6f01ba1f7e39f3e3dbffcaa6b8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) 触发条件「if you spent :rb_energy_4: or more」没有可求值路径——合并 IR 的 Expr/Condition " +
    "只能读对象特征、链接值与对象计数（count 只数对象、不读金额），effects/interpreter/history.ts 的 HistoryQuery " +
    "只允许 { scope, action, timingPoint, player, object, exclude, objectFilter }，没有金额维度，" +
    "当前 ResolveContext/history 没有把该 spell 的实际 Energy 支付金额作为触发条件输入，因此" +
    "383.2.a.1 的触发条件无法求值；这不是 cost.pay 原语缺失，而是金额历史/载荷接口缺失。" +
    "(2) [Ganking]（810）的 KeywordDef（effects/keywords/Ganking.ts）与消费侧（RIFT-259 的 continuous.movement " +
    "原语、layers/rules/query.ts 的 movement()）都已合入，但两边形状不通：Ganking 展开输出 " +
    "permission: \"battlefield-to-battlefield\"（标量字段），movement() 只读 continuous.movement 归一化后的 " +
    "permission: { routes: [...] }；实测把展开原样注册进图层后 canGank 仍为 false。" +
    "programs/lifecycle.ts 已负责把卡牌 keyword 展开并绑定到图层，但 Ganking 展开输出与 movement() 查询所需的" +
    "routes 形状不一致，绑定后的战场到战场许可仍不能被消费；" +
    "810.1.b 的战场→战场 Standard Move 许可因此未生效。" +
    "已合入部分：触发体的 “ready me”（416.1）用 effect.ready 的 ‘source’ 选择器在 golden 中真实执行，" +
    "并覆盖已就绪单位的 no-op（416.1.b/c）。依赖：金额历史/载荷接口与 Ganking 展开到" +
    "continuous.movement routes 的归一化对齐。不近似实现。",
  abilities,
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When you play a spell, if you spent :rb_energy_4: or more, ready me."
} satisfies CardProgram;
