import type { CardProgram } from "../../ir/index.js";

/**
 * Desert's Call (sfd-031-221) — Spell, 2 Energy, no printed Power, Calm.
 *
 * Printed text:
 *   [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *   spell's effect.)
 *   Play a 2 :rb_might: Sand Soldier unit token.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-031-221):
 * cardType Spell, domains ["Calm"], energy 2, power null, might null, tags [].
 * power null means no printed Power and is never rewritten as 0. The printed
 * ability line carries no [Action]/[Reaction]/[Hidden] keyword, so the spell
 * keeps its default timing (159.2) and no speed keyword is declared.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Repeat] (820) is an Optional Additional Cost keyword. 820.1.c formats it
 *   "Repeat [Cost]", 820.1.c.1 makes that cost an Additional Cost paid while the
 *   spell is played, and 820.1.d.1 has each paid instance execute the spell's
 *   effect one additional time during resolution (with choices re-made per
 *   820.2 / 820.2.a). The printed additional cost (2 Energy) is declared on the
 *   play ability's CostSpec with an explicit pay/decline choice (820.1.b), the
 *   shape the merged Frigid Touch (sfd-066-221) uses.
 * - "Play a 2 :rb_might: Sand Soldier unit token" is the play of a NEW token:
 *   440.2.c / 185.2.a create a played token on the Chain first and hand it to the
 *   play procedure (350.2, 354). 350.2 makes tokens playable even though they are
 *   not cards, and 185.2.b gives token units a Might. CR 187.3 defines the token
 *   itself: a 2 Might, domainless unit token with the Shurima tag — the frozen
 *   `effect.token` definition id `sand-soldier`, whose Might is 2 and whose
 *   printed values stay null (185.3.a: tokens have no costs).
 * - the token's destination is not printed, so it follows 355.2: the playing
 *   player chooses a valid Location for the token when the resulting game object
 *   is finalized (355.2.a: by default the controller's Base or a Battlefield
 *   that player controls; 420.3.b.2 makes it a Finalize-time choice).
 *
 * Status: judge-required, with both gaps named:
 * - the Finalize-time destination choice has no expressible form: `effect.token`
 *   requires exactly one destination argument (location / target / pick /
 *   locations) and no merged Expr yields the legal-location set (RIFT-9
 *   target.location). Pinning a single Base would delete the printed Battlefield
 *   options, so no destination is written (the merged Herald of the Arcane
 *   program records the same gap).
 * - the [Repeat] payment cannot be charged or read back: no merged code turns a
 *   card program's declared optional additional cost into the cost planner's
 *   `optionalAdditional` input, and the paid-instance count has no binding for
 *   the extra execution (820.1.c.1 / 820.1.d.1; RIFT-86 / RIFT-89).
 * Nothing is approximated: the 2 Might Sand Soldier definition (187.3) is the
 * merged frozen definition, and the golden test exercises its play path with the
 * concrete Base the missing Finalize choice would supply.
 */
export default {
  canonicalCardId: "card.hash-13dac6e5e0aae54e0dba3935b0e7416d5e1cfe13a2c7817a155c406b27f0e5bf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Play a … token」没有印刷目的地，按 355.2 / 355.2.a / 420.3.b.2 该地点由玩家在 resulting game object " +
    "的 Finalize 时选择（控制者的 Base 或该玩家控制的 Battlefield），而 effect.token 要求恰好一个目的地参数（location/target/pick/locations），" +
    "且没有任何已合入 Expr 能产出运行时的合法地点集合（RIFT-9 target.location）；把目的地钉死为 Base 会删掉印刷的战场选项，故不写目的地" +
    "（与已合入的 Herald of the Arcane 记录同一缺口）。" +
    "(2) [Repeat] :rb_energy_2: 的可选附加费用无法收取或回读：没有把卡牌程序声明的可选附加费用接进已合入 cost 计划的 optionalAdditional 入口，" +
    "已付实例数也没有供结算读取的绑定（820.1.c.1 / 820.1.d.1；RIFT-86 只合入 Repeat 关键词与 effect.repeat 原语，RIFT-89 负责费用计划）。" +
    "token 本体是 187.3 的 2 Might Sand Soldier（effect.token 冻结定义 id \"sand-soldier\"，Shurima 标签、无印刷费用，绝不写成 0），golden 用真实原语以" +
    "具体 Base 执行链上创建 + 打出路径。依赖：RIFT-9（target.location 合法地点集合）、RIFT-86 / RIFT-89（Repeat 费用接线）。",
  abilities: [
    {
      kind: "play",
      // [Repeat] :rb_energy_2: (820.1.c): the printed additional cost is declared
      // with the pay/decline decision 820.1.b requires. The consumer is the cost
      // plan (RIFT-89); no merged code reads it today, which is part of
      // judgeReason. The printed base cost (2 Energy, no Power) is the card's
      // normal play cost (356.1) and is bound from the catalog at Finalize.
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "deserts-call.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          // "Play a 2 Might Sand Soldier unit token" — the merged CR 187.3
          // definition and the 440.2.c / 185.2.a play path. The destination is
          // deliberately absent: the printed text names none, and the 355.2
          // legal-location choice has no expressible form yet (see judgeReason).
          id: "deserts-call.play-sand-soldier-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sand-soldier" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            linkKey: { kind: "constant", value: "sandSoldierToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Play a 2 :rb_might: Sand Soldier unit token."
} satisfies CardProgram;
