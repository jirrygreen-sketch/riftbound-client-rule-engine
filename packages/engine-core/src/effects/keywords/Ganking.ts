import type { Ability } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

/**
 * Ganking —— 被动能力关键词（CR v1.5 810）。
 *
 * v1.5 规则依据（ruleRefs）：
 * - 810.1：Ganking 是 Passive Ability keyword（810.1.a 在单位上；810.1.b 等价于
 *   "I may move to a battlefield from another battlefield with a standard move."）。
 * - 810.1.c：它是给单位的 Standard Move **增加许可**的被动能力（810.1.c.1 不移除
 *   原有选项；810.1.c.2 无启动费用；810.1.c.3 不提供额外移动次数）。
 * - 810.2：多个 Ganking 实例冗余（stacking: "single"，只算一个）。
 * - 810.3：Ganking 是单位的 characteristic，可被其他游戏效果检查 / 引用。
 * - 144.4.c / 144.4.c.1：带 Ganking 的单位可用其 Standard Move 在战场之间移动。
 *
 * 展开结构：单个 static 能力，effect 为 ContinuousEffect { kind: "continuous.movement",
 * permission: "battlefield-to-battlefield", source: "battlefield",
 * destination: "battlefield", move: "standard", addsPermission: true }。关键词本身
 * 不执行任何流程（P0 契约 3.7），移动合法性由移动系统在读该持续效果时执行。
 *
 * 依赖尚未合入的部分（均不在本任务 owns 范围内，故按契约写出形状、不近似实现）：
 * - continuous.movement 原语（RIFT-9 原语清单 / ability-templates 第 250 行；
 *   RIFT-89~91 批次的 continuous.* 之一）尚未在 effects/instructions/ 合入。
 *   合入前，本静态能力的运行时效果不生效，仅作为通过 validateCardProgram 的 IR 存在。
 * - 移动系统（zones/movement.ts）尚无读取 continuous.movement 许可的接口；
 *   契约中 ContinuousEffect 的 kind/value 字段为开放形状（{ kind: string, ... }），
 *   若后续需要把 permission 等字段升格为受约束的 ContinuousEffect 子类型，将另行
 *   提交契约变更请求。本文件当前未请求契约变更。
 *
 * valued: false —— v1.5 中 Ganking 从不带数值（对比 valued 关键词 Assault 2 /
 * Shield 2；810 全文无数值形式）。expand 收到 value 时忽略之并仍返回单一实例。
 */
const GANKING_EFFECT = Object.freeze({
  kind: "continuous.movement",
  permission: "battlefield-to-battlefield",
  source: "battlefield",
  destination: "battlefield",
  move: "standard",
  addsPermission: true
} as const);

function expand(_input: { readonly value?: number; readonly host: { readonly canonicalCardId: string } }): readonly Ability[] {
  return [
    {
      kind: "static",
      effect: { ...GANKING_EFFECT }
    }
  ];
}

export default {
  keyword: "Ganking",
  valued: false,
  stacking: "single",
  expand,
  ruleRefs: ["810", "810.1", "810.1.c", "810.2", "810.3", "144.4.c", "144.4.c.1"]
} satisfies KeywordDef;
