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
 * - 本回合关键词授予没有卡牌侧入口：effects/instructions/ 没有 continuous.grant-keyword
 *   原语（与 ogn/cleave、ogn/back-to-back、ven/heart-of-the-tempest 同缺口，依赖 RIFT-91 / RIFT-9）。
 * - Assault 的展开是条件于宿主 attacker designation 的 static continuous.might，designation
 *   尚未进入 ObjectSnapshot。
 * - [Repeat] 的附加费用（Discard 1）没有接线：Repeat.ts 的 static repeat.cost 没有消费方，
 *   cost.additional / cost.discard 未合入（RIFT-86 / RIFT-89），也没有把已支付实例数接到
 *   解释器 repeat 指令的打出管线；不写固定 count 的额外执行（会把未付费也重复写成事实）。
 * 本卡没有可独立执行的正文指令，golden 只做校验、结构断言与缺口 todo。
 */
const squareUp = {
  canonicalCardId: "card.hash-e4dc01dd2f105796f021b575a0dcf055c0b996025247706f3605affedf193ce6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1)「Give a unit [Assault 4] this turn」需要带 end-of-turn 期限的连续关键词授予，" +
    "但 effects/instructions/ 没有 continuous.grant-keyword（或 continuous.keyword）原语（同 cleave / back-to-back / " +
    "heart-of-the-tempest 的缺口，依赖 RIFT-91 与 RIFT-9）；(2) 即使授予落地，Assault 的展开（keywords/Assault.ts，807.1.c）" +
    "是条件于宿主 attacker designation 的 static continuous.might，该特征尚未进入 ObjectSnapshot；" +
    "(3) [Repeat]（820.1.a/820.1.c，附加费用 Discard 1）没有接线：Repeat.ts 的 static repeat.cost 没有消费方，" +
    "cost.additional / cost.discard 未合入（RIFT-86 / RIFT-89），也没有把已支付实例数接到解释器 repeat 指令的 count；" +
    "本卡因此不写固定次数的额外执行。另外印刷参数 “Discard 1” 无法挂在 CardProgram 的 KeywordAbility 上" +
    "（契约 3.1 只有 keyword/value，契约 3.8.3 的 params 只覆盖 KeywordDef.expand 入参）。",
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
          // 该 op 未注册（见 judgeReason）。
          id: "square-up.grant-assault-4",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 4 },
            duration: { kind: "constant", value: "end-of-turn" }
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
