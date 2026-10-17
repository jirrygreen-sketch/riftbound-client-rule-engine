import type { CardProgram } from "../../ir/index.js";

/**
 * Herald of the Arcane (ogn-265-298) — Legend, Mind/Order, tag Viktor.
 *
 * Printed text:
 *   :rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.
 *
 * Structure (contract 3.1/3.2):
 * - activated ability, action timing (default for activated abilities; CR
 *   376/145.2): cost = 1 energy + exhaust this legend;
 * - "Play a 1 Might Recruit unit token" is the merged effect.token path with
 *   `token: "recruit"` (the frozen CR 187.1 definition: domainless unit token,
 *   1 Might, Recruit tag) and mode "play", i.e. created on the Chain and then
 *   played (CR 440.2.c / 185.2.a / 350.2 / 354; the primitive hands each
 *   created reference to the play action).
 *
 * Status: judge-required. The instruction is missing its Finalize destination:
 * - the printed text names no location, so the token's location is the default
 *   valid-location choice for a Played Unit: its controller's Base or a
 *   Battlefield the controller controls (CR 355.2/355.2.a, 440.2.b.1),
 *   decided at Finalize of the resulting game object (420.3.b.2);
 * - target.location now supplies LocationExpr/choose and location candidates;
 *   the missing bridge must supply controlled empty battlefields as well as
 *   occupied ones and choose during the resulting token's Finalize. The token
 *   primitive still does not accept LocationExpr directly. A choice earlier
 *   in this ability would not prove the required resulting-Play lifecycle.
 * The golden test exercises only the supported primitive and cost components.
 */
const program = {
  canonicalCardId:
    "card.hash-b65308f276825f21bb27abefcef45db6f138b952342039dac49beef16f14c2f1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 resulting token 的 Finalize 地点选择桥接（CR 355.2/355.2.a、420.3.b.2、440.2.b.1）：queryLocationCandidates " +
    "默认只从现有对象的 location 与 Base 枚举，空战场需要调用者提供 LocationState；token 打出路径未提供全部受控战场及控制状态。effect.token 要求目的地，其 Expr " +
    "schema 尚不接收 kind: location，原始 LocationExpr 经链适配器不能直接传入。需要在 token Finalize 时选择全部合法地点，不能固定 Base 或提前锁定地点。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust" }]
      },
      body: [
        {
          id: "herald.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" }
            // No destination argument: the default valid-location choice
            // (355.2/355.2.a) still needs the token Finalize bridge recorded in
            // judgeReason. Adding a Base here would drop the Battlefield
            // options the printed text grants.
          }
        }
      ]
    }
  ],
  sourceText: ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token."
} satisfies CardProgram;

export default program;
