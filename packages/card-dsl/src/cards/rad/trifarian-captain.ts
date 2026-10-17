import type { Ability, CardProgram, Instruction, InstructionBodyExpr } from "../../ir/index.js";

/**
 * Trifarian Captain (rad-129-167) — Unit, Order, 2 energy / 无印刷力量 / 1 Might。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-129-167):
 *   "When you play me, look at the top 4 cards of your Main Deck. You may reveal
 *    from among them a unit or gear with Energy cost no more than :rb_energy_3:
 *    and with Power cost no more than :rb_rune_rainbow: and draw it. Recycle the
 *    rest."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：打出触发（时点 card-played，420.4.a 在打出完成后触发）。
 * - "look at the top 4 cards of your Main Deck"：look 是私下查看（128.3–128.4），
 *   对应 effect.inspect 的 top 范围；牌库顶必须是真实区域顺序（契约 3.6 的
 *   zoneSlice：query 不保证顺序）。effect.inspect 明确要求 top 范围由上游按序给出
 *   picksSpecId，否则 negated/impossible——本程序按契约提供该 id（trifarian-captain.
 *   top-four），但"谁按牌库顺序提供这 4 张"在生产链上尚未接线。
 * - "You may reveal ... and draw it"："you may" 不是效果的第一段（383.3.a.3），
 *   因此由控制者在结算时决定 → 契约 3.9 的 choice.optional，把 reveal + 入手包在 body 里。
 * - "reveal ... and draw it"：reveal 公开该卡（425.1），随后把它置入手牌。此处不是
 *   414.3 的 "Draw X."（后者总是抽牌库顶 414.1.a），而是把指定牌放入手牌，故用
 *   effect.zone 的 move-zone（108.7.b 手牌、124 换区身份）。
 * - "Recycle the rest"：417.1/417.4 的 Recycle（按卡主牌库/符文牌库归位），对应
 *   effect.recycle；"the rest" 是 look 到的 4 张里除去被展示那张的补集。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - 牌库顶按序来源：effect.inspect 在 top 范围需要一个按牌库顺序的 picksSpecId，
 *   该有序来源的生产接线属 RIFT-358（进行中），任何其他读法都会用 query 的顺序
 *   冒充牌库顶（被该原语显式禁止）。
 * - "a unit or gear with Energy cost no more than 3 and with Power cost no more
 *   than [rainbow]"：ObjectFilter 没有数值比较键（只有精确 characteristics 相等），
 *   Condition 也不能作为集合内的逐项限制（355.9.b 的 targeting restriction），
 *   因此能量的 ≤3 与力量的 ≤1 无法在 IR 中表达。
 * - "the rest" 的集合差（looked 4 张减去被展示那张）没有 IR 运算符：effect.inspect
 *   只链接实际查看张数与引用列表（没有补集），PickSpec 也没有 exclude 语义。
 */
/** effect.inspect 链接的"已查看引用列表"（pickedKey = lookedCards）。 */
const lookedCardsOption = () => ({
  kind: "linked-value" as const,
  instructionId: "trifarian-captain.look-top-four",
  key: "lookedCards"
});

/** 被展示并入手的那张牌（looked 中被选中的一张）。 */
const chosenPick = () => ({
  id: "trifarian-captain.chosen",
  options: [lookedCardsOption()],
  // 文字的限制：unit or gear、能量 ≤3、力量 ≤1。IR 的 ObjectFilter 没有数值比较键，
  // 这三个限制只能作为描述性键记录（不可执行，见 judgeReason）。
  filter: {
    type: ["unit", "gear"],
    zone: "deck",
    energyAtMost: 3,
    powerAtMost: 1
  },
  min: 1,
  max: 1,
  selection: "one" as const
});

/** 383.3.a.3："you may" 不在效果第一段 → 结算时的可选决定，包住 reveal + 入手。 */
const mayRevealAndDrawBody: InstructionBodyExpr = {
  kind: "constant",
  value: [
    {
      id: "trifarian-captain.reveal-chosen",
      op: "effect.reveal",
      args: { pick: { kind: "constant", value: "trifarian-captain.chosen" } },
      picks: [chosenPick()]
    },
    {
      id: "trifarian-captain.put-chosen-in-hand",
      op: "effect.zone",
      linkedTo: "trifarian-captain.reveal-chosen",
      args: {
        pick: { kind: "constant", value: "trifarian-captain.chosen" },
        to: { kind: "constant", value: "hand" }
      },
      picks: [chosenPick()]
    }
  ] as readonly Instruction[]
};

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "trifarian-captain.look-top-four",
        op: "effect.inspect",
        args: {
          player: { kind: "object-property", object: "source", property: "controller" },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          amount: { kind: "constant", value: 4 },
          picksSpecId: { kind: "constant", value: "trifarian-captain.top-four" },
          linkedKey: { kind: "constant", value: "lookedCount" },
          pickedKey: { kind: "constant", value: "lookedCards" }
        }
      },
      {
        id: "trifarian-captain.may-reveal-and-draw",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Reveal a unit or gear costing at most 3 Energy and 1 Power among the looked cards and draw it?"
          },
          body: mayRevealAndDrawBody
        }
      },
      {
        id: "trifarian-captain.recycle-the-rest",
        op: "effect.recycle",
        args: {
          // effect.inspect 不产出补集；该键需要上游按 417.6 的"其余"集合写入。
          objects: {
            kind: "linked-value",
            instructionId: "trifarian-captain.look-top-four",
            key: "lookedRest"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-fbb4180b4014bcdaba24acecc70f449a5510dc03c49ffb585d7ff8b7cdffea8a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺三处：(1) 牌库顶按序来源——effect.inspect 的 top 范围必须由上游按契约 3.6 的" +
    "zoneSlice 提供有序 picksSpecId，该生产接线属 RIFT-358（进行中），用 query 的顺序冒充牌库顶被原语显式禁止；" +
    "(2) \"a unit or gear with Energy cost no more than 3 and with Power cost no more than" +
    " [rainbow]\" 是 355.9.b 的目标限制，ObjectFilter 没有数值比较键、Condition 无法对集合逐项" +
    "施加限制，因此只能作为描述性键记录，不可执行；(3) \"the rest\" 需要 looked 集合减去被展示" +
    "那张的补集，effect.inspect 只链接张数与引用列表，PickSpec 也没有 exclude 语义。依赖：" +
    "RIFT-358（有序 picksSpecId 生产接线，进行中）。",
  abilities,
  sourceText:
    "When you play me, look at the top 4 cards of your Main Deck. You may reveal from among them a unit or gear with Energy cost no more than :rb_energy_3: and with Power cost no more than :rb_rune_rainbow: and draw it. Recycle the rest."
} satisfies CardProgram;

export default program;
