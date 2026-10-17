import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Vilemaw (unl-060-219) — Unit, 8 Energy + 2 Calm Power, Might 8，Calm，
 * tag Shadow Isles/Spider。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-060-219，逐字，含换行）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)
 *   Enemy units here with less Might than me don't deal combat damage.
 *   When I hold, draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 822.1 / 822.1.a-c：印刷的 [Ambush]（被动关键词）：可被打到"你有单位的战场"，
 *   且如此打出时具有 [Reaction]；它通过给 349 的 Make Relevant Choices 增加合法的
 *   打出地点来生效。卡牌只声明 keyword，展开归 effects/keywords/ 与链的合法位置校验。
 * - 467.2 / 467.2.c：战斗伤害步骤中，各玩家按自己单位的 Might 总和给对方的单位分配伤害；
 *   "Enemy units here with less Might than me don't deal combat damage." 是对**分配总量**
 *   的改写：那些单位的 Might 不计入其控制者本次可分配的伤害（467.2.a/b 的求和）。
 * - 355.9.a.1 / 355.9.b / 359.3.f.1："Enemy units here" 是 Board 上由对手控制的、与来源
 *   同一地点的单位；"with less Might than me" 是候选对象与来源的**关系比较**。
 * - 758.2.a 的示例文本正是本卡与 Alpha Wildclaw（关系随 Might/位置的动态变化）。
 * - 383.4.d / 383.4.d.2.a："When I hold, draw 1." 是 Hold Effect（时点 hold），
 *   body 是已合入的 effect.draw（414.1/414.3，抽牌者按 190.6.d 隐含为能力控制者）。
 *
 * status = judge-required（缺口不近似实现，2026-10-17 复核）：
 * - "Enemy units here with less Might than me don't deal combat damage." 仍无可执行形态，两处实测：
 *   （a）没有消费方：契约 3.6 的封闭 GameAction 集合没有"禁止/改写某单位造成的战斗伤害"的动作，
 *   combat/flow.ts 的 dealDamage 仍以 TurnCombatBlockedError("simultaneous-damage-transaction") 阻断，
 *   LayerEngine/programs 也没有 continuous.combat 的查询或结算消费方；而且 programs/statics.ts 的
 *   staticFilter 对本卡 filter 直接抛 "Static controller:opponent filter needs a relative-player query"
 *   （sameLocationAs 已能绑成具体地点，controller:opponent 仍缺相对玩家查询），静态声明连登记都做不到。
 *   （b）"with less Might than me" 是候选单位与来源的关系比较：ObjectFilter 的取值是静态数据，
 *   没有与另一对象比较 Might 的写法，condition 从句只作用于整条指令、不能过滤集合成员；
 *   程序用 mightLt 占位键记录该谓词，实测 layers/filter.ts 的 matchesObjectFilter 不读该键
 *   （9 Might 与 1 Might 的候选都匹配），因此该过滤绝不能当作已求值语义。
 * - [Ambush] 的 KeywordDef 已合入并展开为 play-location-permission 与条件 Reaction 两个静态声明，
 *   但 createEngineStaticBinder 对前者抛 "no layer mapping"、对后者抛 "Unsupported static appliesTo [\"card\"]"，
 *   822.1.b 的运行期地点选择/Finalize 重检与 Reaction/canAct 消费仍未接线。
 * - hold 触发缺少"本卡参与该次固守"的时点载荷：383.4.d.2/.2.a 要求 Hold Effect 绑定
 *   固守时在场的那个单位，而 turn/flow.ts 的 scoring 只发 { player, details: { battlefieldId } }；
 *   实测同一 filter 对真实载荷不匹配（false），只有人工把 object 绑进事件才匹配（true），
 *   触发注册适配器虽已合入，但缺少能匹配本卡参与者的 hold 载荷（事件名词表拼写已按事件词汇
 *   改用 held，hold 拼写会被 validateTriggerSpec 以 invalid-event-type 拒绝）。
 * golden 对已合入的 effect.draw 子句做真实执行，其余保持 todo。
 *
 * 依赖：战斗伤害禁改/分配消费方与关系比较谓词（含静态相对玩家过滤）、Ambush 的地点与 Reaction 消费、
 * hold 参与者载荷。
 */

const abilities: Ability[] = [
  // 822.1：印刷的 [Ambush]；卡只声明，不重写展开。
  { kind: "keyword", keyword: "ambush" },
  {
    // 467.2.c：禁止同地点的弱小敌方单位造成战斗伤害；保留形状（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "continuous.combat",
      mode: "damage-assignment",
      // 被改写的量：这些单位的 Might 不计入其控制者本次可分配的伤害（467.2.a/b）。
      damage: "assignment-total",
      forbidden: "combat-damage",
      filter: {
        // 355.9.a.1 / 355.9.b / 359.3.f.1："Enemy units here"。
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: "source",
        // "with less Might than me"：与来源的关系比较；合并过滤器不读该键，
        // 这里仅作待接线的谓词名（见 judgeReason）。
        mightLt: { kind: "self" }
      }
    }
  },
  {
    // 383.4.d："When I hold" 的 Hold Effect。时点 id 是 hold，但事件词表（可匹配/可校验的事件名）
    // 是 held（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）；实测 hold 拼写在
    // validateTriggerSpec 中直接被拒（invalid-event-type），held 通过。
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "held", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "vilemaw.draw-one",
        // 414.1/414.3："draw 1"，抽牌者缺省为能力控制者（190.6.d）。
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-2b655c9a9276c875f358aa5f0d210f00af256c6ead948f0a83c749f11739dcce",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）『Enemy units here with less Might than me don't deal combat damage.』无可执行形态：" +
    "契约 3.6 的封闭 GameAction 集合没有禁止/改写某单位造成战斗伤害的动作，combat/flow.ts 的 dealDamage 仍以 " +
    "TurnCombatBlockedError(\"simultaneous-damage-transaction\") 阻断，LayerEngine/programs 也没有 continuous.combat 的查询或结算消费方；" +
    "而且 programs/statics.ts 的 staticFilter 对本卡 filter 直接抛 \"Static controller:opponent filter needs a relative-player query\"，静态声明连登记都做不到。" +
    "『with less Might than me』是候选单位与来源的关系比较：ObjectFilter 取值是静态数据、没有与另一对象比较 Might 的写法，" +
    "condition 从句只作用于整条指令、不能过滤集合成员；程序用 mightLt 占位键记录该谓词，实测 layers/filter.ts 的 matchesObjectFilter 不读该键" +
    "（9 Might 与 1 Might 的候选都匹配），绝不能当作已求值语义。" +
    "（2）[Ambush] 的 KeywordDef 已合入并展开为 play-location-permission 与条件 Reaction 两个静态声明，但 createEngineStaticBinder 对前者抛 " +
    "\"no layer mapping\"、对后者抛 \"Unsupported static appliesTo [\\\"card\\\"]\"，822.1.b 的运行期地点选择、Finalize 重检与 Reaction/canAct 消费仍未接线。" +
    "（3）hold 触发缺少『本卡参与该次固守』的时点载荷（383.4.d.2/.2.a 要求绑定固守时在场的那个单位，" +
    "而 turn/flow.ts 的 scoring 只发 player + details.battlefieldId）；实测同一 filter 对真实载荷不匹配，只有人工把 object 绑进事件才匹配。" +
    "effect.draw 本体已合入，golden 对『draw 1』子句做真实执行。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "Enemy units here with less Might than me don't deal combat damage.\n" +
    "When I hold, draw 1."
} satisfies CardProgram;
