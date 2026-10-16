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
 * 卡牌不写单卡结算代码）。三个关键词的 KeywordDef 都已合入，但展开结果都没有运行时
 * 注册/消费路径：
 * - [Reaction]（CR v1.5 813.1）：effects/keywords/Reaction.ts 已合入，展开为
 *   continuous.timing（813.1.c 的 Closed State 打出许可）。RIFT-259 的
 *   layers/rules/query.ts 已能消费 continuous.timing（actionTimings / canAct 重载），
 *   但没有任何已合入模块把卡牌/关键词展开注册进图层注册表（唯一注册入口是
 *   chain 的 ResolveContext.addContinuous 与 continuous.* 指令原语），且 chain 自己的
 *   canAct()（契约 3.5 的时机许可查询）不读取图层——所以「任意时机打出」仍不可执行。
 * - [Shield 2]（814.1.b.1/.b.2 的 Shield Value = 2）：effects/keywords/Shield.ts
 *   已合入，按 814.1.c 展开为带 compare(designation == "defender") 条件的
 *   continuous.might +2（814.1.d/814.1.d.1）。ObjectSnapshot 目前没有 designation
 *   特征，layers 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，
 *   未识别的 compare 条件落到「恒真」，直接注册会把 +2 Might 变成常驻——不近似放行。
 *   814.2 的求和由 KeywordDef 的 stacking: "sum" 声明，814.3 的可引用特征依赖图层。
 * - [Tank]（815.1.b「我必须在战斗伤害步骤被优先指派致命伤害」）：effects/keywords/Tank.ts
 *   已合入（RIFT-264），展开为 continuous.combat 的 damage-assignment/priority "first"
 *   声明；但该 kind 没有任何运行时消费方（layers/engine.ts 的 ability/arithmetic
 *   分支不命中），战斗伤害指派顺序也未实现——combat/base-combat-allocation.ts
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
    "三个 KeywordDef 都已合入（Reaction/Shield/Tank，RIFT-264 等），但展开结果都没有运行时路径：" +
    "(1) [Tank] 展开的 continuous.combat（815.1.b 的优先指派致命伤害）没有消费方——layers/engine.ts 不命中该 kind，" +
    "combat/base-combat-allocation.ts 未绑定任何指派优先级（815.1.c.1/815.1.c.2）；" +
    "(2) [Shield 2] 展开的 +2 Might 需要宿主持有 Defender 指定（814.1.d.1），但 ObjectSnapshot 无 designation 特征" +
    "（契约 3.8 规划的 combatRole 未落地），layers 的 conditionMatches 不评估 compare 条件、未识别时会恒真，直接注册会变成常驻；" +
    "(3) [Reaction] 展开的 continuous.timing（813.1.c）虽已有 layers/rules 查询（RIFT-259），但没有把卡牌/关键词展开注册进图层的接线，" +
    "chain.canAct()（契约 3.5 的唯一时机许可查询）也不读取图层。" +
    "依赖：continuous.combat 消费方/战斗指派（RIFT-258 交接、战斗工作流）、关键词展开→layers 注册路径与图层 compare/designation 支持（RIFT-91 后续）、" +
    "chain 时机许可读取图层（RIFT-259 消费方的接线）。不近似实现。",
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
