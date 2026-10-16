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
 * status 判定（cards/README.md 第 2 节）：judge-required。两处已合入缺口：
 * - defense-declared 时点没有发射方：events/action-adapter.ts 只为已提交游戏动作派生时点
 *   （ACTION_TIMINGS 无 defense-declared），combat/ 的 Defender 身份指派（466.2.c/323.2）
 *   尚未接入事件管线——combat/flow.ts 在 combat 开启路径上直接抛
 *   TurnCombatBlockedError('combat-start-transaction')，全仓库没有 defense-declared 的 emit。
 * - "there" 的目的地无法绑定：该次防守的战场只存在于事件载荷（timing-points.ts 的
 *   defense payloadType 未声明 payloadFields），现有 EventPattern 词汇（object/source/target/
 *   player/fromZone/toZone/amount/details）与该事件的发射路径都没有把它暴露给卡程序；
 *   静态 IR 不能写运行时 LocationRef，也没有"能力发生地"的 referent 可读
 *   （来源是 Base/战场的 unit，其 location 与防守战场不一定相同，不能当作近似）。
 * 依赖：RIFT-33/RIFT-124（combat 身份指派与事件管线发射，含防守战场载荷）、RIFT-90（目标计划）。
 * 不近似实现（不把 defense-declared 换成其它时点，不用来源当前位置冒充防守战场）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      // "When you defend at a battlefield"：防守者是能力控制者；该次防守的战场载荷
      // 在合并内核里为空（见 judgeReason），这里不写任何能冒充它的过滤键。
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
                  // "there" = 该次防守发生的战场。静态 IR 无法写运行时 LocationRef，
                  // 该事件载荷在合并内核里也不存在（见 judgeReason），因此声明待接线的
                  // referent 而不是伪造一个 battlefield id。
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
    "defense-declared 时点没有发射方：events/action-adapter.ts 只为已提交游戏动作派生时点（ACTION_TIMINGS 无 " +
    "defense-declared），combat/ 的 Defender 身份指派（466.2.c/323.2、383.4.f.2）尚未接入事件管线——" +
    "combat/flow.ts 在 combat 开启路径上直接抛 TurnCombatBlockedError('combat-start-transaction')，" +
    "全仓库没有 defense-declared 的 emit，触发无法进入链。" +
    "同时「move me there」的目的地无法绑定：该次防守的战场只存在于事件载荷，而 " +
    "timing-points.ts 为 defense-declared 声明的 payloadType \"defense\" 没有 payloadFields，" +
    "现有 EventPattern 词汇（object/source/target/player/fromZone/toZone/amount/details）与该事件的发射路径" +
    "都没有把它暴露给卡程序；静态 IR 不能写运行时 LocationRef，来源单位自身的 location 又不等于防守战场" +
    "（它可能停在 Base 或被移动过），不能用作近似。" +
    "依赖：RIFT-33/RIFT-124（combat 身份指派与事件管线发射，含防守战场载荷）、RIFT-90（目标与目的地计划）。" +
    "不近似实现（不换时点、不用来源当前位置冒充防守战场）。",
  abilities,
  sourceText: "When you defend at a battlefield, you may move me there."
} satisfies CardProgram;

export default program;
