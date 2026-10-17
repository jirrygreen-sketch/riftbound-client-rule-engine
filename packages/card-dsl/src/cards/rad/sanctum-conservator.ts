import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sanctum Conservator (rad-030-167) — Unit, 5 energy, no printed Power, 5 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-030-167）：
 *   When you play a card with Energy cost :rb_energy_7: or more, ready me.
 *
 * 规则依据（CR v1.5）：
 * - “When you play a card …”：Play Effect（383.4.a；时点 card-played）。与 383.4.a.4 的
 *   “另一个对象被打出时触发”同类，触发订阅的是打出事件本身，不是本单位进场。
 * - “with Energy cost :rb_energy_7: or more”：206 规定“需要确定卡牌费用时一律使用印刷
 *   （或被复制）的费用”，206.1 进一步说明能力费用用基础费用；因此这里的判定基准是被打出
 *   卡牌的印刷能量费用（不是实际支付额）。本卡自身的费用与触发判定无关。
 * - “ready me.”：416.1 的就绪动作；effect.ready 的缺省选择就是能力来源（"ready me"），
 *   已合入。
 *
 * status = executable（2026-10-17 复核）：已合入的事件对象印刷特征谓词
 * （Condition kind "event-printed"）和 chain/engine.ts 的 card-played 印刷快照
 * { energy, power, might } 接到同一条 Play Effect 事件上；触发条件现在直接读取
 * 被打出牌的印刷 Energy 并与 7 比较。生产链执行证据覆盖 >=7 触发与 6 不触发两侧。
 * 事件载荷缺少印刷 energy 时，event-printed 谓词抛 MissingInformation（fail-closed），
 * 不会把缺失值当作 0。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // “you play a card” — 由本控制者打出的牌（不是本单位自己）。
      filter: { event: "card-played", player: "self" },
      // “with Energy cost 7 or more” — 读事件对象的印刷 Energy（206/206.1）。
      condition: {
        kind: "event-printed",
        object: "object",
        characteristic: "energy",
        operator: "gte",
        right: { kind: "constant", value: 7 }
      }
    },
    optional: false,
    body: [
      {
        // “ready me.” — 416.1；effect.ready 的缺省对象是能力来源。
        id: "sanctum-conservator.ready-self",
        op: "effect.ready",
        args: {}
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-6028fb37be26fd7565a2496f62a0ae6299311f364579011da70ce8cdbb0ddd08",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "When you play a card with Energy cost :rb_energy_7: or more, ready me."
} satisfies CardProgram;

export default program;
