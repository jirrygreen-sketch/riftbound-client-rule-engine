import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Party Crasher (rad-122-167) — Unit, Order, 9 energy / 1 power / 6 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-122-167):
 *   "I cost :rb_energy_1: less for each exhausted unit you control.
 *    [Tank] (I must be assigned combat damage first.)"
 *
 * 规则依据（CR v1.5）：
 * - [Tank]（815）：被动关键词，815.1.b 功能上等于 "I must be assigned lethal damage
 *   before any other unit with the same controller as me that does not have [Tank]
 *   during the Combat Damage step"；815.1.c 改变战斗伤害分配的可选对象，
 *   815.2 多重 Tank 冗余，815.3 是可被引用的特征。按契约 3.1 声明为 keyword 能力，
 *   展开由 effects/keywords/Tank.ts 负责（该文件不存在）。
 * - "I cost 1 less for each exhausted unit you control"：打印费用的自我减免，
 *   在 "3. Determine Total Cost" 的折扣步骤结算（356.4，356.4.b "cost [amount] less"、
 *   356.4.g 变量折扣在该步骤取值、356.6 不得降到 0 以下）。按 Production Surge
 *   （sfd-076-221）的先例，用 static + continuous.cost-modification 描述，
 *   由费用系统在 Finalize 消费；"for each exhausted unit you control" 的被计数集合
 *   写在 per 上（与文字一致），condition 对应 "至少 1 个可减"（计数为 0 时无减免）。
 *
 * 无法执行的依赖（按 README 第 2 节保持 judge-required，不近似实现；2026-10-17 复核）：
 * - Tank.ts 已合入并可通过 programs/ 绑定为 ability-layer continuous.combat，
 *   但 combat/base-combat-allocation.ts 仍以 keywordPriority: "proven-none" 证明基础分配路径，
 *   没有消费 Tank 的分配优先级。
 * - continuous.cost-modification 的生产静态绑定即被拒绝：programs/statics.ts 的 layerFor
 *   没有该 kind 的图层映射（实测 judge-required: Static ability kind
 *   continuous.cost-modification has no layer mapping），因此也没有费用 Finalize 消费方。
 * - 该减免的 per 计数目前也求不出值（CR 356.4.g）：解释器集合查询把 controller:"controller"
 *   当具体玩家 id 字面比较，实测计数 0、condition 恒 false；改成 layers/filter.ts 认识的
 *   controller:"self" 又会退化成 object.controller === object.controller（把对手的横置单位
 *   也算进来）；只有显式玩家 id 才对，而卡程序不能写死玩家。另外解释器集合查询不消费
 *   states 限定（实测带 states: "exhausted" 与不带返回同一集合），所以「横置」这一半也还
 *   缺生产过滤语义。
 */
const exhaustedUnits = {
  kind: "count" as const,
  subject: "units",
  filter: { type: "unit", controller: "controller", states: "exhausted" }
};

const abilities: Ability[] = [
  { kind: "keyword", keyword: "tank" },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "self",
      amount: { kind: "constant", value: -1 },
      per: exhaustedUnits
    },
    condition: {
      kind: "compare",
      left: exhaustedUnits,
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-51a7a5074ce15f7be681afd13ce27fd042c4566c3987a18a4e7dafdf0faadc53",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-17 复核：Tank KeywordDef 与 CardProgram static 绑定路径已合入，" +
    "但 combat/base-combat-allocation.ts 仍明确以 keywordPriority: \"proven-none\" " +
    "证明基础分配路径，尚未消费 continuous.combat 的 Tank 优先级（815.1.b/c）。" +
    "费用一侧的生产静态绑定即被拒绝：programs/statics.ts 的 layerFor 没有 continuous.cost-modification 的" +
    "图层映射（实测 judge-required: Static ability kind continuous.cost-modification has no layer mapping），" +
    "因此 Finalize 也不会读取卡牌程序的 per 计数。" +
    "此外 per 计数目前求不出值：解释器集合查询把 \"controller\" 当作字面玩家 id 比较" +
    "（实测计数 0，condition 恒 false），layers/filter.ts 的 \"self\" 拼写又退化为 " +
    "object.controller === object.controller（把对手的横置单位也算进来），" +
    "只有显式玩家 id 才对，而卡程序不能写死玩家；解释器集合查询也不消费 states 限定" +
    "（实测带/不带 states: \"exhausted\" 返回同一集合）。" +
    "所以「每个被你横置的单位」的 -1 Energy 换算（356.4/356.4.g）还缺相对玩家解析与状态过滤语义。" +
    "因此只保留 judge-required，不近似实现。",
  abilities,
  sourceText:
    "I cost :rb_energy_1: less for each exhausted unit you control.\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;

export default program;
