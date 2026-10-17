/**
 * Edge of Night (sfd-139-221) — Gear, 3 energy, Might 2, Chaos, tag Equipment.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-139-221）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *    When you play this from face down, attach it to a unit you control here.
 *    [Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 811 / 811.1：Hidden 是执行 Hide 自由行动的前提关键词；811.1.b 规定它功能上等价于
 *   "While this card is in your hand or in your Champion Zone on your turn during an Open
 *   State, you may pay [A] to hide this facedown at a battlefield you control … Beginning on
 *   the next turn, this gains [Reaction] and you may play this, ignoring its base cost."。
 *   卡只声明 { kind: "keyword", keyword: "hidden" }；展开归 effects/keywords/Hidden.ts。
 * - 383.4.a / 383.4.a.1 / 383.4.a.2："When you play this …" 是 Gear 的 Play Effect，对应
 *   时点 card-played，filter 指向本卡自身；811.1.d.3 规定从面朝下打出的
 *   永久物的 Play Effect 若指定目标，必须从它被打到的战场中选择。
 * - "attach it to a unit you control here"（435/818.1.b.2；"here" = 本卡被打到的战场，
 *   359.3.f.1 的 referent）是一条附着指令，用已合入的 effect.attach，目标为你控制的单位
 *   且与本卡同战场（契约 3.6 的 sameLocationAs 锚点）。
 * - 818.1 / 818.1.b / 818.1.c / 818.1.c.2：印刷的 [Equip] :rb_rune_chaos: 是启动式能力
 *   关键词，费用为 1 点 Chaos Power（135.2.e.4），沿用同目录约定记 value 1 + costDomain。
 *
 * status = judge-required（依赖未合入，不近似实现）：
 * - Hidden 的展开（effects/keywords/Hidden.ts）只声明 static cost.hidden，且没有任何已合入的
 *   消费方：Hide 行动、Facedown Zone 存储与"从面朝下打出"的流程都还没有落地（CR 811.1.b/
 *   811.1.c.3），card-played 载荷也无法判定打出前是否面朝下。cost/cost-plan.ts 的
 *   buildHiddenCostPlan 只覆盖费用侧（hide = 1 点任意域 Power，play = 忽略 base resources）。
 * - 从面朝下打出的入场位置与目标限制（811.1.d.1 / 811.1.d.3）仍需 Facedown
 *   位置绑定（RIFT-357）；programs/filters.ts 的目标翻译不接受 sameLocationAs，
 *   而 programs/statics.ts 的静态过滤器已支持该锚点，不能把两条路径混为一谈。
 * - Equip 的启动费用仍不可支付：已合入 Equip 展开声明 payments: [{ kind: "equip" }]，
 *   而 cost/plan-values.ts 的 readCost 没有该支付种类，buildCostPlan 实测抛
 *   CostPlanError（reason "judge-required"，message "Unsupported payment kind: equip"）。
 * 与同目录已合入装备程序（long-sword / bf-sword / warmogs-armor / dorans-blade / sacred-shears）
 * 一致：关键词上的 costDomain 是扩展字段，因此本文件按这些文件的写法用
 * as const 声明，由 golden 的 validateCardProgram 做结构校验（不是用类型断言绕过契约）。
 */
export default {
  canonicalCardId: "card.hash-8c103a7762e84199cb05a20d7107bd2ceb136e632e7df30beaaf4e7629b544da",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "（1）Hidden 的 cost.hidden 尚无 Hide 行动、Facedown 存储及下一回合打出许可的运行时消费者（CR 811.1.b/811.1.c）；" +
    "card-played 载荷也未提供打出前区域，无法约束 play this from face down；" +
    "（2）811.1.d.1/811.1.d.3 的战场绑定仍缺（位置选择 RIFT-357），programs/filters.ts 的目标翻译不接受 sameLocationAs；" +
    "（3）Equip 的印刷 Chaos 费用未传入 KeywordDef.params.cost，Equip.expand 仍使用费用计划不支持的 equip 支付种类（818.1.c.2）。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "triggered",
      trigger: {
        // 383.4.a.1：Gear 的 Play Effect，filter 指向本卡自己的打出事件。打出前是否
        // 面朝下（811.1.c.3）没有可判定的载荷，见 judgeReason 第 1 点。
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "edge-of-night.attach-on-play",
          // 435.1 / 818.1.b.2：把本卡附着到所选单位。objects 缺省即能力来源自身。
          op: "effect.attach",
          args: {
            host: { kind: "constant", value: { kind: "target", id: "edge-of-night.controlled-unit-here" } }
          },
          targets: [
            {
              id: "edge-of-night.controlled-unit-here",
              // "a unit you control here"：控制器用冻结的 PlayerSelector "self"，"here"
              // 用契约 3.6 的 sameLocationAs 锚点；两者的运行时绑定见 judgeReason。
              filter: {
                type: "unit",
                controller: "self",
                zone: "board",
                sameLocationAs: "self"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Chaos" }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play this from face down, attach it to a unit you control here.\n" +
    "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
} as const;
