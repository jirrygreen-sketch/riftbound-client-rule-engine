import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Steadfast Outrider (rad-128-167) — Unit, Order, 4 energy / 无印刷力量 / 3 Might。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-128-167):
 *   "[Tank] (I must be assigned combat damage first.)
 *    While there are 2 or more other friendly units and/or gear at my battlefield,
 *    I have +2 :rb_might:."
 *
 * 规则依据（CR v1.5）：
 * - [Tank]（815）：同 party-crasher 的说明；effects/keywords/Tank.ts 未合入，
 *   且战斗伤害分配的 Tank 优先级未绑定。
 * - "While there are 2 or more other friendly units and/or gear at my battlefield"：
 *   持续效果的条件（135.x 条件从句作用域由契约 3.9 维护：条件只作用于所属能力）。
 *   "my battlefield" = 本单位的 Location（198.2 位置是永久物特征），
 *   用 sameLocationAs: "self"；"other" 用 exclude: "self"（740.1 的 other 语义）。
 *   卡牌原文是 "units and/or gear"，因此条件写成两个集合计数相加 ≥ 2：
 *   arithmetic add + 两个 count（unit / gear），避免依赖参考内核不支持的
 *   type 数组 "or" 语义，同时保持与原文一致的集合。
 * - "I have +2 :rb_might:"：Might 的持续加值属于图层算术层（契约 3.4 的
 *   copy → trait → ability → arithmetic），按 Assault/Shield 的既有展开形状用
 *   continuous.might（mode add、layer arithmetic、appliesTo self）。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - continuous.might 没有已注册的消费指令/图层写入路径（RIFT-91 layers/continuous），
 *   静态能力目前只作为 IR 存在（Assault.ts 自述同一缺口）。
 * - equal-location/exclude 锚点在参考内核需显式 host 绑定，生产链（触发/静态能力的
 *   host 绑定）尚未接线；条件里的 controller: "controller" 占位符由生产链解析。
 */
const othersAtMyBattlefieldFilter = {
  type: ["unit", "gear"],
  zone: "board",
  controller: "controller",
  sameLocationAs: "self",
  exclude: "self"
} as const;

const othersAtMyBattlefield = (type: string) => ({
  kind: "count" as const,
  subject: "objects",
  filter: { ...othersAtMyBattlefieldFilter, type }
});

const abilities: Ability[] = [
  { kind: "keyword", keyword: "tank" },
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 2 }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "arithmetic",
        operator: "add",
        operands: [othersAtMyBattlefield("unit"), othersAtMyBattlefield("gear")]
      },
      operator: "gte",
      right: { kind: "constant", value: 2 }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-af14696b17098be6286c750ebb3baaf3aeb4e4f188d7857651be5d9e4e97e053",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 continuous.might 的图层消费方：\"I have +2 Might\" 需要一个持续的 Might 加值" +
    "（契约 3.4 的 arithmetic 层），当前没有已注册指令或图层写入路径消费卡牌程序里的" +
    "continuous.might（依赖 RIFT-91，Assault/Shield 展开自述同一缺口）。" +
    "\"other friendly units and/or gear at my battlefield\" 需要生产链解析" +
    "controller 占位符与 sameLocationAs/exclude 锚点的 host 绑定（参考内核需显式 host）。" +
    "[Tank] 还缺 effects/keywords/Tank.ts 与 815.1.c 的伤害分配优先级（combat/" +
    "base-combat-allocation.ts 显式未绑定）。依赖：关键词工作流（Tank 815）、RIFT-91。",
  abilities,
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "While there are 2 or more other friendly units and/or gear at my battlefield, I have +2 :rb_might:."
} satisfies CardProgram;

export default program;
