import type { CardProgram } from "../../ir/index.js";

/**
 * Fiora, Victorious (ogn-232-298) - Unit, Order, Fiora/Demacia/Champion (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-232-298):
 *   While I'm [Mighty], I have [Deflect], [Ganking], and [Shield].
 *   (I'm Mighty while I have 5+ :rb_might:.)
 *
 * 规则依据（CR v1.5）：
 * - 706-711：Mighty 是"有效 Might >= 5"的描述；710 在场上按当前 Might 评估。
 *   因此 "While I'm [Mighty]" 是持续效果的条件（condition），按 compare(self.might >= 5) 表达，
 *   与已合入的 unsung-hero / grand-duelist 的 Mighty 阈值写法一致。
 * - 809 / 810 / 814（对照 keywords/Deflect.ts、Ganking.ts、Shield.ts 的 ruleRefs）：
 *   Deflect / Ganking / Shield 各自是被动能力关键词；未写数值时 Deflect = 1（809.1.b.3）、
 *   Shield = 1（814.1.b.3）。
 * - 809.1.c：Deflect 是对对手选择本永久物的法术/能力追加的 Mandatory Additional Cost；
 * - 810.1.b / 144.4.c.1：Ganking 给单位 Standard Move 增加 battlefield-to-battlefield 许可；
 * - 814.1.c：Shield 功能上等价于"我是防御者时 +X [M]"。
 *
 * status: judge-required —— 条件性授予关键词需要完整消费链，均未合入：
 * 1. 卡牌 static 持续效果进入 layers 的 ability 层（grant-keyword / continuous.keyword 展开）；
 * 2. Deflect 展开（target.tax）在目标选择 / 费用计划上生效（RIFT-90）；
 * 3. Ganking 展开（continuous.movement）被移动系统读取、Shield 展开（continuous.might）被图层
 *    算术层读取（RIFT-91）；且 layers 的 condition 求值当前不支持对象属性比较（本卡条件），
 *    无法按 710 在场上评估 Might。以上任一缺失都会让"拥有这些关键词"变成空声明，故保持
 *    judge-required，不把声明当作可执行。
 */
const fioraVictorious = {
  canonicalCardId: "card.hash-184064ceedf3bc8c1c777c425d1bc971c0b7a878cde5573d58da57509cf5d08e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm [Mighty], I have [Deflect], [Ganking], and [Shield]」需要条件性关键词授予的完整消费链：" +
    "卡牌 static 效果进 layers 的 ability 层（grant-keyword 展开）、[Deflect] 展开的 target.tax 在目标选择/费用计划生效" +
    "（809.1.c，RIFT-90）、[Ganking] 展开的 continuous.movement 被移动系统读取（810.1.b、144.4.c.1）、" +
    "[Shield] 展开的 continuous.might 被算术层读取（814.1.c，RIFT-91）；" +
    "同时 layers 的条件求值尚不支持按 710 读取对象当前 Might 做比较（706-711 的 Mighty 判定）。" +
    "仅声明关键词不构成可执行证据，故不标 executable。依赖：RIFT-90（target tax）、RIFT-91（layers-continuous）。",
  sourceText:
    "While I'm [Mighty], I have [Deflect], [Ganking], and [Shield]. (I'm Mighty while I have 5+ :rb_might:.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        appliesTo: "self",
        keywords: [
          // 809.1.b.3 / 814.1.b.3：未写数值时按 1 处理；Ganking 不带数值（810）。
          { id: "Deflect", value: 1 },
          { id: "Ganking" },
          { id: "Shield", value: 1 }
        ]
      },
      // 708/710：Mighty = 场上有效 Might >= 5。
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "might" },
        operator: "gte",
        right: { kind: "constant", value: 5 }
      }
    }
  ]
} satisfies CardProgram;

export default fioraVictorious;
