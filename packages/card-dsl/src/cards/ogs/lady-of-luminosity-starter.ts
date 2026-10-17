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
 * status = judge-required（复核 2026-10-17）：费用门槛（“costs [5] or more”）仍没有
 * 已合入的求值路径——chain/engine.ts 的 card-played emission 只带 object/player，
 * PipelineEvent.details 为空，也不存在 206 要求的“印刷/复制费用 ≥ 5 Energy”谓词。
 * 触发结构（card-played + 主体 effect.draw）都可执行；但不能在没有费用信息时把门槛
 * 近似成“任意法术”，因此整卡保持 judge-required，golden 只执行已支持的部分
 * （见 judgeReason 与 test.todo）。Legend 的来源区域缺口同样未合入。
 */
const ladyOfLuminosityStarter = {
  canonicalCardId:
    "card.hash-6f04b2b3d826c60923e569bd93f6bfbe953076e0f78f137d2db69f5b53e10948",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "费用门槛「costs :rb_energy_5: or more」仍无法求值：触发过滤器的封闭形状（契约 3.5、" +
    "events/trigger-spec.ts 的 ObjectFilter / EventPattern）只按对象特征、区域、事件载荷与" +
    "amount/details 过滤；golden 用生产链真实打出的法术事件证明 chain/engine.ts 的 card-played " +
    "emission 只有 object/player，details 为 undefined、也没有费用快照，" +
    "所以本卡 filter 里的 printedEnergyCostAtLeast 永远命中不了（实测 matchesTriggerEvent === false）。" +
    "206 要求的「印刷/复制费用 ≥ 5 Energy」谓词仍没有生产消费者" +
    "（sfd/sunken-temple.ts 与 sfd/show-of-strength.ts 记录同一判定）；拿不到费用时把门槛放宽成" +
    "「任意法术」就是近似实现，按红线不做。" +
    "Legend 的来源区域是 Legend Zone（CR 107.4.c），effects/contract.ts 的 ZoneId 与参考内核都没有该区域，" +
    "programs/triggers.ts 给永久物的 card-played 触发固定 activeZones ['board']，也覆盖不到 Legend 来源。" +
    "触发时点 card-played（chain/engine.ts 已 emit）与效果 effect.draw 都已合入。" +
    "依赖：206 的印刷费用谓词与 card-played 费用载荷、Legend Zone 契约。不近似实现。",
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
