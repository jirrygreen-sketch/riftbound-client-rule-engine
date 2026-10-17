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
 * status = judge-required（按当前 HEAD 复核；缺口不近似实现）：continuous.might 的 +8、
 * end-of-turn 期限与失效目标重查都有执行证据；conquered 别名本身合法（validateTriggerSpec
 * 通过，translateTriggerFilter 得 { event: "conquered", object: { objectId: "vox" } }）。
 * 剩余缺口是 Score 波没有参与征服单位的对象：turn/flow.ts 的 scheduleScore 只发
 * player/details.battlefieldId，{ source: "self" } 翻译出的 objectId 过滤器没有事件对象可匹配。
 * 实测注册成功（1 个订阅）后，发出流程形状的 conquer 波（只有 player/details）命中 0 次；
 * 同一订阅在事件携带对象时才命中，证明缺的就是事件参与单位载荷（383.4.c.2.a）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 383.4.c.2：“When I conquer” 的 Conquer Effect 由本卡自身的征服触发。
      filter: { event: "conquered", filter: { source: "self" } }
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
    "仍缺 Conquer Effect 的参与单位匹配（CR 383.4.c.2.a）：turn/flow.ts 的 conquer Score 波只有 player/details.battlefieldId，" +
    "没有征服单位对象，故 source:self 翻译出的 objectId 过滤器没有事件对象可匹配——实测订阅注册成功后在流程形状的波上命中 0 次，" +
    "带对象的事件才命中。continuous.might 的 +8、本回合到期与失效目标重查均有 golden 执行证据；不得用 battlefieldId 冒充征服单位。",
  abilities,
  sourceText: "When I conquer, give a friendly unit +8 :rb_might: this turn."
} satisfies CardProgram;

export default program;
