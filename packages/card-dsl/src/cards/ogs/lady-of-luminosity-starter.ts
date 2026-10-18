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
 * status = judge-required：RIFT-359 已合入 card-played 的印刷费用快照与
 * event-printed 谓词；费用门槛现在通过 trigger.condition 判定，并由真实打出、
 * 支付及抽牌测试覆盖。剩余缺口是 Legend Zone（107.4.c / 174.2.b）尚无 ZoneId，
 * programs/triggers.ts 的永久物 card-played activeZones 仍固定为 ['board']。
 * 不把 Legend 放到 Board 来宣称整卡可执行。
 */
const ladyOfLuminosityStarter = {
  canonicalCardId:
    "card.hash-6f04b2b3d826c60923e569bd93f6bfbe953076e0f78f137d2db69f5b53e10948",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Legend Zone 来源区域仍未合入：CR 107.4.c / 174.2.b 要求 Legend 留在 Legend Zone，" +
    "effects/contract.ts 的 ZoneId 尚无该区域，programs/triggers.ts 的永久物 card-played 注册固定 activeZones ['board']。" +
    "费用门槛已可执行：card-played 携带 printed cost 快照，trigger.condition 用 event-printed 判定 Energy >= 5（CR 206），" +
    "真实链测试覆盖 4/5/6 费、非自己打出、非 spell、以及实际支付增减仍读取印刷费用；effect.draw 真实抽 1。" +
    "依赖：Legend Zone 契约与来源区域注册；不把 Legend 的区域近似为 Board。",
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
          player: "self"
        },
        // CR 206: read the immutable printed/copied cost, not the paid amount.
        condition: {
          kind: "event-printed",
          object: "object",
          characteristic: "energy",
          operator: "gte",
          right: { kind: "constant", value: 5 }
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
