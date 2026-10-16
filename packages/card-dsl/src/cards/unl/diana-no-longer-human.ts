import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Diana, No Longer Human (unl-149-219) — Unit, Chaos, tags Diana/Mount Targon/Champion.
 * energy 4, power 1, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-149-219，逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)
 *   When you play a spell, give me +2 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Ambush]（822.1.b）：功能上等于“我可以被打到我有单位的战场，并且在这样打出时具有 [Reaction]”；
 *   822.1.c/822.1.d 说明它是给单位合法打出位置增加许可的被动能力。卡牌只声明关键词（契约 3.7）。
 * - “When you play a spell” 是打出事件触发（420.4.a：打出完成时触发；383.4.a.4：这类“别的对象被打出时”
 *   的能力不是 Play Effect），时点用封闭枚举的 card-played，事件对象为咒语且由本能力控制者控制。
 * - “give me +2 :rb_might: this turn”：带本回合期限的临时 Might 修正，属算术层（143.2.a、479.4）；
 *   effect.buff 的文件头明确临时 Might 修改归 layers 的 continuous.might，绝不等同 702 的 Buff 计数器。
 *   “me” 指能力宿主，不是选目标（355.7/355.10.g）。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Ambush]（822）没有已合入的 KeywordDef（effects/keywords/ 无 Ambush.ts；其展开应为
 *   continuous.timing 的 Reaction 许可 + target.location 的合法位置扩展），也没有 chain.canAct /
 *   Finalize 位置校验读取该许可的消费方。
 * - 临时 Might 修正没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，
 *   effects/instructions/ 下没有注册的 continuous.might 原语，也没有把卡牌程序声明的持续效果
 *   注册进 layers 的消费方（RIFT-91）。
 * - “When you play a spell” 的触发订阅需要卡牌程序 → 事件管线的注册接线（引擎批 6 的程序绑定）；
 *   已合入的 pipeline 只接受宿主提供的注册（需要 host.testTrigger 适配器），没有该入口。
 * 依赖：Ambush 关键词任务（RIFT-266 系列）、RIFT-91（layers-continuous 与卡牌注册）、
 * RIFT-257/120（卡牌触发程序绑定）。卡内已按契约 3.6 只使用符号选择器。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ambush" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // 383.4.a.4：“you play a spell” 不是 Play Effect；事件对象是刚打出的咒语，由本能力控制者控制。
        object: { type: "spell", controller: "controller" }
      }
    },
    optional: false,
    body: [
      {
        id: "diana-no-longer-human.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          // “me” 是能力宿主（355.10.g 的“me”不是选目标）；用契约 3.6 的符号选择器。
          object: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-11be609f8d3a73cf3ab397a574e5dc2de111d0ec840bd515e8f6df0e19e3774b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) [Ambush]（822.1.b/822.1.c）没有已合入的 KeywordDef" +
    "（effects/keywords/ 下无 Ambush.ts）：合法打出位置（“我有单位的战场”）与边打边获得的 Reaction 许可" +
    "（continuous.timing + target.location）都没有展开与消费方，chain.canAct / Finalize 位置校验不读取该许可。" +
    "(2) “give me +2 :rb_might: this turn”是带本回合期限的临时 Might 修正：契约 3.6 的封闭 GameAction 集合" +
    "没有 Might 修改动作，effects/instructions/ 下没有注册的 continuous.might 原语，也没有把卡牌程序的持续效果" +
    "注册进 layers 的消费方（RIFT-91）；effect.buff 只管 702 的 Buff 计数器，不能近似。" +
    "此外 “When you play a spell” 的触发订阅需要卡牌程序 → 事件管线的程序绑定入口（事件管线只接受宿主注册，" +
    "带条件的注册还要求 host.testTrigger 适配器），当前没有已合入路径（RIFT-257/120）。" +
    "依赖：Ambush 关键词任务、RIFT-91、RIFT-257/120。不近似实现（不把 +2 写成 Buff，也不省略 Showdown/打出触发）。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play a spell, give me +2 :rb_might: this turn."
} satisfies CardProgram;
