import type { CardProgram } from "../../ir/index.js";

/**
 * Recruit the Vanguard (ogs-015-024).
 * CR v1.5 806: declare Action for the engine's Showdown permission.
 * CR 187.1/185.3: four Recruit units, 1 Might, energy/power remain null.
 * New tokens are created on the Chain and played (440.2.c, 185.2.a, 350.2,
 * 354), entering exhausted by default (143.4). Each token chooses its own
 * legal location at Finalize: your Base or a battlefield you control (355.2.a).
 * The location candidate reader exists, but effect.token does not consume its
 * dynamic controlled-battlefield set. Its locations argument is concrete and
 * makes one shared choice before creating all four tokens. Thus judge-required;
 * the supported concrete-base primitive path has isolated execution evidence.
 */
const recruitTheVanguard = {
  canonicalCardId: "card.hash-179b63953b7859f19d0affd2eb4cb2bb038eb99b560cb082a4458186f23cbc45",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 effect.token 与动态打出位置的接线：target/location/candidates.ts 已可基于 LocationState 查询受控战场 LocationRef，但 effect.token 的 locations 只接受具体列表，不能从原始 IR 读取控制者基地及当前受控战场候选集；数组中的 query 描述也不会被求值。另缺每个 token 在各自 Finalize 独立选择位置（CR 355.2/355.2.a）：当前原语在创建循环前只选择一次，四个 token 共用目的地。依赖：动态候选位置接入 effect.token 与逐 token Finalize 位置选择（契约变更请求）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 }
      },
      body: [
        {
          id: "recruit-the-vanguard.play-tokens",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 4 },
            mode: { kind: "constant", value: "play" },
            // The printed destinations (355.2.a): the controller's Base or a
            // Battlefield the controller controls. The base is a concrete
            // legal LocationRef (the corpus placeholder for "your base", as in
            // sfd-019-221 Assembly Rig); the battlefield half is named with the
            // merged query descriptor shape because it is a dynamic set (see
            // judgeReason): effect.token's locations list only accepts concrete
            // LocationRefs, so that entry is descriptive and is never evaluated
            // as if it were a location.
            locations: {
              kind: "constant",
              value: [
                { type: "base", player: "controller" },
                { kind: "query", filter: { type: "battlefield", controller: "self" } }
              ]
            },
            choiceId: { kind: "constant", value: "recruit-the-vanguard.location" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Play four 1 :rb_might: Recruit unit tokens. (They can be played to your base or to battlefields you control.)"
} satisfies CardProgram;

export default recruitTheVanguard;
