import type { CardProgram } from "../../ir/index.js";

/**
 * Turn to Dust (unl-070-219) — Spell, 2 energy, no printed power, no Might,
 * Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-070-219，逐字）：
 *   "Give a gear [Temporary]. (Kill it at the start of its controller's
 *    Beginning Phase, before scoring.)"
 *
 * 规则依据（CR v1.5）：
 * - 「Give a gear [Temporary]」：把 [Temporary] 关键词授予一个由玩家选择的
 *   装备。「a gear」未特别说明时指 Board 上的对象（355.9.a.1），且由玩家选择
 *   （355.10 的豁免都不适用）→ 目标（355.7 / 355.9）。
 * - 授予关键词属于 ability 图层的持续效果（契约 3.4「关键词授予落在 ability
 *   图层」），不是一次状态改变动作；Temporary 本身的展开（816.1.b：在该永久物
 *   控制者的 Beginning Phase 开始时、计分前消灭它）由关键词注册表负责，卡牌
 *   只声明授予。816.3：是否具有 Temporary 是可读取特征。
 * - 括号内是 Temporary 的释义（816.1.b 的功能等价文本），不是独立指令。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-18 复核），
 * 缺口不近似实现：
 * - 授予本体已可执行：已合入的 continuous.grant-keyword 原语按 478.1.a 在
 *   ability 图层注册关键词授予（816.3：Temporary 是可读取特征），golden 用真实解释器
 *   加图层引擎断言 gear 获得 Temporary 特征；目标选择 / 失效 → ignored 也走已合入路径。
 * - 被授予 [Temporary] 的后续触发不可执行：effects/keywords/Temporary.ts
 *   展开体（816.1.b：在该永久物控制者的 Beginning Phase 开始时、计分前 kill this）本身
 *   可执行，但**授予后的关键词不会进入触发注册**——生产路径里 expandProgram 只消费
 *   卡牌自身声明的 keyword 与已印在对象上的 source.keywords（programs/keywords.ts），
 *   layers 的 continuous.grant-keyword 只把关键词合入特征快照，没有任何订阅方在图层
 *   关键词变化后展开并注册 816.1.b 的触发。已合入的 KeywordGrantLayerEngine
 *   支持运行时关键词展开，但它只展开 static 类关键词能力（触发展开被
 *   “Dynamic triggered keyword abilities need a lifecycle binder” 拒绝），
 *   且该引擎只是可注入组件，生产 TurnFlow 仍装配 layers 的 TurnPhaseLayers，
 *   keywordAbilities() 没有生产调用方。即使接入，展开触发的 filter 事件名
 *   beginning-start 也不在 events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES
 *   词表内（turn/flow.ts 会发出 ${phase}-start），assertTriggerSpec 会以
 *   invalid-event-type 拒绝。依赖：生产图层装配接入运行时关键词 →
 *   TriggerRegistration 的展开与触发型关键词的生命周期绑定，以及 beginning-start
 *   进入 EventPattern 词表。
 */
const turnToDust = {
  canonicalCardId: "card.hash-d499c08d49d46da72e1362f82b24b913abf3b6fbc0e80676cbb858f169d91e75",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give a gear [Temporary]」的授予本体已可执行：816.3 / 契约 3.4 的 ability 图层授予由已合入的 " +
    "continuous.grant-keyword 原语落地，目标选择走 355.7/355.9.a.1 的 TargetSpec，golden 用真实解释器 + 图层引擎断言 gear 获得 Temporary 特征。" +
    "整卡仍不可执行：被授予的 [Temporary] 不会进入触发注册——生产路径里 expandProgram（programs/keywords.ts）只展开卡牌自身声明的 keyword" +
    "与 source.keywords 中已印在对象上的关键词，layers 只在特征快照里合入 continuous.grant-keyword 的结果，没有任何订阅方在运行时关键词出现后" +
    "展开并注册 816.1.b 的「控制者 Beginning Phase 开始时、计分前 kill this」触发。" +
    "已合入的 KeywordGrantLayerEngine 支持运行时关键词展开，但它只展开 static 类关键词能力（触发展开被 " +
    "Dynamic triggered keyword abilities need a lifecycle binder 拒绝），且该引擎只是可注入组件：" +
    "生产 TurnFlow 仍装配 layers 的 TurnPhaseLayers，keywordAbilities() 没有生产调用方。" +
    "即使接入，该展开用的 filter 事件名 beginning-start 也不在 events/trigger-spec.ts 的封闭 " +
    "EVENT_PATTERN_TYPES 词表内（turn/flow.ts 会发出 ${phase}-start），assertTriggerSpec 会以 invalid-event-type 拒绝。" +
    "依赖：生产图层装配接入运行时关键词 → TriggerRegistration 的展开与触发型关键词的生命周期绑定，" +
    "以及 beginning-start 进入事件词表。不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // 816.3 / 契约 3.4：关键词授予是 ability 图层的持续效果；已合入的
          // continuous.grant-keyword 原语注册它（见 judgeReason 的剩余触发缺口）。
          id: "turn-to-dust.grant-temporary",
          op: "continuous.grant-keyword",
          args: { keyword: { kind: "constant", value: "Temporary" } },
          targets: [
            {
              id: "turn-to-dust.gear",
              filter: { zone: "board", type: "gear" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Give a gear [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default turnToDust;
