import type { CardProgram } from "../../ir/index.js";

/**
 * Kennen, Keeper of Balance (ven-135-166) — Unit, 3 Energy, 2 Might, Order,
 * Yordle/Ionia/Kennen/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-135-166，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   When you play me or I attack, you may pay :rb_energy_2: to [Stun] a unit.
 *   (It doesn't deal combat damage this turn.)
 *   While there's a stunned enemy unit here, I have +2 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 811：[Hidden] 是关键词能力（隐藏与解禁后的免费反应用）；本卡只声明关键词，
 *   展开属 effects/keywords/Hidden.ts（已合入）。
 * - 383.4.a：“When you play me” 是打出触发（card-played，过滤自身）。
 * - 383.4.e / 466.2.c：“I attack” 是攻击触发（attack-declared，过滤来源自身）。
 * - 355.10.c.1：“you may pay [2 Energy] to [Stun a unit]” 是带内嵌代价的可选效果
 *   （可选包装 + 费用 + 效果）；355.13 的“up to”不适用，原文是单个单位。
 * - 424/424.1.a：Stun 把单位渲染为 Stunned（effect.stun 已合入）。
 * - 424.1.b/424.1.c：“It doesn't deal combat damage this turn” 是 Stunned 自身
 *   的规则语义（提示文本），不由卡程序重复实现。
 * - “While there's a stunned enemy unit here, I have +2 [M]”：同地点（053.3 的 here，
 *   用 sameLocationAs 宿主表达）存在 Stunned（424.1.a 的二元状态）的敌方单位（740.1.b）时，
 *   宿主获得 +2 Might 的图层算术修正。状态谓词用已合入的 states 键拼写
 *   （layers/filter.ts 与 events/pipeline-match.ts 的 stateMatches 都读 states；
 *   直接写 stunned: true 会被两处匹配器静默忽略）。
 *
 * status = judge-required（复核 2026-10-17；四处缺口均不近似实现）：
 * 1. [Hidden]（811.1）：KeywordDef 已展开为 static cost.hidden，费用侧也有执行证据——
 *    cost/cost-plan.ts 的 buildHiddenCostPlan 能锁定 hide（1 点任意域 Power，811.1.b）
 *    与 play（忽略 base Energy/Power）两种计划，payHiddenCostPlan 会真实支付；
 *    但展开出的静态半段在生产绑定上 fail-closed——attachProgramLifecycle 的默认
 *    createEngineStaticBinder 对它抛 ProgramBindingError(judge-required,
 *    "Static ability kind cost.hidden has no layer mapping")；且 811.1.c（Hide 是独立
 *    自由行动）、811.1.d（面朝下打出的战场限定）与 811.6（藏起后下一回合获得 Reaction）
 *    的消费链整体缺失：封闭 GameAction 集合没有 hide，ZoneId/ObjectSnapshot 没有
 *    Facedown Zone，turn/flow.ts 的清理对 faceDown 对象直接抛
 *    TurnCombatBlockedError("hidden-cleanup-state")。
 * 2. 740.4.a.2 要求「you may pay :rb_energy_2:」作为触发前置费用在 Finalize 支付：
 *    冻结的 TriggeredAbility 没有 cost 字段，programs/triggers.ts 也不把卡牌的指令内
 *    费用提取成 TriggerRegistration.cost/mayAtFinalize；并且两条触发的 TargetSpec 嵌在
 *    choice.optional 的 body 内，chain/engine.ts 的 assertFinalizationSurface 以
 *    "Nested/repeated targets require an interpreter target-selection lifecycle adapter"
 *    阻断 Finalize（golden 用真实 ChainEngine 复现），触发连入链都到不了结算。
 *    cost.pay 本体已合入并在解释器结算期真实支付（golden 证据），但该结算期支付不能替代
 *    740.4.a.2 的 Finalize 费用。
 * 3. +2 Might 光环：卡牌侧 static 注册已合入（programs/statics.ts 的
 *    createEngineStaticBinder 已是 attachProgramLifecycle 的默认 binder，golden 用真实
 *    绑定注册 arithmetic 图层修正），但条件的相对玩家与位置锚点在图层查询路径上不可求值：
 *    生产查询最终走 layers/filter.ts 的 matchesObjectFilter，controller 只做字面量比较
 *    （"opponent" 永不命中，条件 fail-closed、+2 永不生效），sameLocationAs 完全不被读取
 *    （去掉 controller 门槛后会过度作用到其它战场与友方单位，golden 用实测对照说明）；
 *    programs/statics.ts 的 staticFilter 也只把 sameLocationAs 解析到效果过滤器，
 *    对 controller: opponent 直接抛 judge-required。
 * 4. 生产链的解释器适配器还不能执行本卡自己的 Stun 指令：chain/interpreter-adapter.ts 的
 *    LITERAL_FIELDS 没有登记 effect.stun.target，卡 IR 的 { kind: "constant", value: specId }
 *    会被原语 schema 以 "effect.stun target must be a spec id string" 拒绝（golden 用该适配器
 *    复现；同一指令取字面 spec id 则可执行，证明缺口在适配器表而非原语或卡 IR）。
 * “Stun a unit” 半段用已合入的 effect.stun 在解释器上真实执行（golden 覆盖接受/拒绝对比）。
 */
export default {
  canonicalCardId: "card.hash-6d5c7c18a2ff9af74ab3f4a4b8ac837540733c2922614f53be32ab4e75be8f6b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现（复核 2026-10-17）：" +
    "(1) [Hidden]（811.1）的 KeywordDef 已展开为 static cost.hidden，费用侧也有执行证据——" +
    "buildHiddenCostPlan 能锁定 hide（1 点任意域 Power，811.1.b）与 play（忽略 base Energy/Power）两种计划，" +
    "payHiddenCostPlan 真实支付（golden 用参考内核执行）；但 811.1.c 的 Hide 自由行动、811.1.d 的面朝下打出" +
    "（含战场限定）与 811.6 的下一回合 Reaction 许可仍无执行路径：展开出的静态半段在生产绑定上 fail-closed" +
    "（attachProgramLifecycle 的默认 createEngineStaticBinder 抛 ProgramBindingError(judge-required, " +
    "\"Static ability kind cost.hidden has no layer mapping\")），封闭 GameAction 集合没有 hide，" +
    "ZoneId/ObjectSnapshot 没有 Facedown Zone，turn/flow.ts 的清理对 faceDown 对象抛 " +
    "TurnCombatBlockedError(\"hidden-cleanup-state\")。" +
    "(2) 740.4.a.2 要求「you may pay :rb_energy_2:」作为触发前置费用在 Finalize 支付，但冻结的 " +
    "TriggeredAbility 没有 cost 字段，programs/triggers.ts 也不把卡牌的指令内费用提取成 " +
    "TriggerRegistration.cost/mayAtFinalize；两条触发的 TargetSpec 又嵌在 choice.optional 的 body 内，" +
    "chain/engine.ts 的 assertFinalizationSurface 以 \"Nested/repeated targets require an interpreter " +
    "target-selection lifecycle adapter\" 阻断 Finalize（golden 用真实 ChainEngine 复现该拒绝），" +
    "触发连入链都到不了结算。cost.pay 本体已合入并在解释器结算期真实支付（golden 证据），" +
    "但该结算期支付不能替代 740.4.a.2 的 Finalize 费用。" +
    "(3) “While there's a stunned enemy unit here, I have +2 :rb_might:” 的 static 注册已合入" +
    "（programs/statics.ts 的 createEngineStaticBinder 已是 attachProgramLifecycle 的默认 binder，" +
    "golden 用真实绑定注册 arithmetic 图层修正），但条件的相对玩家与位置锚点在图层查询路径上不可求值：" +
    "生产查询最终走 layers/filter.ts 的 matchesObjectFilter，controller 只做字面量比较" +
    "（740.1.b 的 opponent 永不命中，条件 fail-closed、+2 永不生效），sameLocationAs 完全不被读取" +
    "（去掉 controller 门槛后会过度作用到其它战场与友方单位，golden 用实测对照说明）；" +
    "programs/statics.ts 的 staticFilter 也只把 sameLocationAs 解析到效果过滤器，对 controller: opponent " +
    "直接抛 judge-required。" +
    "(4) 生产链的解释器适配器还不能执行本卡自己的 Stun 指令：chain/interpreter-adapter.ts 的 LITERAL_FIELDS " +
    "没有登记 effect.stun.target，卡 IR 的 { kind: \"constant\", value: specId } 会被原语 schema 以 " +
    "\"effect.stun target must be a spec id string\" 拒绝（golden 用该适配器复现；同一指令取字面 spec id " +
    "则可执行，说明缺口在适配器表而非原语或卡 IR）。" +
    "依赖：Facedown Zone/Hide 动作接线、740.4.a.2 的触发费用与嵌套目标生命周期接线、" +
    "图层查询的相对玩家/位置锚点、适配器的 effect.stun literal 目标登记。" +
    "不近似实现（不换 controller 门槛的写法，也不把 +2 写成无条件修正）。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      // “When you play me … you may pay 2 Energy to Stun a unit.”
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: true,
      body: [
        {
          id: "kennen.play.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 2 Energy to Stun a unit?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "kennen.play.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 2 } } }
                },
                {
                  id: "kennen.play.stun",
                  op: "effect.stun",
                  linkedTo: "kennen.play.pay",
                  args: { target: { kind: "constant", value: "kennen.play.unit" } },
                  targets: [
                    {
                      id: "kennen.play.unit",
                      filter: { type: "unit", zone: "board" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    },
    {
      // “or I attack” 的同一可选效果：独立触发能力，指令 id 互不冲突。
      kind: "triggered",
      trigger: { at: "attack-declared", filter: { event: "attack-declared", filter: { source: "self" } } },
      optional: true,
      body: [
        {
          id: "kennen.attack.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 2 Energy to Stun a unit?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "kennen.attack.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 2 } } }
                },
                {
                  id: "kennen.attack.stun",
                  op: "effect.stun",
                  linkedTo: "kennen.attack.pay",
                  args: { target: { kind: "constant", value: "kennen.attack.unit" } },
                  targets: [
                    {
                      id: "kennen.attack.unit",
                      filter: { type: "unit", zone: "board" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    },
    {
      // “While there's a stunned enemy unit here, I have +2 [M].”
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 2 },
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "stunned-enemy-units-here",
          filter: {
            type: "unit",
            zone: "board",
            controller: "opponent",
            // 424.1.a 的二元状态用已合入的 states 谓词拼写；写成 stunned: true 会被
            // layers/filter.ts 与参考内核静默忽略（恒真），不能表达该门槛。
            states: "stunned",
            sameLocationAs: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me or I attack, you may pay :rb_energy_2: to [Stun] a unit. " +
    "(It doesn't deal combat damage this turn.)\n" +
    "While there's a stunned enemy unit here, I have +2 :rb_might:."
} satisfies CardProgram;
