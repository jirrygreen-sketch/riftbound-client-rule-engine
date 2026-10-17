import type { CardProgram } from "../../ir/index.js";

/**
 * Lady of Luminosity, Starter (ogs-021-024) — Legend, Mind/Order, 标签 Lux/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogs-021-024）：
 *   When you play a spell that costs :rb_energy_5: or more, draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.4.a.4："When you play a spell …" 是触发能力，不是 Play Effect
 *   （383.4.a.4 明确“当另一张牌被打出时触发”的能力不属于 Play Effect）。
 * - 契约 3.5：打出事件由连锁管线在 "card-played" 时点发出
 *   （chain/engine.ts 在 spell/unit/gear resolve 后 emit card-played）。
 * - 206：需要判定费用时必须使用印刷（或复制）费用，与“实际支付/减免”无关；
 *   例中的 Lux 就是本条文本："If a player who controls Lux plays Sky Splitter…"。
 * - 355.10 / 355.10.c：触发条件里的对象不是目标；本能力不选目标。
 * - 414.1 / 414.3："Draw 1." 用已合入的 effect.draw（隐含抽牌者是能力控制者，
 *   190.6.d）。
 * - 174 / 174.7：Legend 可以有 Triggered Ability；107.4.c / 174.2.b：始终留在
 *   Legend Zone。
 *
 * status = judge-required：费用门槛（“costs [5] or more”）仍没有已合入的求值路径——
 * 管线的 TriggerRegistration/PipelineEvent 不携带被打出牌的印刷费用或费用计划，
 * 也没有 "cost-gte" 型谓词过滤器（RIFT-258/259 的持续效果指令不覆盖费用读值）。
 * 触发结构（card-played + 主体 effect.draw）都可执行；但不能在没有费用信息时把门槛
 * 近似成“任意法术”，因此整卡保持 judge-required，golden 只执行已支持的部分
 * （见 judgeReason 与 test.todo）。
 */
const ladyOfLuminosityStarter = {
  canonicalCardId:
    "card.hash-6f04b2b3d826c60923e569bd93f6bfbe953076e0f78f137d2db69f5b53e10948",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "费用门槛「costs :rb_energy_5: or more」仍无法求值：触发过滤器的封闭形状（契约 3.5、" +
    "events/trigger-spec.ts 的 ObjectFilter / EventPattern）只按对象特征、区域、事件载荷与" +
    "amount/details 过滤，PipelineEvent（pipeline-types.ts）不带被打出牌的印刷费用或费用计划，" +
    "也没有 206 所要求的「印刷/复制费用 ≥ 5 Energy」谓词（RIFT-258/259 合入的持续效果指令" +
    "不覆盖费用读值；sfd/sunken-temple.ts 与 sfd/show-of-strength.ts 记录同一判定）。" +
    "触发时点 card-played（chain/engine.ts 已 emit）与效果 effect.draw 都已合入，" +
    "但在拿不到费用时把门槛放宽成「任意法术」就是近似实现，按红线不做。" +
    "另有两点非本卡 write scope 的接线缺口：没有任何生产方把卡牌程序的 triggered " +
    "能力注册为管线 registration（契约 3.5；RIFT-257 的 card-program adapter）；Legend " +
    "的来源区域是 Legend Zone（CR 107.4.c），契约 ZoneId 与参考内核都没有该区域" +
    "（默认 activeZones 为 ['board']）。" +
    "依赖：206 的印刷费用谓词（cost-gte / condition.value）、RIFT-257 卡牌触发注册消费者。" +
    "不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // 被打出的牌必须是法术（355.10：触发条件里的对象不是目标）。
          object: { type: "spell" },
          // "you play"：打出者即本能力控制者（190.6.d）。
          player: "self",
          // 费用的谓词载体：206 的「印刷 Energy 费用 ≥ 5」需要打出事件携带费用快照。
          // details 是 EventPattern 里既有的载荷匹配形状，但当前 card-played 事件
          // （chain/engine.ts 的 emit）不含 printedEnergyCost，因此按当前管线这条
          // 触发永远不会命中——这就是缺口本身，见 judgeReason，不近似成“任意法术”。
          details: { printedEnergyCostAtLeast: 5 }
        }
      },
      optional: false,
      body: [
        {
          id: "lady-of-luminosity.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When you play a spell that costs :rb_energy_5: or more, draw 1."
} satisfies CardProgram;

export default ladyOfLuminosityStarter;
