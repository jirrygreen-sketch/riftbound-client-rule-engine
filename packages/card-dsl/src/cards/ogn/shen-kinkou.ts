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
 * 卡牌不写单卡结算代码）。三个关键词的 KeywordDef 都已合入，Reaction 的时机查询也已
 * 接通；仍有以下运行时缺口：
 * - [Reaction]（CR v1.5 813.1）：effects/keywords/Reaction.ts 已合入，展开为
 *   continuous.timing（813.1.c 的 Closed State 打出许可）。layers/rules/query.ts 与 chain.canAct()
 *   已能消费 continuous.timing（actionTimings / canAct），但 Reaction 展开的
 *   appliesTo: ["card", "activated-ability"] 尚没有 static binder 的对象/动作范围映射，
 *   因而“包括对自己控制的战场”这段许可不能由 CardProgram 生命周期接入。
 * - [Shield 2]（814.1.b.1/.b.2 的 Shield Value = 2）：effects/keywords/Shield.ts
 *   已合入，按 814.1.c 展开为带 compare(designation == "defender") 条件的
 *   continuous.might +2（814.1.d/814.1.d.1）。ObjectSnapshot 已有 combatRole 特征，
 *   但 Shield KeywordDef 仍产生 property="designation"；条件求值读不到该属性，
 *   因而 +2 Might 不会只在 Defender 时生效——不近似放行。
 *   814.2 的求和由 KeywordDef 的 stacking: "sum" 声明，814.3 的可引用特征依赖图层。
 * - [Tank]（815.1.b「我必须在战斗伤害步骤被优先指派致命伤害」）：effects/keywords/Tank.ts
 *   已合入，展开为 continuous.combat 的 damage-assignment/priority "first"
 *   声明；但该 kind 没有任何运行时消费方（layers/engine.ts 的 ability/arithmetic
 *   分支不命中），战斗伤害指派顺序也未实现——combat/base-combat-allocation.ts
 *   明确注明未绑定 Tank/Backline 之类的指派优先级（815.1.c/815.1.c.1/815.1.c.2）。
 *   815.2 的多实例冗余与 815.3 的可引用特征同样依赖关键词展开与战斗模块。
 *
 * 整卡保持 judge-required：Tank 与 Shield 仍缺真实消费者，Reaction 还缺 appliesTo 范围绑定。
 */
const shenKinkou = {
  canonicalCardId: "card.hash-02482e5d821a8879fe503e6b27f785f4fc8c8139f58c9bd035f34f92f1b8522a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三个 KeywordDef 的展开结构已存在，但展开结果仍缺运行时消费路径：" +
    "(1) [Tank] 展开的 continuous.combat（815.1.b 的优先指派致命伤害）没有消费方——layers/engine.ts 不命中该 kind，" +
    "combat/base-combat-allocation.ts 未绑定任何指派优先级（815.1.c.1/815.1.c.2）；" +
    "(2) [Shield 2] 展开的 +2 Might 需要宿主持有 Defender 指定（814.1.d.1），但 Shield 仍引用" +
    "未被图层对象特征识别的 designation 属性，compare(designation == defender) 条件求值无法得到 combatRole/Defender，" +
    "(3) [Reaction] 展开的 continuous.timing（813.1.c）已有 layers/rules 与 chain.canAct 查询，但 appliesTo: [\"card\", \"activated-ability\"]" +
    "尚无 static binder 的对象/动作范围映射，不能把包括自己控制战场的打出许可接入生命周期。" +
    "依赖：continuous.combat 消费方/战斗指派、combatRole/Defender 条件求值、以及 Reaction appliesTo 范围绑定。不近似实现。",
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
