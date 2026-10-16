import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shadow Watcher (unl-037-219) — Unit, 4 Energy + 1 power, Might 5, Calm, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-037-219，逐字）：
 *   If a friendly unit died during your Beginning Phase this turn, I enter ready.
 *
 * 规则依据（CR v1.5）：
 * - “I enter ready”：单位默认横置入场（143.4 / 359.2.c），369.3 的官方示例（Master Yi, Honed
 *   “I enter ready.”）说明这是入场替代效果——把“横置入场”这个事件替换成“就绪入场”的事件，
 *   并明示这属于「描述单位如何入场」的替代效果族。按契约 3.1 的 replacement 形状表达。
 *   不能用事后的 effect.ready 近似：effect.ready 的文档明确它不参与入场替代、也不会对已就绪对象
 *   补发“成为就绪”事件，用它冒充会多出一次对象状态变化。
 * - “If a friendly unit died during your Beginning Phase this turn”：369.3 说明入场替代由
 *   “describing how the unit enters” 识别，条件写在替代能力自身的 condition 上（与
 *   sfd/dunebreaker 的“手牌 ≤ 2 张”、sfd/xin-zhao-vigilant 的“基地里 2 个其他单位”同款形状）。
 *   需要的读数有两部分：(a) 本回合死亡记录中，有单位在你的 Beginning Phase 期间被消灭——
 *   315.2 定义 Beginning Phase、315.2.a / 315.2.a.1 是它的 Beginning Step；对象的“死亡”是
 *   object-killed（429.1 / 429.1.a）。(b) “friendly” = 由你控制（740.1.a 的 the controller 视角）。
 *   冻结的 HistoryQuery 只有 scope / action / timingPoint / player / object，没有玩家的行动历史
 *   窗口，也没有“事件发生在某阶段内”的范围键，count 表达式又只数当前集合对象、不查历史台账。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 入场替代没有消费方：events 侧有替代注册表，但没有读取 CardProgram 的 replacement 能力并注册的
 *   入口（契约 3.1 replacement → 事件管线替代注册的适配路径未合入；sfd/breakneck-mech、
 *   sfd/vayne-hunter、sfd/dunebreaker 记录同一批次缺口）。
 * - 条件无法诚实求值：需要「本回合 + 你的 Beginning Phase 内 + 有友方单位被消灭」的历史窗口，
 *   冻结的 Condition/HistoryQuery 表达不了（没有阶段范围的死亡台账读取入口），count 只数当前集合。
 * 依赖：RIFT-9（replacement.enter 系列）、RIFT-120（链与事件单管线）与阶段范围的历史查询。
 * 不近似实现：不用事后 effect.ready 代替入场替代，也不把条件写成常量。
 * golden 的 test.todo 记录了缺口；effect.ready 本体已合入并在其它卡中真实执行过。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // 143.4 / 359.2.c / 369.3：把本单位的横置入场替换为就绪入场。
    replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
    // 条件形状：本回合你的 Beginning Phase 内有友方单位被消灭。
    // count 只是保留形状（见 judgeReason）：冻结的 HistoryQuery 没有“事件发生在某阶段内”的范围键，
    // 也没有玩家侧死亡台账的读取入口。
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "friendly-units-died-during-your-beginning-phase-this-turn",
        filter: { type: "unit", controller: "self" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    with: [
      {
        id: "shadow-watcher.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-914ae0a53b785c0cddd76d977413c9c36d1bc8a2bd78e0f3a1d68a71ae5f718e",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口，均不近似实现：(1) “I enter ready” 是入场替代（143.4 / 359.2.c；369.3 的官方示例 Master Yi, Honed），" +
    "但缺 replacement.enter 的消费方：events 侧有替代注册表，却没有读取 CardProgram replacement 能力并注册的入口" +
    "（契约 3.1 replacement → 事件管线替代注册的适配路径未合入，sfd/breakneck-mech、sfd/vayne-hunter、sfd/dunebreaker 记录同一缺口）；" +
    "用事后 effect.ready 近似会多出一次状态变化（effect.ready 文档明确不参与入场替代）。(2) 条件 " +
    "“If a friendly unit died during your Beginning Phase this turn” 无法诚实求值：需要“本回合 + 你的 Beginning Phase" +
    "（315.2 / 315.2.a / 315.2.a.1）内 + 有友方单位被消灭（429.1 / 429.1.a）”的历史窗口，" +
    "冻结的 HistoryQuery 只有 scope/action/timingPoint/player/object，没有阶段范围键与玩家侧死亡台账入口，" +
    "count 表达式只数当前集合对象。依赖：RIFT-9（replacement.enter 系列）、RIFT-120（链与事件单管线）" +
    "与阶段范围的历史查询。effect.ready 本体已合入，golden 对其保留 test.todo 并在此说明缺口。",
  abilities,
  sourceText: "If a friendly unit died during your Beginning Phase this turn, I enter ready."
} satisfies CardProgram;

export default program;
