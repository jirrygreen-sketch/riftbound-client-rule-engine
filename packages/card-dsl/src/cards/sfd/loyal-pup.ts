import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Loyal Pup (sfd-126-221) — Unit, Chaos, tags Dog/Bandle City.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-126-221，逐字）:
 *   "When you defend at a battlefield, you may move me there."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.f / 383.4.f.1 / 383.4.f.2："When you defend …" 是 Defend Trigger，在防守方
 *   首次取得 Defender 身份后进链；封闭时点 defense-declared（events/timing-points.ts，
 *   refs 323.2/383.4.f/466.2.c）。383.4.f.2.a：每次战斗只检查一次触发条件。
 *   "at a battlefield" 限定防守发生在战场上（防守只可能在战场发生，该从句为限定语）。
 * - "you may"（403.1）：可选效果；契约 3.9 要求把被选指令包进 choice.optional 的 body。
 * - "move me there"：451 的效果移动（不是标准移动，不加 144.2 的横置费用/主阶段门槛）；
 *   "me" 是能力宿主本卡（effect.move 的 objects 缺省即 ctx.source，或用符号选择器
 *   "source"）；"there" 指该次防守发生的战场（运行期 Location，359.3.f.1 的 referent）。
 *
 * Current status: judge-required. CombatFlow blocks defense designation at
 * combat-start-transaction. The defense emission and its battlefield payload
 * binding to the resolving body are absent. Generic Location selectors and
 * effect.move are merged; choosing any battlefield would change "there".
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      // "When you defend at a battlefield"：防守者是能力控制者；该次防守的战场载荷
      // 尚未由战斗生产者发射（见 judgeReason），不能用其它事件冒充。
      filter: { event: "defense-declared", player: "self" },
      // 383.4.f.2.a/383.4.f.2.b：战斗身份只结算一次；"at a battlefield" 是 Defend Trigger
      // 的定义性限定。
      once: "per-combat"
    },
    optional: false,
    body: [
      {
        id: "loyal-pup.may-move",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Move Loyal Pup to that battlefield?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "loyal-pup.move-self",
                op: "effect.move",
                args: {
                  // "me"：能力宿主本卡（source 选择器由解释器在运行时绑定）。
                  objects: { kind: "constant", value: "source" },
                  // "there" = 该次防守发生的战场。LocationSelector 已合入，
                  // 但没有读取触发事件战场的表达式；保留待接线的 referent。
                  to: { kind: "constant", value: { referent: "defending-battlefield" } },
                  amount: { kind: "constant", value: 1 },
                  linkKey: { kind: "constant", value: "moved" }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-f4e865137dd3c74c2b7b55f74508a0cb2f04b8d181e7103a6fb0316f8b6b4f63",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "defense-declared 仍无战斗身份指派发射路径（383.4.f.2 / 466.2.c）：combat/flow.ts 在 " +
    "combat-start-transaction 处阻断，时点表的 defense payloadFields 也未声明防守战场。" +
    "LocationSelector、运行期 Location 选择和 effect.move 已合入；当前缺口是把该次防守事件的 battlefieldId " +
    "绑定到能力正文的「there」引用（359.3.f.1）。ResolveContext/Expr 尚无触发事件载荷读取，" +
    "programs/triggers.ts 也未提供该引用。不能用任选战场或来源当前 location 代替防守战场。",
  abilities,
  sourceText: "When you defend at a battlefield, you may move me there."
} satisfies CardProgram;

export default program;
