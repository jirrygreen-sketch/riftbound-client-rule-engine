import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Inviolus Vox (unl-027-219) — Unit, 8 energy, 2 power, Might 8, Fury,
 * tags Dragon/Mount Targon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-027-219，逐字）：
 *   When I conquer, give a friendly unit +8 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.a：“When I conquer …” 是 Conquer Effect——
 *   Condition 含“本单位参与并成功征服一个战场”的触发式能力，在单位仍在该战场且玩家因征服得分后
 *   作为 Pending Item 进链；封闭时点表里的 conquer（scoring 发出，ruleRefs 468.5.d / 471.1 / 473.2.a）
 *   就是它。383.4.c.2.c：即使得分被替代/否定，本触发仍进链，因此不把得分成功作为条件。
 * - 355.9 / 355.10：“give a friendly unit …” 让玩家选择一个由你控制的单位，是选目标（targets），
 *   不是 pick（355.7）；355.9.a.1 规定未特别说明的 “unit” 指棋盘上的单位。
 * - “+8 :rb_might: this turn”：对本回合有效的临时 Might 修正（143.2.a 的 Might 指有效 Might；
 *   475/478 的算术层与期限），属 layers 的 continuous.might；effect.buff 的文件头明确 Buff 计数器
 *   （702/703）不是 Might 修正，两者不可互换。
 *
 * status = judge-required（按当前 HEAD 复核；缺口不近似实现）：
 * - 「+8 Might this turn」现在可执行：continuous.might 已合入，按已求值的 8 点算术层
 *   修正 + end-of-turn 期限经 ctx.addContinuous 注册（处理见 layers/ops 的 buildMightSpec /
 *   resolveContinuousDuration）。golden 通过链适配器 + 参考内核真实执行 body 并断言图层结果、
 *   到期与目标失效边界。原 body 里的 `layer` 参数已被合并原语 schema 拒绝（Invalid continuous.might
 *   argument: layer），故改写为合并形状；body 仍不是 8 个 Buff 计数。
 * - conquer 触发仍不能在生产事件管线中命中：Score 波发射 conquer 时只带 player/details，不带征服单位，
 *   因此 filter {event:"conquer", filter:{source:"self"}} 经 programs/filters.ts 归一化后的
 *   object:{objectId:...} 没有可匹配事件对象；同时 EventPattern 的封闭词汇没有 "conquer" 拼写。
 * - 友方目标已经改用契约支持的 controller: "self"，会在程序目标翻译时绑定能力控制者。
 * 依赖：conquer 事件的来源对象载荷与事件词汇接线。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 383.4.c.2：“When I conquer” 的 Conquer Effect 由本卡自身的征服触发。
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "inviolus-vox.grant-might-8",
        // “give a friendly unit +8 :rb_might: this turn.” —— 本回合到期的临时 Might 修正
        // （arithmetic 层，见 judgeReason）；结算时由 continuous.might 注册该修正。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: 8 },
          duration: { kind: "constant", value: "this-turn" },
          // 355.9/355.9.a.1：单个由你控制的棋盘单位。continuous.might 的 objects
          // 选择描述符只接受已求值的选择形状（target/pick/query/choose/refs），
          // 裸的 target 字符串不是契约 3.2 的 Expr，因此用 { kind: "target", id }。
          objects: {
            kind: "constant",
            value: { kind: "target", id: "inviolus-vox.friendly-unit" }
          }
        },
        targets: [
          {
            id: "inviolus-vox.friendly-unit",
            // 355.9 / 355.9.a.1：“a friendly unit” 是由你控制的单个棋盘单位。
            filter: { type: "unit", controller: "self", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-f11b51df9013e0151586a2443eb2342dba8ad5f6aa01ea4e5f5bb83f35e722df",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "按当前 HEAD 复核，仍有一处缺口，不近似实现：" +
    "(1) conquer 触发仍不可注册：turn/flow.ts 的 Score 波发出 conquer 时只带 player 与 details.battlefieldId、" +
    "不带征服单位，因此 { event: \"conquer\", filter: { source: \"self\" } } 经 programs/filters.ts 归一化后的 " +
    "object:{objectId:宿主} 没有可匹配的事件对象；封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）里也没把 " +
    "conquer 列为可订阅拼写（只保留 conquered 别名）。" +
    "已合入并已真实执行的部分：「give a friendly unit +8 Might this turn」（143.2.a/475/478）由 " +
    "continuous.might 注册 arithmetic 层本回合到期的 +8 修正，golden 经链适配器 + 参考内核断言 " +
    "注册、有效 Might、到期与目标失效边界；原 body 的 layer 参数已被合并原语 schema 拒绝，故改成合并形状。" +
    "effect.buff 只放 Buff 计数器（702/703），不是 Might 修正。" +
    "依赖：conquer 事件的来源对象载荷与事件词汇接线。",
  abilities,
  sourceText: "When I conquer, give a friendly unit +8 :rb_might: this turn."
} satisfies CardProgram;

export default program;
