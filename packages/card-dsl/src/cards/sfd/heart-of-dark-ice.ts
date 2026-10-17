/**
 * Heart of Dark Ice （sfd-052-221）— Gear，3 energy、power 1（Calm），Might null，Calm，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-052-221）：
 *   ":rb_exhaust:: Give a unit +3 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 151 / 151.2：“:” 之前是费用、之后是效果，Gear 的启动式能力默认在控制者 Main Phase 的
 *   Open State 执行（151.2.a：与打出一张牌同一流程）。费用是横置自身（415.3.a / 415.5，
 *   cost.activated 的 exhaust 支付）。
 * - “Give a unit +3 :rb_might: this turn.” 选中一个单位（355.7/355.10：玩家选择一个单位，
 *   是 Target），在本次结算中给该单位 +3 Might，直到本回合结束（143.2 的临时修改、475/478
 *   的期限与算术层）。这是临时 Might 修改，不是 Buff 计数器（702/703）。
 *
 * status = executable：全部能力都走已合入的真实执行路径。
 * - 启动费用：`cost.activated` 的 `payments: [{ kind: "exhaust", object: "self" }]` 由
 *   cost/plan-values.ts 读成 exhaust 支付动作（415.3.a/415.5），ChainEngine 的 Finalize
 *   真的横置本卡。
 * - 效果：`continuous.might` 指令已合入（RIFT-258）。参数用 `objects` 的符号选择器
 *   `{ kind: "target", id }` 指称链上锁定的目标（契约 3.6），结算时经
 *   ResolveContext.addContinuous 注册 arithmetic 图层效果，duration "this-turn" 映射为本回合
 *   结束到期（317.1.a/468.7.c）；经 chain/interpreter-adapter.ts 的生产适配器验证过该拼写。
 * - 目标：Finalize 锁定的 TargetSpec 由 chain/engine.ts 的 TargetPlan 提供；目标全部失效时
 *   指令按 359.3.e.6 ignored。
 * - 卡牌程序绑定（RIFT-257）已合入：golden 用 createProgramBinding.describeActivate 生成链
 *   草稿、驱动真实 ChainEngine，断言横置费用、+3 有效 Might 与回合结束到期。
 */
export default {
  canonicalCardId: "card.hash-fb2b68d85d71603dc36df01e06a5cedb3afd2385f4545e34f533a975f5db9ffa",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      // “:rb_exhaust::” — 横置自身作为启动费用（415.3.a、415.5）。
      cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] },
      timing: "action",
      body: [
        {
          // “Give a unit +3 :rb_might: this turn.” — 临时 Might 修改（143.2/475/478），
          // 经 continuous.might 注册 arithmetic 图层效果；目标用符号选择器指称。
          id: "heart-of-dark-ice.give-plus-3-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" },
            // 契约 3.6：静态 IR 写符号选择器，不写运行时 ObjectRef。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "heart-of-dark-ice.unit" }
            }
          },
          targets: [
            {
              id: "heart-of-dark-ice.unit",
              // 355.7/355.10：“a unit” 是玩家选择一个单位的目标（不限控制者）。
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: ":rb_exhaust:: Give a unit +3 :rb_might: this turn."
} as const;
