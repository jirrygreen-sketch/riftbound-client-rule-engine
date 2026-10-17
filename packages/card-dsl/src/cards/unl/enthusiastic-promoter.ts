import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Enthusiastic Promoter (unl-043-219) — Unit, 3 Energy, Might 2, Calm, tags Yordle/Bandle City.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-043-219，逐字）：
 *   [Backline] (I must be assigned combat damage last.)
 *   When I hold, [Buff] all units here. (Give each a +1 :rb_might: buff if it doesn't have one.)
 *
 * 规则依据（CR v1.5）：
 * - [Backline]：826.1 的 Passive Ability 关键词；826.2 出现在单位上；826.3 功能上等于「我必须比
 *   同控制者、没有 [Backline] 的单位更晚被分配致命伤害」，正是提醒文本的 “assigned combat damage
 *   last”；826.4 / 826.4.a / 826.4.b 定义它对战斗伤害分配的改写（多个 Backline 单位之间的自由选择、
 *   以及非 Backline 单位先分配）；826.5 多实例冗余；826.6 是可读取特征。按契约 3.7 / README 第 5 节，
 *   卡文件只声明 `{ kind: "keyword", keyword: "backline" }`，展开（continuous.combat 的分配要求）
 *   由 effects/keywords/Backline.ts 负责；括号内是提醒文本（135.2.d.3 无游戏功能）。
 * - “When I hold”：383.4.d 的 Hold Effect（383.4.d.1 的 “When I hold…” 写法；383.4.d.2 限定此类
 *   触发只属于固守时在场的那个单位，383.4.d.2.a 说明它作为 Pending Item 进链）；时点用封闭表的 hold
 *   （scoring/ 发射，ruleRefs 315.2.b.2 / 471.2 / 473.2.b），filter 以内层 source: "self" 指称本卡
 *   （与 sfd/dunebreaker、ogn/ahri-alluring 同款）。
 * - “[Buff] all units here”：702.2.a 的 Buff 动作（给一个单位放一个 Buff counter，它就处于 Buffed），
 *   已合入的 effect.buff 提交封闭集合里的 buff 动作；702.3 / 702.3.a 规定一个单位同时只能有一个 Buff，
 *   对已经有 Buff 的单位再加“不会发生任何额外事情”（原语的真实行为，也是提醒文本 “if it doesn't have
 *   one” 的含义，427.1.c 说明这类单位仍是合法选择，只是不被 Buff）。
 *   “all units here” 是按特征自动选定的集合、没有可做的选择，因此用 selection: "all" 且 min 0
 *   （355.10.d 的集合写法；ogn/kogmaw-caustic、rad/the-ball 记录同一约定）；“here” 用契约 3.6 的
 *   sameLocationAs 锚点指向来源位置。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（已按合入依赖复核）。
 * - [Backline] 的 KeywordDef 已合入（effects/keywords/Backline.ts），但它的 continuous.combat
 *   声明没有消费方：combat/base-combat-allocation.ts 仍写着 “No Tank/Backline/other assignment-priority
 *   requirement is bound here”，continuous.combat 原语也只返回 negated/impossible，因此 826.3/826.4.a/
 *   826.4.b 的分配顺序要求无处落地。
 * - hold 触发缺少「本卡是在固守的战场上在场的那个单位」的载荷（383.4.d.2/.2.a）：turn/flow.ts 的 scoring
 *   wave 只发 player + details.battlefieldId，没有单位快照；本卡 filter 经 programs/filters.ts 变成对事件
 *   对象的 objectId 过滤，而这类事件没有 object，永远匹配不到（RIFT-31/33）。
 * - 触发体的 “[Buff] all units here” 目标用 sameLocationAs 锚点表达 355.10.d / 053.3 的 here，但
 *   programs/filters.ts 的允许字段集合没有该键并抛 judge-required，生产适配器无法绑定这条触发体
 *   （解释器侧 anchors 已合入，见 effects/interpreter/selectors.ts）。
 * - 卡牌 keyword 能力 → KeywordDef 展开的生产方已合入（programs/keywords.ts expandProgram），
 *   该部分已有正向展开测试。
 * 依赖：战斗伤害分配工作流（826 / continuous.combat 消费方）、RIFT-31/33（scoring 载荷中的固守单位）、
 * programs/filters.ts 的 sameLocationAs 锚点支持。effect.buff 本体与触发体已可用解释器 + 参考内核真实执行。
 * 不近似实现：不把 Backline 写成静态数值，也不把 hold 触发改成别的时点。
 */
const abilities: Ability[] = [
  // 826.3 / 826.5：Backline 不带数值，多实例冗余。
  { kind: "keyword", keyword: "backline" },
  {
    kind: "triggered",
    // `held` is the closed EventPattern spelling; pipeline-match maps it to
    // the `hold` timing point emitted by scoring.
    trigger: { at: "hold", filter: { event: "held", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "enthusiastic-promoter.buff-units-here",
        op: "effect.buff",
        args: {
          // 702.2.a：给选中的单位各放一个 Buff counter。
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: "enthusiastic-promoter.units-here" }
        },
        targets: [
          {
            id: "enthusiastic-promoter.units-here",
            // “all units here”：按特征自动选定的集合（355.10.d），无玩家选择；
            // “here” = 来源所在位置（契约 3.6 的 sameLocationAs 锚点）。
            filter: { zone: "board", type: "unit", sameLocationAs: "self" },
            min: 0,
            max: null,
            selection: "all"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-c887e5d6b316e9709bd403596c8e7217fa050f03dc482385655b7654202cea8d",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1) [Backline]（826.3/826.4）的 KeywordDef 已合入，但整条关键词功能仍不可执行：战斗伤害分配不读取分配优先级要求，" +
    "combat/base-combat-allocation.ts 仍写明 “No Tank/Backline/other assignment-priority requirement is bound here”，" +
    "continuous.combat 原语没有消费方、只返回 negated/impossible，826.4.a/826.4.b 无处落地。" +
    "(2) hold 触发缺少「本卡是在固守的战场上在场的那个单位」的载荷（383.4.d.2/.2.a）：turn/flow.ts 的 scoring wave 只发 player 与" +
    "details.battlefieldId，没有单位快照；本卡 filter 被翻译成对事件对象的 objectId 过滤，而这类事件没有 object，永远匹配不到（RIFT-31/33）。" +
    "(3) 触发体 “[Buff] all units here” 的 TargetSpec 用 sameLocationAs 锚点表达 053.3 的 here，但 programs/filters.ts 的允许字段集合没有该键并抛 " +
    "judge-required，生产适配器无法绑定这条触发体（解释器侧 anchors 已合入，见 effects/interpreter/selectors.ts）。" +
    "已解决：卡牌 keyword 能力 → KeywordDef 展开的生产方（programs/keywords.ts expandProgram）；effect.buff 本体已合入，" +
    "golden 用解释器 + 参考内核真实执行。依赖：826 的 continuous.combat 消费方、RIFT-31/33、programs/filters.ts 的 sameLocationAs 支持。",
  abilities,
  sourceText:
    "[Backline] (I must be assigned combat damage last.)\n" +
    "When I hold, [Buff] all units here. (Give each a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;

export default program;
