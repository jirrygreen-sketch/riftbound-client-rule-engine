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
 * - [Tank]（815）：KeywordDef（effects/keywords/Tank.ts）已合入并展开为
 *   continuous.combat，但战斗分配（combat/base-combat-allocation.ts）的分配消费方
 *   仍是 keywordPriority: "proven-none"，815.1.c 的 Tank 优先级未绑定。
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
 * - 生产绑定链已合入（programs/statics.ts 的 bindStaticToLayers + lifecycle），但
 *   staticFilter 只支持 sameLocationAs 的 self/source 锚与 controller/owner 占位符
 *   具体化，遇到条件过滤器里的 exclude: "self" 直接抛 judge-required
 *   （"Static exclude anchor needs a dynamic relative filter"），静态能力无法注册。
 * - continuous.might 的图层算术消费方（layers/engine.ts 的 applyArithmetic）已合入
 *   （RIFT-91 结论过时）。
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
    "「I have +2 Might」的 continuous.might 图层算术消费方与生产绑定链（programs/statics.ts + lifecycle）" +
    "均已合入（RIFT-91 结论过时）；剩余缺口是条件过滤器：sameLocationAs:self 锚与 controller 占位符" +
    "已由 staticFilter 支持，但 exclude:self（740.1 的 other 语义）会被 staticFilter 拒绝" +
    "（实测抛 Static exclude anchor needs a dynamic relative filter），静态能力无法注册，" +
    "条件里的 other 排除无法如实表达。" +
    "[Tank] 的 KeywordDef 已合入并展开 continuous.combat，但 815.1.c 的伤害分配优先级缺消费方：" +
    "combat/base-combat-allocation.ts 的分配仍是 keywordPriority: proven-none。" +
    "依赖：staticFilter 的相对排除锚点与 Tank 分配消费方；不近似实现。",
  abilities,
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "While there are 2 or more other friendly units and/or gear at my battlefield, I have +2 :rb_might:."
} satisfies CardProgram;

export default program;
