import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Boy Who Shattered Time (rad-139-167) — Legend, Fury/Mind, tag Ekko.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-139-167，逐字）：
 *   [Empower] —  :rb_energy_1:, :rb_exhaust: (Use only if not Empowered.)
 *   Disempower me, :rb_exhaust:: Reduce the cost of the next unit you play
 *   this turn by :rb_energy_2::rb_rune_rainbow: and give it "Kill me at end of
 *   turn."
 *
 * 规则依据（CR v1.5）：
 * - 827.1.a / 827.1.b / 827.1.c：第一行是 [Empower] 关键词的印刷形态
 *   “Empower [Cost]”，费用为 1 Energy 加上横置来源（415.5）；费用支付完成后来源
 *   本身成为 Empowered（442，827.1.b.1 明确来源不是目标）。关键词只声明、不重写
 *   （卡牌 README 第 5 节）：展开由 effects/keywords/<keyword>.ts 负责，[Empower]
 *   的 KeywordDef（kw-empower）尚未合入。
 * - 377.1 / 404.1.a：第二行冒号之前是费用，所以 “Disempower me” 与横置来源都是
 *   该启动能力的基础费用，必须在 Finalize 支付（204.3），不能改写为结算时的效果。
 *   443.1 / 443.2：Disempower 是移除 Empowered 状态的受限动作，只由游戏效果指示。
 * - “Reduce the cost of the next unit you play this turn by
 *   :rb_energy_2::rb_rune_rainbow:” 是本回合“下一张打出的单位”的费用改写
 *   （cost-modify 模板；356.4 的折扣阶段），需要费用计划消费方（RIFT-261 的费用种类与
 *   cost.pay / cost.modify）与
 *   “下一个打出的单位”这一窗口的绑定。
 * - “and give it "Kill me at end of turn."” 把一条带来源关联的触发能力临时附加给
 *   那个单位（317.1.a 的回合结束时点；135.4.b / 801.3.a 的授予边界），需要
 *   continuous.grant-ability。该对象在结算时还不存在（它是本回合之后被打出的单位），
 *   所以两条指令都只能用描述窗口的常量，不能声明 TargetSpec（355.5/355.8 要求
 *   目标在把链项放上链时就合法存在）。
 * - 135.2.e.5 / 163.2.b：减费值里的 :rb_rune_rainbow: 是 [A]（任意域）Power；
 *   契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，
 *   effect.resources 明确记录 [A] 不可表达、绝不用某个域近似。
 *
 * status = judge-required（逐个保留证据，不近似实现）：
 * - 缺 [Empower] 关键词展开：effects/keywords/ 的已注册关键词（Accelerate、Action、
 *   Ambush、Assault、Backline、Deathknell、Deflect、Deploy、Disarm、Equip、Flow、
 *   Ganking、Hidden、Hunt、Legion、Level、Mighty、Quick-Draw、Reaction、Repeat、
 *   Shield、Show Off、Tank、Temporary、Vision、Weaponmaster）不含 Empower（827），
 *   [Empower] 的 KeywordDef 尚无归属任务号；
 * - 费用管线不接受 “Disempower me” 作为费用：cost/plan-values.ts 支持的支付种类只有
 *   energy / power / xp / exhaust / discard / recycle / kill / reveal / spend-buff，
 *   kind: "disempower" 会被 readCost 以 judge-required 拒绝（443 的 Disempower 是
 *   受限动作，不在费用管线里）；golden 锁定该拒绝证据；
 * - “下一张打出的单位”的减费窗口与 cost.modify 原语未合入
 *   （cost/ 目录只有 cost-plan / payment / plan-types / plan-values / printed-costs /
 *   resources，scripts 的 op 注册表无 cost.modify；RIFT-261 仍在进行）；
 * - “Kill me at end of turn.” 的临时能力授予与回合结束到期需要 continuous.grant-ability
 *   与延迟触发（RIFT-259 的持续效果指令只提供 might / grant-keyword / keyword / combat /
 *   movement / timing / restrict / location / deck，没有 grant-ability）；
 * - [A] 通用 Power 在六域封闭集合里没有可执行值（契约级缺口）。
 */
const abilities: Ability[] = [
  {
    // 827.1.c：“Empower [Cost]”是一次启动，印刷费用是 1 Energy 加上横置来源
    // （415.5；827.1.c.2 允许资源费用与非资源费用混合）。按卡牌 README 第 5 节，
    // 关键词只声明身份（契约 3.1 的 KeywordAbility 只有 keyword / value），卡文件不
    // 重写 “Empower me. Play only if not Empowered.” 的展开逻辑，也不新增 IR 字段：
    // 印刷费用与 “Play only if not Empowered” 由 KeywordDef.expand 按契约 3.8 第 3 条
    // 的 params.cost / 关键词自身承载。
    kind: "keyword",
    keyword: "empower"
  },
  {
    kind: "activated",
    // 该行没有 [Reaction] / [Action]，按 381.1 的默认时机是 Action（IR 的 timing 字段）。
    timing: "action",
    cost: {
      kind: "activated",
      // 印刷顺序：先 “Disempower me”，再横置来源。
      payments: [
        { kind: "disempower", object: "self" },
        { kind: "exhaust", object: "self" }
      ]
    },
    body: [
      {
        id: "boy-who-shattered-time.reduce-next-unit",
        // cost.modify 模板（356.4；RIFT-9 原语清单，尚未合入）：对本回合下一张打出的
        // 单位应用 -2 Energy 与 -1 [A]；window 是描述窗口的常量，不是对象引用。
        op: "cost.modify",
        args: {
          appliesTo: { kind: "constant", value: "next-unit-played-this-turn" },
          energy: { kind: "constant", value: -2 },
          power: { kind: "constant", value: ["rainbow"] },
          duration: { kind: "constant", value: "this-turn" }
        }
      },
      {
        id: "boy-who-shattered-time.grant-end-of-turn-kill",
        // continuous.grant-ability（临时能力授予的持续效果，尚无已合入指令）把 “Kill me at end of
        // turn.” 这条带来源关联的触发能力附加给同一张单位。两条指令作用于同一个对象，
        // 但彼此没有结果依赖，因此不写 linkedTo（卡牌 README 第 4 节）。
        op: "continuous.grant-ability",
        args: {
          target: { kind: "constant", value: "next-unit-played-this-turn" },
          ability: {
            kind: "constant",
            value: {
              at: "turn-end",
              filter: { self: true },
              optional: false,
              body: [
                {
                  id: "boy-who-shattered-time.granted-kill",
                  op: "effect.kill",
                  args: { self: { kind: "constant", value: true } }
                }
              ]
            }
          },
          duration: { kind: "constant", value: "end-of-turn" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-ad1eab15fd49b5de8236cadaa8e7c053d23218fb204a265a51a5ae2311445f11",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 [Empower] 关键词展开（827.1.c 的 “Empower [Cost]”；effects/keywords/ 的已注册关键词不含 Empower，" +
    "该 KeywordDef 尚无归属任务号）。" +
    "费用管线不接受 “Disempower me” 作为费用：cost/plan-values.ts 支持的支付种类只有 energy / power / xp / " +
    "exhaust / discard / recycle / kill / reveal / spend-buff，kind: \"disempower\" 会被 readCost 以 judge-required 拒绝" +
    "（443 的 Disempower 是受限动作）。减费侧缺 cost.modify 与 “本回合下一张打出的单位” 窗口的绑定（RIFT-261），" +
    "减费值里的 [A]（135.2.e.5 / 163.2.b 任意域 Power）在六域封闭集合里没有可执行值，不选一个域近似。" +
    "“Kill me at end of turn.” 需要 continuous.grant-ability 与回合结束到期（317.1.a / 135.4.b 的临时能力授予与到期），" +
    "已合入的持续效果指令清单里没有 grant-ability。" +
    "依赖：Empower KeywordDef、RIFT-261（cost.pay / cost.modify）、grant-ability 持续效果；不近似实现。",
  abilities,
  sourceText:
    "[Empower] —  :rb_energy_1:, :rb_exhaust: (Use only if not Empowered.)\n" +
    "Disempower me, :rb_exhaust:: Reduce the cost of the next unit you play this turn by " +
    ":rb_energy_2::rb_rune_rainbow: and give it \"Kill me at end of turn.\""
} satisfies CardProgram;

export default program;
