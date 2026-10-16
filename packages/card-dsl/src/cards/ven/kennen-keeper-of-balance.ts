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
 * - “While there's a stunned enemy unit here, I have +2 [M]”：同地点（sameLocationAs
 *   宿主）存在 Stunned 的敌方单位时，宿主获得 +2 Might 的图层算术修正。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. [Hidden] 的展开虽然有 KeywordDef（RIFT-264 批次），但其消费方缺失——Hidden.ts
 *    自己记录 cost.hidden / cost.pay / effect.zone / continuous.timing 都未合入，
 *    Hide 动作与面朝下区域的免费打出许可没有执行路径；
 * 2. “you may pay :rb_energy_2:” 需要 cost.pay 原语，effects/instructions/ 下没有该
 *    文件（费用种类与 cost.pay / cost.modify 属未合入的 RIFT-261 批次）；
 * 3. “While there's a stunned enemy unit here, I have +2 [M]” 需要卡牌侧 static
 *    效果进入 layers 的注册/求值入口：RIFT-257 的 attachProgramLifecycle 只把
 *    static 交给调用方 binder（缺省 noopStaticBinder），engine-core 内没有把
 *    static 数据转成 ctx.addContinuous 的实现；condition 也只有 compare/all/any/
 *    not/expression 五类（没有 stunned 状态谓词），layers 过滤器的 sameLocationAs
 *    锚点也未接线。
 * “Stun a unit” 半段用已合入的 effect.stun 真实执行（golden 覆盖接受/拒绝对比）。
 */
export default {
  canonicalCardId: "card.hash-6d5c7c18a2ff9af74ab3f4a4b8ac837540733c2922614f53be32ab4e75be8f6b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) [Hidden] 的 KeywordDef 已合入但没有消费方——Hidden.ts 记录 cost.hidden / " +
    "cost.pay / effect.zone / continuous.timing 均未合入，Hide 动作与面朝下区域的免费打出许可无" +
    "执行路径；(2) “you may pay :rb_energy_2:” 需要 cost.pay 原语，effects/instructions/ 下没有" +
    "该文件（费用种类/支付属 RIFT-261）；(3) “While there's a stunned enemy unit here, I have " +
    "+2 :rb_might:” 的 static continuous.might 没有进入 layers 的注册方（RIFT-257 的 attachProgramLifecycle " +
    "只调用调用方 binder，缺省 noopStaticBinder），且 Condition 无 stunned 状态谓词、图层过滤器不读 " +
    "sameLocationAs。依赖 RIFT-261（费用/支付）、RIFT-257（static 效果→layers 接线）与 RIFT-87（条件/谓词）。" +
    "“Stun a unit” 半段用已合入的 effect.stun 真实执行。",
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
                  args: { energy: { kind: "constant", value: 2 } }
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
                  args: { energy: { kind: "constant", value: 2 } }
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
            stunned: true,
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
