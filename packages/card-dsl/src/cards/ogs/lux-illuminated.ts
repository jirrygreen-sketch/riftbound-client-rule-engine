import type { CardProgram } from "../../ir/index.js";

/**
 * Lux, Illuminated (ogs-006-024).
 * CR v1.5 206 explicitly cites Lux: compare the played spell's printed/copied
 * Energy cost, irrespective of cost increases, reductions or ignored costs.
 * The card-played event supplies details.printed; event-printed tests >= 5 in
 * the trigger condition (383.2.a.1), with an explicit spell/player filter.
 * continuous.might supplies +3 in the arithmetic layer until turn expiration
 * (143.2, 478.1.a, 317.1.a).
 *
 * Remaining judge gaps (both are engine paths, not card semantics):
 * 1. The program registry rejects judge-required programs, so the production
 *    lifecycle cannot bind this trigger from a Board source until the card is
 *    executable as a whole.
 * 2. "When you play a spell..." applies on every qualifying play in the turn,
 *    but the chain interpreter's continuous.might settlement counter is
 *    written under an instruction-qualified key and read back unqualified
 *    (continuous.might:settlement-1 collision), so a second registration in
 *    one turn throws "Continuous effect already registered" (same shared
 *    interpreter defect recorded on ven/fretful-feline). The golden records
 *    the real gate, payment and first grant, plus the second-play collision.
 */
export default {
  canonicalCardId: "card.hash-c2754bbf1ee513e71200b5c341447c73af45af5ba81a41efde12ac2d348cbcd8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "依赖已合入：card-played 事件的 details.printed 快照、event-printed >= 比较条件、" +
    "spell/player 触发过滤（383.2.a.1）与 continuous.might 的 this-turn 到期注册" +
    "（143.2/478.1.a/317.1.a）均有真实执行证据。当前缺口是引擎路径而非卡语义：" +
    "（1）registry.get 拒绝 judge-required 程序，生产 lifecycle 无法从 Board 源绑定该触发；" +
    "（2）同一回合第二次触发重复授予 +3 时，链解释器的 continuous.might settlement 计数" +
    "写入指令限定键、读取非限定键，第二次注册撞 continuous.might:settlement-1 抛 " +
    "\"Continuous effect already registered\"（与 ven/fretful-feline 同一共享解释器缺陷）。" +
    "不近似限制每回合触发次数。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", object: { type: "spell" }, player: "self" },
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
          id: "lux-illuminated.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a spell that costs :rb_energy_5: or more, give me +3 :rb_might: this turn."
} satisfies CardProgram;
