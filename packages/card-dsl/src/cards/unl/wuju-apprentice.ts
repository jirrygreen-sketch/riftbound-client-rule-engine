import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Wuju Apprentice (unl-040-219) — Unit, 2 Energy, Might 2, Calm, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-040-219，逐字）：
 *   [Hunt] (When I conquer or hold, gain 1 XP.)
 *   [Level 6][>] When you play me, draw 1. (While you have 6+ XP, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - [Hunt]：823.1 的 Triggered Ability 关键词（既是 Conquer 也是 Hold effect，823.1.b）；
 *   823.1.c.1 的功能写法是 “When I Conquer or Hold, my controller gains X XP”，823.1.c.2 规定
 *   省略 X 时按 1（提醒文字同值），823.1.c.3 的 Hunt Value 与 823.2 的求和由关键词文件与注册表负责。
 *   按契约 3.7 / README 第 5 节，卡文件只声明 `{ kind: "keyword", keyword: "hunt" }`。
 * - [Level 6][>]：824.1 的 Dependent Keyword；824.1.a 给出 “［Level [N]]［>] [Text]” 的格式，
 *   824.1.b / 824.1.b.1 说明从关键词到子句结尾整段是 Level Ability，功能上等于“当你有 [N] 点或
 *   更多 XP 时，本牌获得「[Text]」”，824.1.b.2 的 [Text] 是 Dependent Ability；824.1.c 规定只要
 *   控制者有 [N] XP，依赖能力即为 Active（824.1.c.1 换控制者重判、824.1.d 掉到 [N] 以下立即
 *   Inactive）；824.2 说明是否拥有 Level 是可读取特征。本卡的 [Text] 是
 *   “When you play me, draw 1.” 所以依赖能力是一条打出触发（383.4.a / 420.4.a，时点 card-played，
 *   来源为自身）。
 * - “draw 1”：414.1 / 414.3 的抽牌，已合入的 effect.draw 只提交封闭集合里的 draw 动作，
 *   抽牌者缺省为能力控制者（190.6.d 的隐含 “you”）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-16 复核）。
 * 已合入并可执行的部分：
 * - [Hunt] 的 KeywordDef 随 RIFT-265 合入（effects/keywords/Hunt.ts，823.1.c.2 的缺省值 1、
 *   823.2 的求和）；golden 通过关键词展开 + effect.xp 真实执行 conquer 与 hold 两条 1 XP。
 * - RIFT-268 的 Level 关键词只发布 condition.predicate（predicate "level-active"、
 *   query "controller-xp"、threshold），不展开依赖能力文本。
 * 仍缺的缺口：
 * - Hunt 的展开虽有数据，但没有关键字/触发注册的生产方：programs/triggers.ts 把展开结果
 *   翻译成 TriggerSpec 时只认封闭词汇 EVENT_PATTERN_TYPES（"conquered"/"held"），
 *   而 Hunt.ts 写的是 "conquer"/"hold"，validateTriggerSpec 因此抛错（探针确认；同型见
 *   gemhand-hunter 的 TODO），scoring 的 conquer/hold 波也没有把它接进去。
 * - [Level 6][>] 的依赖能力没有绑定：Level.ts 只发布谓词，没有把 Dependent Ability 挂在
 *   关键词实例上的编译形式，Condition 也没有读取控制者 XP 的形态（只有 always/never/
 *   compare/all/any/not/expression，PlayerSnapshot.xp 没有 Expr 路径），824.1.c.1/.d 的
 *   动态 Active/Inactive 无法评估；程序里的 compare 形状只是保留门控，不是求值。
 * 依赖：RIFT-257 后续（卡牌 keyword/触发注册与展开词汇接线，含 Hunt 的 conquered/held
 * 拼写）、RIFT-268 的 Level 展开后续（Dependent Ability 绑定与 XP 谓词求值）。
 * 不近似实现：不手写 Hunt 的 conquer/hold 触发体，也不把 6+ XP 门控删成无条件能力；
 * “draw 1” 本体只用已合入的 effect.draw，golden 用解释器 + 参考内核真实执行。
 */
const abilities: Ability[] = [
  // 823.1.c.2：印刷省略 Hunt Value，按 1 处理。
  { kind: "keyword", keyword: "hunt" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } },
      // 824.1.c 的门控：控制者有 6 点或更多 XP 时依赖能力 Active。
      // 保留形状（见 judgeReason）：合并的 Condition 读不到 PlayerSnapshot.xp。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
    },
    optional: false,
    body: [
      {
        id: "wuju-apprentice.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-e074cc6d861492ad66a59dfbd4aee7f822557cbb0d0e6d32f02e2690c97a07a2",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "已合入并可执行的部分：[Hunt] 的 KeywordDef 随 RIFT-265 合入（823.1.c.2 缺省值 1、823.2 求和），" +
    "golden 用关键词展开 + effect.xp 真实执行 conquer 与 hold 各 1 XP；RIFT-268 的 Level 关键词发布 " +
    "condition.predicate（level-active / controller-xp / threshold 6）。整卡仍缺两处，均不近似实现：" +
    "(1) Hunt 展开没有触发注册的生产方——programs/triggers.ts 翻译 TriggerSpec 时只认封闭词汇 " +
    "EVENT_PATTERN_TYPES 的 \"conquered\"/\"held\"，而 Hunt.ts 写的是 \"conquer\"/\"hold\"，validateTriggerSpec " +
    "会直接抛错（探针确认；同型缺口见 unl/gemhand-hunter），scoring 的 conquer/hold 波也没有接线。" +
    "(2) [Level 6][>] 的 Dependent Ability 没有绑定：Level.ts 只发布谓词，没有把依赖能力挂在关键词实例上的" +
    "编译形式，Condition 也无法读取控制者 XP（只有 always/never/compare/all/any/not/expression，" +
    "PlayerSnapshot.xp 没有 Expr 路径），824.1.c.1/.d 的动态 Active/Inactive 无法评估；程序里的 compare 只是保留门控。" +
    "“draw 1” 本体只用已合入的 effect.draw（414.1/414.3），golden 用解释器 + 参考内核真实执行。" +
    "依赖：RIFT-257 后续（keyword → 触发注册与展开词汇接线）、RIFT-268 的 Level 展开后续（依赖能力绑定与 XP 谓词）。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "[Level 6][>] When you play me, draw 1. (While you have 6+ XP, get the effect.)"
} satisfies CardProgram;

export default program;
