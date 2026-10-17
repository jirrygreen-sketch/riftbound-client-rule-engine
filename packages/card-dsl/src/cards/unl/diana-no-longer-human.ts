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
 * status = judge-required（2026-10-17 逐条对源码复核；缺口不近似实现）：
 * - 「When you play a spell, give me +2 :rb_might: this turn」已可执行并已实测：
 *   continuous.might + end-of-turn duration 合入；programs/triggers.ts 按单位 activeZones=['board']
 *   注册 card-played 触发，chain 在结算完成时 emit card-played（chain/engine.ts），
 *   过滤用 object: { type: "spell", controller: "self" }；golden 在真实 ChainEngine 上验证了
 *   友方咒语 +2、敌方咒语不触发、以及回合末到期。不能把 +2 改写成 Buff 计数器。
 * - 剩余阻塞仍是 [Ambush]（822）：Ambush KeywordDef 展开出的两条静态声明都无法被程序绑定器
 *   消费——play-location-permission 在 programs/statics.ts 的 layerFor 抛 ProgramBindingError
 *   （"Static ability kind play-location-permission has no layer mapping"），continuous.timing
 *   声明 appliesTo: ["card"] 被静态绑定器以 "Unsupported static appliesTo" 拒绝（两者均实测）；
 *   且 chain.canAct / playDestinationIsLegal 没有消费 play-location-permission 的位置范围。
 *   因此 Diana 无法以 Ambush 时机进入战场，触发也无从发生。
 * 依赖：Ambush 的位置/时机消费方与静态绑定映射。卡内按契约 3.6 使用符号选择器。
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
        object: { type: "spell", controller: "self" }
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
          // “me” 是能力宿主（355.10.g 的“me”不是选目标）；用原语的 appliesTo 选择器。
          appliesTo: { kind: "constant", value: "self" }
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
    "唯一剩余缺口是 CR 822 [Ambush]：KeywordDef 展开出的两条静态声明都无法被程序绑定器消费——" +
    "play-location-permission 在 programs/statics.ts 的 layerFor 抛 ProgramBindingError（\"Static ability kind " +
    "play-location-permission has no layer mapping\"），continuous.timing 的 appliesTo: [\"card\"] 被静态绑定器以 " +
    "\"Unsupported static appliesTo\" 拒绝（两者均实测）；chain.canAct 与 playDestinationIsLegal 也没有消费 " +
    "play-location-permission 的位置范围与 conditional Reaction。因此 Diana 无法以 Ambush 时机进入战场。" +
    "另一半已可执行并已实测：\"When you play a spell, give me +2 :rb_might: this turn\" 由 continuous.might + " +
    "end-of-turn duration 承载，programs/triggers.ts 按单位 activeZones=['board'] 注册 card-played 触发，" +
    "chain 在结算完成时 emit card-played（chain/engine.ts），golden 在真实 ChainEngine 上验证友方咒语 +2、" +
    "敌方咒语不触发与回合末到期；保留 +2 的 arithmetic-layer 形状，不用 Buff 计数器近似。" +
    "依赖：Ambush 的位置/时机消费方与静态绑定映射。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play a spell, give me +2 :rb_might: this turn."
} satisfies CardProgram;
