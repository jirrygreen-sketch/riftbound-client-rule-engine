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
 * 1. `continuous.grant-keyword` 没有已合入的图层消费方（契约 3.7：关键词展开为
 *    Ability 后由 layers 的 ability 层授予）；图层与持续效果注册依赖 RIFT-91。
 * 2. Ganking 自身的展开（effects/keywords/Ganking.ts → continuous.movement）也未被
 *    移动系统消费：zones/movement.ts 目前不读取 continuous.movement 许可。
 * 3. 因此本卡无法在整卡层面证明“被 Buff 时确实获得 Ganking”。
 */
export default {
  canonicalCardId: "card.hash-bfada85ea0485d763baf4f6d82594347175927b1b09ec1e1d976fce15710013e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm buffed, I have [Ganking]」是条件式被动能力（364.3），需要 ability 层把关键词" +
    "授予宿主：continuous.grant-keyword 没有已合入的图层消费方（依赖 RIFT-91 layers-continuous）。" +
    "同时 Ganking 的展开（effects/keywords/Ganking.ts → continuous.movement）未被移动系统消费，" +
    "zones/movement.ts 不读取该许可，故无法证明实际获得 Ganking（810.1.c、144.4.c）。" +
    "条件的 buffs 计数本身可用 object-property 表达，不近似实现。",
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
