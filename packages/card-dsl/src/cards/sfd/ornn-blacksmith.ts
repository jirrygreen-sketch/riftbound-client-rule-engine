import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Ornn, Blacksmith (sfd-058-221) — Unit, Calm, Ornn/Freljord/Champion.
 * energy 5, power 1 (Calm), Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-058-221，逐字）:
 *   "When you play me or when I hold, look at the top 4 cards of your Main Deck. "
 *   "You may reveal a gear from among them and draw it. Then recycle the rest."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me or when I hold"：「or」是两个触发条件的并列订阅（不是 355.11 的效果
 *   模式二选一），因此写成两条 triggered 能力：card-played（383.4.a/420.4.a 的 Play Effect）
 *   与 hold（383.4.d 的 Hold Effect；时点 hold，ruleRefs 315.2.b.2/471.2/473.2.b）。
 *   两条共用同一 body（同一印文效果）。
 * - "look at the top 4 cards of your Main Deck"（128.3–128.4 的私有查看、432.1.c 尽量执行）：
 *   已合入的 effect.inspect 的 top 作用域要求上游提供有序 picksSpecId——契约 3.6 规定
 *   牌库顶/底只能用 zoneSlice（query 不保证区域顺序），本卡声明稳定的有序范围 id
 *   "ornn-blacksmith.top-four"，不猜顺序。"your Main Deck" 的 "you" 是能力控制者
 *   （190.6.d）；effect.inspect 的 player 参数只接受 PlayerId 表达式，符号选择器
 *   "source" 不是它接受的形状，因此先用 condition.value 绑定控制者再以 linked-value 读取
 *   （与已合入的 ogn/stacked-deck、ogn/reinforce 同一写法）。
 * - "You may reveal a gear from among them and draw it"：383.3.a.3 以本卡为例——"you may"
 *   不在效果首段，因此是**结算时**的决定，能力总是进链；按契约 3.9 把被选指令包进
 *   choice.optional 的 body。"reveal"（425.1/425.2.a）把查看中的牌公开；被展示的牌仍在
 *   原区域（425.1.a.2），因此后续 "draw it" 才把它移入手中。
 *   "draw it" 按 414.1 的「把该牌从牌库加入手牌」实现：已合入的 effect.zone
 *   （to: "hand"）正是该区域移动（ogn/apprentice-smith 的 "If it's a gear, draw it" 同型），
 *   不是另一次抽顶牌（414.1.a）。
 *   被展示的牌与牌堆中的候选都是非公开区域的对象，按 355.10.a 不是 target，因此用非目标
 *   pick（解释器经 ctx.picks 读取），不触发 became-target。
 * - "Then recycle the rest"：417.1/417.1.a/417.4——剩余的牌回其拥有者的主牌库底部；
 *   已被移入手牌的那张引用失效而自动落选，正好是 "the rest"。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - effect.inspect 的非零 top 查看虽然已有 zoneSlice/ordered-pick 原语支持，但链的
 *   Finalize 仍只锁定 instruction.targets 的 TargetSpec（chain/engine.ts 的
 *   assertFinalizationSurface），没有把本卡 picksSpecId 接入生产打出生命周期，因此
 *   生产打出会因缺有序来源而看不到任何牌。
 * - "reveal a gear from among them" 需要「从查看结果里按 gear 类型选一张」的判定：
 *   已合入的 effect.inspect 的 choose 只能对全部被查看对象做 0..1 选择、不带类型过滤，
 *   而写进 PickSpec 的 filter 只是描述性数据（本条 pick 的候选来自链接值），没有已合入的
 *   消费方会把「链接列表 + gear 过滤」变成可重放的结算期选择。若用无过滤的 choose 近似，
 *   会让玩家选到非装备牌——按红线不近似实现。此外链适配器
 *   （chain/interpreter-adapter.ts 的 LITERAL_FIELDS）只为 effect.reveal 解包 target、
 *   未解包 pick，卡声明的 pick 在到原语前就被参数校验拒绝。
 * - 触发侧：hold 时点已由回合/计分流程发出，RIFT-257 的 program 绑定也在生产侧可用，
 *   filter.event 已按 TriggerSpec 词汇写作 "held" 并能完成注册；但计分流程的 hold
 *   载荷只带 player/details、不含对象，filter 的 self 归属因此永远命中不了。
 * 依赖：有序区域 pick 的 Finalize 生命周期、hold 载荷的对象/归属接线、
 * 以及链适配器对 nested pick 的解包。look / reveal / draw-it / recycle 四段只用已合入
 * 原语，golden 用解释器与参考内核真实执行。
 */
const BIND_CONTROLLER: Instruction = {
  id: "ornn-blacksmith.bind-controller",
  op: "condition.value",
  args: {
    value: { kind: "object-property", object: "source", property: "controller" },
    key: { kind: "constant", value: "controller" }
  }
};

const LOOK_TOP_FOUR: Instruction = {
  id: "ornn-blacksmith.look-top-four",
  op: "effect.inspect",
  linkedTo: "ornn-blacksmith.bind-controller",
  args: {
    player: {
      kind: "linked-value",
      instructionId: "ornn-blacksmith.bind-controller",
      key: "controller"
    },
    zone: { kind: "constant", value: "deck" },
    scope: { kind: "constant", value: "top" },
    amount: { kind: "constant", value: 4 },
    // 牌库顶 4 张（含顺序）由上游按 zoneSlice 提供（契约 3.6）。
    picksSpecId: { kind: "constant", value: "ornn-blacksmith.top-four" },
    linkedKey: { kind: "constant", value: "lookedCount" },
    pickedKey: { kind: "constant", value: "lookedCards" }
  },
  picks: [
    {
      id: "ornn-blacksmith.top-four",
      options: ["runtime:main-deck-top-four-in-zone-order"],
      min: 0,
      max: 4,
      selection: "up-to",
      filter: { owner: "self", zone: "deck" }
    }
  ]
};

const MAY_REVEAL_AND_DRAW: Instruction = {
  id: "ornn-blacksmith.may-reveal-a-gear",
  op: "choice.optional",
  args: {
    prompt: { kind: "constant", value: "Reveal a gear from among them and draw it?" },
    body: {
      kind: "constant",
      value: [
        {
          id: "ornn-blacksmith.reveal-gear",
          op: "effect.reveal",
          args: {
            pick: { kind: "constant", value: "ornn-blacksmith.revealed-gear" }
          },
          picks: [
            {
              id: "ornn-blacksmith.revealed-gear",
              // 候选来自刚查看的牌（链接值）；"a gear" 的类型限制写在 filter 上。
              options: [
                { kind: "linked-value", instructionId: "ornn-blacksmith.look-top-four", key: "lookedCards" }
              ],
              min: 1,
              max: 1,
              selection: "one",
              filter: { type: "gear", zone: "deck" }
            }
          ]
        },
        {
          id: "ornn-blacksmith.draw-it",
          op: "effect.zone",
          linkedTo: "ornn-blacksmith.reveal-gear",
          args: {
            pick: { kind: "constant", value: "ornn-blacksmith.revealed-drawn-gear" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          picks: [
            {
              id: "ornn-blacksmith.revealed-drawn-gear",
              // 414.1：把刚展示的那张牌从牌库加入其拥有者手牌（不是再抽顶牌）。
              options: [
                { kind: "linked-value", instructionId: "ornn-blacksmith.reveal-gear", key: "revealed" }
              ],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  }
};

const RECYCLE_THE_REST: Instruction = {
  id: "ornn-blacksmith.recycle-the-rest",
  op: "effect.recycle",
  linkedTo: "ornn-blacksmith.look-top-four",
  args: {
    // 417.1/417.1.a/417.4：放回各自的牌库底；已被移入手牌的旧引用失效而落选。
    objects: { kind: "linked-value", instructionId: "ornn-blacksmith.look-top-four", key: "lookedCards" }
  }
};

/** "or" 连接的两个触发条件共用同一效果体（同一印文）。 */
const body: Instruction[] = [BIND_CONTROLLER, LOOK_TOP_FOUR, MAY_REVEAL_AND_DRAW, RECYCLE_THE_REST];

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body
  },
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "held", filter: { source: "self" } } },
    optional: false,
    body
  }
];

const program = {
  canonicalCardId: "card.hash-9dc6aa1c0b143c97fcb8a2380ebb6b0c2130148d5d9974ba8568d615c7d1d2e9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处依赖未合入：(1)「look at the top 4 cards of your Main Deck」需要把已有 zoneSlice/ordered-pick 支持接入 Finalize：" +
    "effect.inspect 的非零 top 作用域要求上游提供有序 picksSpecId，而链的 Finalize 仍只锁定 instruction.targets 的 TargetSpec" +
    "（chain/engine.ts 的 assertFinalizationSurface），没有本卡 picksSpecId 的生产生命周期。" +
    "(2)「You may reveal a gear from among them」需要从查看结果里按 gear 类型选一张：effect.inspect 的 choose 只能对全部被查看对象做 0..1 选择、不带类型过滤，" +
    "写进 PickSpec 的 filter 只是描述性数据（候选来自链接值），没有消费方把「链接列表 + gear 过滤」变成可重放的结算期选择；" +
    "用无过滤的 choose 近似会让玩家选到非装备牌，按红线不近似实现；并且链适配器（chain/interpreter-adapter.ts 的 LITERAL_FIELDS）" +
    "只为 effect.reveal 解包 target、未解包 pick，卡声明的 pick 在到原语前就被参数校验拒绝。" +
    "(3) 触发侧：hold 时点已由回合/计分流程发出，RIFT-257 的 program 绑定也已在生产侧可用，" +
    "filter.event 已按 TriggerSpec 词汇写作 \"held\" 并能完成注册；但计分流程的 hold 载荷只带 player/details、不含对象，" +
    "filter 的 self 归属永远命中不了。" +
    "look/reveal/draw-it/recycle 四段只用已合入原语，golden 用解释器与参考内核真实执行。" +
    "依赖：有序区域 pick 的 Finalize 生命周期、hold 载荷的对象/归属接线、链适配器 nested pick 解包。不近似实现。",
  abilities,
  sourceText:
    "When you play me or when I hold, look at the top 4 cards of your Main Deck. " +
    "You may reveal a gear from among them and draw it. Then recycle the rest."
} satisfies CardProgram;

export default program;
