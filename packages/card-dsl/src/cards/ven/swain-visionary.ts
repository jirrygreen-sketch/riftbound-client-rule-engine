import type { Ability, CardProgram, Condition, Instruction } from "../../ir/index.js";

/**
 * Swain, Visionary (ven-065-166) — Unit, 6 Energy + 1 Power, 6 Might, Mind,
 * Noxus/Swain/Demon/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-065-166，逐字）：
 *   [Vision] (When you play me, look at the top card of your Main Deck. You may
 *   recycle it.)
 *   When I conquer, if you've played a non-token unit, a non-token gear, and a
 *   spell this turn, you score 1 point.
 *
 * 规则依据（CR v1.5）：
 * - 817 Vision：触发式能力关键词；817.1.b 功能上等同 “When this is played,
 *   [Predict]”，817.1.c 的触发点是该永久物进入 Board。按 README 第 5 节只声明
 *   `{ kind: "keyword", keyword: "vision" }`，展开归 effects/keywords/Vision.ts。
 * - 383.4.c / 383.4.c.1：“When I conquer” 是 Conquer Effect，时点用封闭枚举的
 *   conquer（timing-points.ts，ruleRefs 468.5.d / 471.1 / 473.2.a）；383.4.c.2.c
 *   规定即使征服得分被替代，该触发仍进链，因此不把“得分成功”写成触发条件。
 * - 383.2.a.1：紧跟触发条件的 “if …” 从句属于触发条件本身，在触发时判定，
 *   所以写在 TriggerSpec.condition，而不是 body 里某条指令的 condition。
 * - 383.2.a.1 / 359.3：条件由三部分合取——本回合你打出过非 token 单位、非 token
 *   gear、以及一张法术；“non-token” 是 185.1.a 的 token 性质否定（ObjectFilter
 *   的 isToken: false）。
 * - 470.2 / 194.1.c：“you score 1 point” = effect.score（已合入原语，缺省
 *   得点者为能力控制者，190.6.d 的隐含指向）。
 *
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：HistoryQuery 的 objectFilter/exclude
 * 维度已合入（effects/contract.ts + interpreter/history.ts + 参考内核 matchesFilter，
 * 支持 type/isToken/controller 等），三件套条件可真实求值——golden 用真实 play 动作
 * 写入内核 history 后断言条件由 false 翻转为 true。旧缺口「objectFilter 未落地」
 * 已过时。
 *
 * status = judge-required（当前真实缺口，均不近似实现）：
 * 1. [Vision] 的展开（effects/keywords/Vision.ts）不可执行：其 effect.inspect 在
 *    top scope 缺少上游有序 picksSpecId 时按自身文档直接 negated（契约 3.6 的
 *    zoneSlice 已能按区域顺序读牌库顶，但 inspect 尚未消费它），Predict 的看牌与
 *    可选回收无法完成；且没有已合入的卡牌程序 → 触发注册适配器（RIFT-120）。
 * 2. 征 conquer 触发到链上的生产注册（卡牌程序 → 触发注册适配器，RIFT-120）；
 *    三件套历史条件本身已可求值（objectFilter golden 真实执行）。
 * 依赖：RIFT-357 / RIFT-358（位置选择、有序 picks——Vision 的 inspect top 依赖）、
 * RIFT-120（卡牌触发注册）。征服触发的 effect.score 本体已合入并单独可执行
 * （golden 用真实解释器 + 参考内核执行），但不把缺历史条件的触发当作可执行整卡。
 */

/** 383.2.a.1：紧跟 Condition 的 if 从句属于触发条件，逐项按历史维度表达。 */
const conquerCondition: Condition = {
  kind: "all",
  conditions: [
    {
      kind: "compare",
      left: {
        kind: "count",
        subject: "cards-played-this-turn",
        filter: {
          type: "unit",
          controller: "controller",
          // 185.1.a：token 不能被写成“非 token”；isToken 是描述性记录的否定维度。
          isToken: false
        }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    {
      kind: "compare",
      left: {
        kind: "count",
        subject: "cards-played-this-turn",
        filter: { type: "gear", controller: "controller", isToken: false }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    {
      kind: "compare",
      left: {
        kind: "count",
        subject: "cards-played-this-turn",
        filter: { type: "spell", controller: "controller" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  ]
};

const scoreInstruction: Instruction = {
  id: "swain-visionary.score-1",
  op: "effect.score",
  args: { amount: { kind: "constant", value: 1 } }
};

const abilities: Ability[] = [
  // 817.1.b：Vision 只声明，展开（Predict 的看牌 + 可选回收）归关键词注册表。
  { kind: "keyword", keyword: "vision" },
  {
    // 383.4.c：Conquer Effect；“I”是能力来源本体（053.1）。
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } },
      // 383.2.a.1：if 从句是触发条件，三条历史维度都必须成立。
      condition: conquerCondition
    },
    optional: false,
    body: [scoreInstruction]
  }
];

export default {
  canonicalCardId: "card.hash-4f54fa53d7952e0ddc5664e048b84ba9749234c943d017b1e5038773e2f42b74",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口（复核 2026-10-17）：(1) [Vision]（817.1.b/817.1.c 的 Predict）展开不可执行——" +
    "keywords/Vision.ts 的 effect.inspect 在 top scope 缺少上游有序 picksSpecId 时直接 negated" +
    "（契约 3.6 的 zoneSlice 已合入但 inspect 未消费），看牌与可选回收无法完成，依赖 RIFT-357 / RIFT-358" +
    "（位置选择、有序 picks，进行中）；(2) conquer 触发（383.2.a.1 三件套条件）还没有卡牌程序 → 触发注册的生产适配器（RIFT-120）。" +
    "三件套历史条件本身已可求值：HistoryQuery 的 objectFilter/exclude 已合入（effects/contract.ts、" +
    "interpreter/history.ts、参考内核 matchesFilter），golden 用真实 play 动作写入 history 后断言条件由 " +
    "false 翻转为 true；effect.score 本体也已合入并由 golden 真实执行。不近似实现" +
    "（不把三件套条件降级成动作计数，也不把 Vision 写成手写 Predict）。",
  abilities,
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "When I conquer, if you've played a non-token unit, a non-token gear, and a spell this turn, " +
    "you score 1 point."
} satisfies CardProgram;
