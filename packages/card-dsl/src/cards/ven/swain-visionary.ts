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
 * 复核（2026-10-17 M2 覆盖率持续复核；结论以源码与本任务 golden 实测为准）：
 * HistoryQuery 的 objectFilter 维度、condition.history/condition.predicate 原语、conquer
 * 触发的注册适配器（registerProgramTriggers + 生命周期接线）都已合入，effect.score 与
 * condition.history 都有真实执行证据；本卡在本次复核中把触发 filter 的事件判别词改为封闭
 * 词表的 "conquered"（原 "conquer" 被 assertTriggerSpec 以 invalid-event-type 拒绝）。
 * 整卡仍不能 executable：
 * 1. [Vision]（817.1.b/817.1.c 的 Predict）展开体不可绑定也不可执行：keywords/Vision.ts 的
 *    自进场 filter 用 "object.id" 键，programs/filters.ts 的 translateObjectFilter 以
 *    "Unsupported filter field object.id" 拒绝，registerProgramTriggers 直接失败；
 *    展开体的 effect.inspect 在 scope "top" 需要上游有序 picks 绑定 <picksSpecId>，而它自身没有
 *    声明任何带 zoneSlice 的 PickSpec——本任务实测 finalizeOrderedPickPlans(expanded.body)
 *    返回 0 个计划，inspect 以 inspected: 0 执行；player 仍是常量 "A" 占位。
 *    这是关键词展开的生产接线缺口（filter 键与有序 top picks），不在本卡内近似实现。
 * 2. 卡内三件套条件无法求值：383.2.a.1 的 “if you've played a non-token unit, a non-token
 *    gear, and a spell this turn” 用 count + subject "cards-played-this-turn" 记录，但
 *    effects/interpreter/expr.ts 的 count 只调用 query(filter)，不消费 subject；本任务实测
 *    subject 被忽略、现场集合查询把「仍拿在手里」的牌也计入（3 张手牌即让合取为 true），
 *    所以条件既不读打出历史、也会把未打出的牌算进去。Condition 词表里没有
 *    「本回合打出过某类别」的谓词；要用 condition.predicate/result 表达需要新的谓词契约。
 * 3. 征服触发的单位身份：conquer 事件由 turn/flow.ts 的 scoring 发射，只带 player +
 *    details.battlefieldId（没有 object）；translateTriggerFilter 把 source: "self" 解析成
 *    pattern.object = { objectId }，本任务实测按真实载荷匹配为 false、补上对象后才为 true。
 * 依赖：（a）Vision 展开的 filter 键与有序 top picks 生产接线；（b）本回合打出历史的触发
 * 条件谓词；（c）conquer/held 事件的单位身份载荷。
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
      // 封闭判别词是 "conquered"（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES
      // 与 pipeline-match.ts 的 conquered → conquer 映射）；TimingPoint 仍是 "conquer"。
      filter: { event: "conquered", filter: { source: "self" } },
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
    "三处当前缺口（复核 2026-10-17；均不近似实现）：" +
    "(1) [Vision]（817.1.b/817.1.c）的展开体不可绑定也不可执行：keywords/Vision.ts 的自进场 filter 使用 " +
    "\"object.id\" 键，programs/filters.ts 的 translateObjectFilter 以 \"Unsupported filter field object.id\" 拒绝，" +
    "registerProgramTriggers 直接失败；即便绕过 filter，展开体的 effect.inspect 也没有声明任何带 zoneSlice 的" +
    "有序 PickSpec，本任务实测 finalizeOrderedPickPlans(expanded.body) 返回 0 个计划、inspect 以 inspected: 0 执行，" +
    "player 仍是常量 \"A\" 占位，看牌与可选回收无法完成。" +
    "(2) 卡内三件套条件无法求值：count 表达式只消费 filter，effects/interpreter/expr.ts 不读 subject；" +
    "本任务实测 subject: \"cards-played-this-turn\" 被忽略、现场集合查询把手牌里的牌也计入（3 张手牌即让合取为 true），" +
    "Condition 词表也没有「本回合打出过某类别」的谓词（383.2.a.1）。" +
    "(3) 征服触发的单位身份：turn/flow.ts 的 scoring 只发射 { player, details: { battlefieldId } }（无 object），" +
    "translateTriggerFilter 把 source: \"self\" 解析成 pattern.object = { objectId }，" +
    "本任务实测按真实载荷匹配为 false、补上对象后才为 true。" +
    "已修：触发 filter 的事件判别词改为封闭词表的 \"conquered\"（原 \"conquer\" 被 assertTriggerSpec 以 invalid-event-type 拒绝）。" +
    "已合入且有执行证据：effect.score（470.2）真实加分；HistoryQuery / condition.history 原语（objectFilter/isToken 维度）" +
    "真实执行；conquer 触发的注册适配器与 lifecycle 接线都已合入。" +
    "依赖：Vision 展开的 filter 键与有序 top picks 生产接线、本回合打出历史的触发条件谓词、scoring 事件的单位身份载荷。",
  abilities,
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "When I conquer, if you've played a non-token unit, a non-token gear, and a spell this turn, " +
    "you score 1 point."
} satisfies CardProgram;
