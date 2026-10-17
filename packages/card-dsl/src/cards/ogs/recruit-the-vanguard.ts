import type { CardProgram } from "../../ir/index.js";

/**
 * Recruit the Vanguard (ogs-015-024) — Spell, 6 energy (Order).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Play four 1 :rb_might: Recruit unit tokens. (They can be played to your
 *   base or to battlefields you control.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the registry owns the
 *   Showdown permission (806.1.b/806.1.c, 159.2.a).
 * - "Play four 1 [M] Recruit unit tokens" plays NEW tokens, so each one is
 *   created on the Chain and handed to the play action (440.2.c, 185.2.a, 350.2,
 *   354). effect.token performs that handoff for the frozen `create-token`
 *   `to: "chain"` plus `play` path and keeps the ability controller as the token
 *   owner/controller (182, 183, 440.4). The token definition is the CR 187.1
 *   Recruit (1 Might, 1 energy-less token whose energy/power stay null per
 *   185.3), i.e. the merged `recruit` definition; no ability is invented for it.
 * - The reminder's playable locations are the default valid locations for a
 *   played Unit (355.2.a): the controller's Base or a Battlefield the
 *   controller controls. Both are offered as the token destination options;
 *   the destination of each played token is chosen during its own Finalize
 *   (355.2).
 * - Units enter the Board exhausted unless an effect says otherwise (143.4);
 *   the merged creation path applies that as-is, and this card does not add an
 *   entry-state override.
 *
 * Status: judge-required — the printed destination set is dynamic. effect.token
 * takes a fixed `locations` list, but "a battlefield you control" depends on
 * the battlefield control state at play time, and no merged producer turns the
 * controlled-battlefield set into concrete LocationRefs for an instruction
 * (`ResolveContext` exposes object queries, not locations, and no merged reader
 * exposes battlefield control as a LocationRef). The per-token destination is
 * also a play-procedure choice made at each token's Finalize (355.2), not a
 * single card-level choice. The base half is expressible; the token definition,
 * amount and chain-create/play handoff are all merged, so the golden test
 * executes the real primitive with a concrete base destination supplied by the
 * caller. Not approximated by hard-coding one battlefield, by creating the
 * tokens directly on the Board, or by collapsing the four plays into one fixed
 * destination.
 */
const recruitTheVanguard = {
  canonicalCardId: "card.hash-179b63953b7859f19d0affd2eb4cb2bb038eb99b560cb082a4458186f23cbc45",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“a battlefield you control” 依赖打出时的战场控制状态，而 effect.token 的 locations 只接受固定的 LocationRef 列表：" +
    "没有已合入的生产方把“你控制的战场”集合解析成具体 LocationRef——战场控制只存在于 combat/flow.ts 的 " +
    "BattlefieldState（turn/flow.ts 的 battlefields 快照），ResolveContext 只暴露对象查询，" +
    "layers/rules/query.ts 的 playLocations 也只提供 continuous.location 声明的具名许可、不含控制关系，" +
    "因此四个 token 的候选目的地无法在卡牌数据里写全。" +
    "每个 token 的目的地是各自 Finalize 的打出位置选择（355.2）；卡牌程序与打出流程的生产绑定（RIFT-257：" +
    "describePlay/play 路径）已合入，仍缺的是上述受控战场集合读数。" +
    "token 定义（CR 187.1 recruit：1 Might、energy/power 为 null）、数量与 create-on-chain + play 交接（440.2.c/185.2.a/350.2/354）均已合入，" +
    "“Play ... to your base” 半段由 golden 用真实原语执行（由调用方给出具体基地目的地）；" +
    "不硬编码某个战场、也不退化为直接在场上创建来近似。依赖：“受控战场集合 → LocationRef” 读数的契约变更请求。",
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
