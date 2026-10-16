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
 * - the frozen effect.token requires exactly one destination argument
 *   (location / target / pick / locations), and no merged Expr yields the
 *   current legal location set (RIFT-9 target.location). Fixing a single Base
 *   or Battlefield here would silently delete the player's printed options, so
 *   the destination argument is left for the target/location work and the
 *   golden test supplies a concrete Base only to exercise the merged token-play
 *   path.
 */
const program = {
  canonicalCardId:
    "card.hash-b65308f276825f21bb27abefcef45db6f138b952342039dac49beef16f14c2f1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Play a 1 Might Recruit unit token」没有写出地点，因此 token 按 CR 355.2/355.2.a、440.2.b.1 的默认合法地点规则在 Finalize 时由玩家选择：其控制者的 Base 或该玩家控制的 Battlefield（420.3.b.2 规定在 resulting game object 的 finalization 时检查）。" +
    "冻结的 effect.token 对 mode \"play\" 要求恰好一个目的地参数（location/target/pick/locations），而当前没有任何 Expr 能产出运行时的合法地点集合（RIFT-9 清单的 target.location 尚未合入）。" +
    "把目的地固定为 Base 或某个 Battlefield 都会删掉印刷的合法选项，因此不近似实现；Recruit 定义（CR 187.1，1 Might、Recruit 标签、无印刷费）与链上创建+打出的本体已在 effect.token 合入。" +
    "依赖：RIFT-9（target.location / 合法地点集合）与 P2 批 6 卡牌 IR 生产接线。",
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
            // (355.2/355.2.a) is the missing target.location piece recorded in
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
