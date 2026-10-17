import type { CardProgram } from "../../ir/index.js";

/**
 * Square Up (unl-017-219) — Spell, 4 energy, Power null, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-017-219，逐字）：
 *   [Repeat] — Discard 1 (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit [Assault 4] this turn. (+4 :rb_might: while it's an attacker.)
 *
 * 规则依据（CR v1.5）：
 * - [Repeat]（820.1.a/820.1.c）：印刷格式 “Repeat [Cost]”，本卡的附加费用是 Discard 1
 *   （423.3：费用式弃牌不可退）；付费后结算时额外执行一次（820.1.d.1），可重新做选择
 *   （820.2/820.2.a）。按 README 第 5 节关键词只声明，展开归 effects/keywords/Repeat.ts。
 * - “Give a unit [Assault 4] this turn”：授予 Assault 4，本回合期限（317.2.c），
 *   807.1.c 的展开归 keywords/Assault.ts；reminder 是同义释义。355.9.a.1 的 “a unit” 是目标。
 *
 * status = judge-required（缺口不近似实现）：
 * - continuous.grant-keyword 已合入，本卡的目标授予可由解释器建立到期的 ability 图层效果；
 *   其后的 Assault attacker designation 谓词仍不能在当前图层条件求值（RIFT-359）。
 * - [Repeat] 的 Discard 1 附加费用以及已支付实例数到打出结算的接线仍缺，不能写固定次数
 *   的额外执行（会把未付费也重复写成事实）。
 * golden 覆盖授予原语真实登记与到期；整卡继续保持 judge-required。
 */
const squareUp = {
  canonicalCardId: "card.hash-e4dc01dd2f105796f021b575a0dcf055c0b996025247706f3605affedf193ce6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) continuous.grant-keyword 已能建立本回合的 Assault 4 " +
    "ability 图层授予，但 Assault 展开要求读取 attacker designation（807.1.c/807.1.d.1），当前条件求值仍不消费该谓词（RIFT-359）；" +
    "(2) [Repeat]（820.1.a/820.1.c，附加费用 Discard 1）的费用声明尚未接入 Finalize，" +
    "也没有把已支付实例数接到打出结算的 repeat 次数，因此不能写固定次数的额外执行。" +
    "契约 3.1 的 keyword/value 仍不足以承载 Repeat 的印刷费用，需由 Repeat 费用接线提供该数据。",
  abilities: [
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      // 印刷 4 Energy；力量无印刷值（catalog power: null），不声明 power。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 }
      },
      body: [
        {
          // “Give a unit [Assault 4] this turn”：授予与期限按 807.1.c / 317.2.c 声明；
          // attacker designation 的条件消费仍由 judgeReason 中的引擎缺口覆盖。
          id: "square-up.grant-assault-4",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 4 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "square-up.unit" } }
          },
          targets: [
            {
              id: "square-up.unit",
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
  sourceText:
    "[Repeat] — Discard 1 (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit [Assault 4] this turn. (+4 :rb_might: while it's an attacker.)"
} satisfies CardProgram;

export default squareUp;
