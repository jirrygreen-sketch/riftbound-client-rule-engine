import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Honeyfruit (unl-049-219) — Gear, 2 energy、power null（无印刷 Power）、Might null，
 * 领域 Calm，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json unl-049-219，含换行）：
 *   "This enters exhausted.
 *    [Reaction][>] :rb_exhaust:: [Add] :rb_rune_rainbow:. (Abilities that add resources
 *    can't be reacted to.)
 *    [Level 6][>] [>>][Reaction][>] :rb_exhaust:: [Add] :rb_energy_1::rb_rune_rainbow:.
 *    (Use this ability only while you have 6+ XP.)"
 *
 * 规则依据（CR v1.5）：
 * - “This enters exhausted.” 是入场状态改写：非单位 Gear 默认就绪进场（149.1、359.2.d），
 *   本卡把它改成横置进场。入场状态属于替代族（契约 3.5：替代在动作执行前拦截），
 *   与 Accelerate 805.6 “不先横置再就绪” 同一条路径；effect.exhaust 的文件头明确
 *   “入场即横置不是一次横置动作”，先入场再补 effect.exhaust 会多出一次“成为横置”
 *   事件并错过入场替代，因此不近似。程序用 replacement 能力描述该改写（与已合入
 *   ogn/iron-ballista、ven/patty 同类形状）。
 * - “[Reaction][>] :rb_exhaust:: [Add] :rb_rune_rainbow:.”：813.1.a / 813.1.d 的
 *   Reaction 速度许可 → activated.timing = "reaction"；377.1 / 404.1.a 的 “:” 之前是
 *   费用（横置来源，415.3.a / 415.5）；430.1 / 430.5 / 135.2.e.5 的 “[Add]
 *   :rb_rune_rainbow:” 是 Add 动作——向符文池加 1 点任意域（Universal）Power。
 * - “[Level 6][>] …”：824.1.a / 824.1.b / 824.1.c 的依赖式关键词——从关键词到子句末尾
 *   整段是 Level Ability，功能等价于“当你有 6 点或更多 XP 时，本牌获得 ‘…’”，
 *   控制者 XP 变化会即时让依赖能力 Active/Inactive（824.1.c.1 / 824.1.d）。
 *   “[>>]” 是同一子句上多个依赖关键词的连接符（对照 727.1.b.3 的多依赖关键词例子）。
 *   该 Level 能力是第二条启动能力：费用同样是横置来源，效果是 [Add] 1 能量 + 1 任意域
 *   Power（430.5 的两个例子正是 “Add [2].” 与 “Add [1][G].” 的格式）。
 * - “(Abilities that add resources can't be reacted to.)” 与 “(Use this ability only
 *   while you have 6+ XP.)” 是提醒文本（不是另外的能力）：前者对应 430.2.a 的
 *   Priority/Focus 不传递；后者是 824.1 的 XP 门槛本身。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. 缺入场状态改写原语：契约 3.4/3.5 的替代族里没有卡牌 IR 可注册的
 *    replacement.enter（Accelerate 805.6 同型），effect.exhaust 不等价（见上）。
 * 2. “[A] 任意域 Power” 不可表达：契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order
 *    六域封闭集合（effects/contract.ts），effect.resources 明确记录 163.2.b 的 Universal
 *    Power 不可表达、绝不用某个域近似（已合入 ogn/daughter-of-the-void、rad/iron-revenant
 *    同型，程序以 { power: ["rainbow"] } 保留记号，原语对其返回 negated(impossible)）。
 * 3. 缺 Level 关键词展开（kw-level）：824.1.c 的“控制者有 6+ XP 时依赖能力 Active”需要
 *    可求值的 XP 谓词，合并 IR 的 Condition 只有 always/never/expression/compare/all/any/not，
 *    读取 PlayerSnapshot.xp 没有进入 Expr/谓词的路径；824.1.c.1/.d 的动态失活同样缺失。
 * 4. 费用与启动接线：两条能力都靠费用计划来横置来源，契约 3.5 的“卡牌程序 → 启动能力
 *    注册 → 链”尚无生产方。
 * 依赖：RIFT-89（费用/支付接线）、RIFT-90（目标与费用选择）、RIFT-91（图层/依赖能力）、
 * kw-level 与 replacement.enter；[A] 与印刷费用符号的承载字段属契约级缺口。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // “This enters exhausted.”：把 Gear 的就绪进场改写为横置进场（143.4/359.2.d 的
    // 默认状态被本卡改写），消费方是入场替代管线（replacement.enter，契约 3.5）。
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    with: [
      {
        id: "honeyfruit.enter-exhausted",
        // 入场状态改写，不是一次横置动作（见文件头第 1 点）。
        op: "replacement.enter",
        args: {
          state: { kind: "constant", value: "exhausted" },
          zone: { kind: "constant", value: "board" }
        }
      }
    ]
  },
  {
    kind: "activated",
    // 813.1.d：“[Reaction][>]” 是能力上的速度许可。
    timing: "reaction",
    cost: {
      kind: "activated",
      // 377.1 / 404.1.a：冒号之前的横置是费用（415.3.a / 415.5）。
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "honeyfruit.add-universal-power",
        op: "effect.resources",
        args: {
          // 430.1 / 430.5 / 135.2.e.5：[A] 是任意域 Power；六域封闭集合下没有可执行值，
          // 保留描述性记号，不改成某个具体域（见文件头第 2 点）。
          power: { kind: "constant", value: ["rainbow"] }
        }
      }
    ]
  },
  {
    kind: "activated",
    timing: "reaction",
    // 824.1.b.1：[Level 6][>] 的依赖能力——仅当控制者有 6+ XP 时该启动能力 Active；
    // 谓词与动态失活没有合并实现（见文件头第 3 点），这里只记录依赖关系。
    restriction: {
      kind: "dependent-keyword",
      keyword: "level",
      value: { kind: "constant", value: 6 }
    },
    cost: {
      kind: "activated",
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "honeyfruit.add-energy-and-universal-power",
        op: "effect.resources",
        args: {
          // 430.5：“Add [1][A].” = 1 能量 + 1 任意域 Power。
          energy: { kind: "constant", value: 1 },
          power: { kind: "constant", value: ["rainbow"] }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-2cbed9b8e8e6bad981a52533e2be7f623180aac30aad920891bc32d9fedb7d7d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) “This enters exhausted.” 需入场状态改写：契约 3.4/3.5 的替代族没有卡牌 IR 可注册的 replacement.enter" +
    "（Accelerate 805.6 同型）；effect.exhaust 不等价——143.4/359.2.d 规定入场状态由进场动作决定，先入场再补横置会多出一次“成为横置”事件并错过入场替代。" +
    "(2) [Add] :rb_rune_rainbow: 的任意域 [A] Power（430.5、135.2.e.5、163.2.b）不可表达：" +
    "契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，effect.resources 明确记录 Universal Power 不可表达、绝不用某个域近似。" +
    "(3) 缺 Level 关键词展开（kw-level）：824.1.c 的“控制者有 6+ XP 时依赖能力 Active”需要可求值的 XP 谓词，" +
    "合并 IR 的 Condition 没有读取 PlayerSnapshot.xp 的路径，824.1.c.1/.d 的动态失活同样缺失。" +
    "(4) 两条启动能力的费用横置缺少“卡牌程序 → 启动能力注册 → 契约 3.5 链”的接线。" +
    "依赖 RIFT-89/90/91 与 kw-level、replacement.enter；[A] 属契约级缺口。不近似实现。",
  abilities,
  sourceText:
    "This enters exhausted.\n" +
    "[Reaction][>] :rb_exhaust:: [Add] :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)\n" +
    "[Level 6][>] [>>][Reaction][>] :rb_exhaust:: [Add] :rb_energy_1::rb_rune_rainbow:. (Use this ability only while you have 6+ XP.)"
} satisfies CardProgram;
