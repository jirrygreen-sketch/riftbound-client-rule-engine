import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Evershade Stalker (unl-123-219) — Unit，能量 3，力量未印刷（power: null），Might 3，
 * 领域 Chaos，标签 Shadow Isles。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-123-219，逐字）:
 *   "When you play me, discard 1, then draw 1."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"：383.4.a / 383.4.a.1 的 Play Effect（420.4.a 在打出完成后触发），
 *   封闭时点 card-played，filter 指向本源自身。
 * - "discard 1"：423.1（弃牌把牌移到该玩家自己的 Trash）、423.1.a（由弃牌者选择弃哪张）、
 *   423.4（效果弃牌尽可能弃，不足则弃现有的所有手牌）。它是效果弃牌，不是费用弃牌
 *   （423.3 的费用必须完整支付），因此用已合入的 effect.discard；弃牌者缺省为能力控制者
 *   （190.6.d 的隐含 you），不写死玩家 id。
 * - "then draw 1"：414.1 / 414.1.a / 414.3（未特别说明时从 Main Deck 顶抽），用已合入的
 *   effect.draw。"then" 表示按印刷顺序结算的相邻指令，不是链接指令：359.3.e.11 规定
 *   “能部分执行就尽可能执行”，官方例子正是 "Discard 2, then draw 2"——弃牌被否定/无牌可弃时
 *   抽牌照常结算；359.3.e.14 的链接只发生在后一条指令引用了前一条的对象或动作时，本卡
 *   "draw 1" 不引用弃掉的那张牌，也不引用弃牌这个动作，因此两条指令都不写 linkedTo（同已合入
 *   的 ogn/traveling-merchant、ogn/zaun-warrens）。
 *
 * status 判定（cards/README.md 第 2 节）：executable。card-played 时点（383.4.a/
 * 420.4.a，由 chain 在打出完成后发出，见 docs/rules/timing-point-producers.md）与两条指令
 * 都已合入并有执行测试，整卡能力无需额外原语、关键词或图层。把 CardProgram 的触发数据
 * 注册进生产触发管线属共享接线（RIFT-120 后续，同 ogn/cloud-drake、ogn/traveling-merchant
 * 的判定），不影响本卡数据的可执行性；golden 里对该共享接线保留 test.todo。
 * body 的 effect.discard + effect.draw 由 golden 用解释器 + 参考内核真实执行，覆盖
 * 手牌足够时的正常结算、玩家选择弃哪张（423.1.a）、手牌不足/为空时“尽可能弃”与
 * “抽牌照常结算”（423.4、359.3.e.11）三种边界。
 * `energy: null`/`power: null` 表示无印刷值，未改写成 0。
 */
const body: readonly Instruction[] = [
  {
    // 423.1 / 423.1.a / 423.4：能力控制者弃 1 张，自己选哪张；不足则尽可能弃。
    // 与后面的抽牌不链接（359.3.e.11 的 "discard 2, then draw 2" 例子）。
    id: "evershade-stalker.discard-1",
    op: "effect.discard",
    args: { amount: { kind: "constant", value: 1 } }
  },
  {
    // 414.1 / 414.3：从控制者 Main Deck 顶抽 1 张；弃牌被否定时照常执行。
    id: "evershade-stalker.draw-1",
    op: "effect.draw",
    args: { amount: { kind: "constant", value: 1 } }
  }
];

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body
  }
];

export default {
  canonicalCardId:
    "card.hash-bd90399f1d9ed5e571bbb359df812b1741c5813f6fbb4b8d1bc6e9e3a96730f5",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "When you play me, discard 1, then draw 1."
} satisfies CardProgram;
