import type { CardProgram } from "../../ir/index.js";

/**
 * Shen, Kinkou (ogn-241-298) — Unit, Order, M1 卡组 (fiora-sfd)。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-241-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve,
 *   including to a battlefield you control.)
 *   [Shield 2] (+2 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * 三条能力都是关键词声明（契约 3.1 keyword ability、3.7 关键词只声明不重写；
 * 卡牌不写单卡结算代码）：
 * - [Reaction]（CR v1.5 813.1）：RIFT-85 的 effects/keywords/Reaction.ts 已合入，
 *   展开为 continuous.timing 静态能力（813.1.c 的 Closed State 打出许可）。图层
 *   ability 层会把 grants 记进 actionTimings，但 chain.canAct()（813 的唯一时机
 *   许可查询，契约 3.5）不读取图层许可，所以「任意时机打出」还不可执行。
 * - [Shield 2]（814.1.b.1/.b.2 的 Shield Value = 2）：effects/keywords/Shield.ts
 *   已合入，按 814.1.c 展开为 continuous.might +2，条件是宿主持有 Defender 指定
 *   （814.1.d/814.1.d.1）。ObjectSnapshot 目前没有 designation 特征，layers 的
 *   conditionMatches 只识别 always/never/type/has-tag/has-keyword，compare 条件会
 *   落到「恒真」，把 +2 Might 变成常驻——不近似放行（814.2 的求和由 KeywordDef
 *   的 stacking: "sum" 负责，814.3 的可引用特征依赖图层）。契约 3.8 第 1 条规划的
 *   combatRole 字段同样未合入，且与 Shield 展开读取的 designation 属性名不一致。
 * - [Tank]（815.1.b「我必须在战斗伤害步骤被优先指派致命伤害」）：effects/keywords/
 *   下没有 Tank KeywordDef，战斗伤害指派顺序也未实现——combat/base-combat-allocation.ts
 *   明确注明未绑定 Tank/Backline 之类的指派优先级（815.1.c/815.1.c.1/815.1.c.2）。
 *   815.2 的多实例冗余与 815.3 的可引用特征同样依赖关键词展开与战斗模块。
 *
 * 整卡保持 judge-required：三条能力都有 v1.5 规则依据与关键词身份，但没有一条能在
 * 当前已合入的图层 / 链 / 战斗路径上真实执行（README 第 2 节）。
 */
const shenKinkou = {
  canonicalCardId: "card.hash-02482e5d821a8879fe503e6b27f785f4fc8c8139f58c9bd035f34f92f1b8522a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺已合入的 Tank KeywordDef（effects/keywords/ 下无 Tank.ts，815.1.b 的「必须优先被指派战斗伤害」无法展开），" +
    "并缺战斗伤害指派顺序实现（combat/base-combat-allocation.ts 未绑定 Tank 指派优先级，815.1.c.1/815.1.c.2）；" +
    "[Shield 2] 的展开（effects/keywords/Shield.ts）需要宿主持有 Defender 指定（814.1.d.1），但 ObjectSnapshot 无 " +
    "designation 特征（契约 3.8 第 1 条规划的 combatRole 也没有落地，且属性名与展开读取的 designation 不一致）、" +
    "layers 的 conditionMatches 不评估 compare 条件，目前在图层里只会恒真，+2 Might 会变成常驻；" +
    "[Reaction] 展开出的 continuous.timing 时机许可（813.1.c）没有消费方——chain.canAct() 不读取图层许可。" +
    "依赖：RIFT-81~91 关键词工作流（Tank）、RIFT-91 图层条件扩展、链时机许可任务。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    { kind: "keyword", keyword: "shield", value: 2 },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;

export default shenKinkou;
