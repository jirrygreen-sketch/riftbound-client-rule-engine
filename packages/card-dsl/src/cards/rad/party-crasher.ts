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
 * 无法执行的依赖（按 README 第 2 节保持 judge-required，不近似实现）：
 * - effects/keywords/Tank.ts 未合入（关键词语义 815.1.b/c 的战斗伤害分配顺序同样
 *   未实现：combat/base-combat-allocation.ts 明确 "No Tank/Backline/other
 *   assignment-priority requirement is bound here"）。
 * - continuous.cost-modification 的消费方（把 per 的计数换算为 -1 × N 的能量折扣）
 *   属于 RIFT-89（cost 计划）与 RIFT-91（layers/continuous）批次；当前没有任何
 *   已注册指令或费用管线读取卡牌程序里的静态费用改写。
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
    "缺 effects/keywords/Tank.ts：815.1.b/c 的 Tank 是战斗伤害分配要求，combat/" +
    "base-combat-allocation.ts 仍显式不绑定任何 Tank/Backline 分配优先级，无法声明为可执行。" +
    "同时缺 continuous.cost-modification 的消费方：356.4 的 " +
    "\"cost 1 less for each exhausted unit you control\" 需要费用系统在 Finalize 读取" +
    "卡牌程序里的静态费用改写并把 per 计数换算为 -1 × N（356.4.g 变量折扣取值时机），" +
    "该管线属 RIFT-89（cost 计划）/RIFT-91（layers/continuous），尚未合入。依赖：" +
    "关键词工作流（Tank 815）、RIFT-89、RIFT-91。",
  abilities,
  sourceText:
    "I cost :rb_energy_1: less for each exhausted unit you control.\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;

export default program;
