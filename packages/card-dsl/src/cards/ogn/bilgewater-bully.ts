import type { CardProgram } from "../../ir/index.js";

/**
 * Bilgewater Bully (ogn-125-298) — Unit, 6 energy, no printed power (Body), 6 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-125-298):
 *   While I'm buffed, I have [Ganking]. (I can move from battlefield to
 *   battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 810：Ganking 是 Passive Ability keyword；810.1.b 功能上等于“我可以用标准移动从
 *   一个战场移动到另一个战场”，810.1.c 只给标准移动增加许可，810.2 多重实例冗余。
 * - 364.3 / 364.3.a：“while …” 是条件式被动能力（Conditional Passive Ability）。
 * - 702 / 702.2.a / 703：被 Buff 的单位身上有一个 buff counter，本身使 Might +1。
 *   条件读宿主的 buffs 计数（702.3：一个单位同时只能有一个 Buff）。
 *
 * 结构：`static` 能力，`continuous.grant-keyword` 给宿主自己授予 Ganking，并用
 * `condition` 把“buffed”限定为宿主 buffs >= 1；条件读 `object-property` 的
 * `buffs`（ObjectSnapshot 的真实字段），不发明新的判定方式。
 *
 * status: judge-required —— 依据以下缺口，不近似实现：
 * 1. `continuous.grant-keyword` 原语、条件的 `buffs` 求值和静态程序绑定都已具备；本卡
 *    测试真实执行并验证 ability 层的 Ganking 与回合结束到期。
 * 2. 动态授予的关键词只写入 ObjectSnapshot.keywords（layers/engine.ts），没有后续
 *    KeywordDef 重展开把 Ganking 的 static continuous.movement 许可注册到规则层。
 *    continuous.movement 指令本身会把 permission 字符串规范化为 permission.routes，
 *    缺的是把该声明接入 layers/rules/query.ts 的 movement() 与 zones/unit-lifecycle
 *    的 deriveGanking→hasGanking 派生，并在失去 Buff 时撤销许可。
 * 3. 因此本卡无法在整卡层面证明“被 Buff 时确实获得 Ganking”。
 */
export default {
  canonicalCardId: "card.hash-bfada85ea0485d763baf4f6d82594347175927b1b09ec1e1d976fce15710013e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺少 continuous.grant-keyword 动态授予 Ganking 后的 KeywordDef 重展开与撤销：授予只写入 " +
    "ObjectSnapshot.keywords，静态 continuous.movement 许可（permission 字符串已由指令规范化为 " +
    "permission.routes）没有被注册进规则层。仍需把随 buffs 条件变化的授予接入 layers/rules/query.ts 的 " +
    "movement() 查询或 zones/unit-lifecycle 的可信 hasGanking 派生（CR 364.3、810.1.c、144.4.c.1），" +
    "并在失去 Buff 时撤销许可。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        filter: { object: "self" }
      },
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "buffs" },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText: "While I'm buffed, I have [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
