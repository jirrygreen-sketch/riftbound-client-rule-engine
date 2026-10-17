import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Glowstone (ven-133-166) — Gear, 2 Energy, no printed Power, no Might,
 * Order, no tags.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-133-166，逐字）：
 *   "[Empower] :rb_rune_rainbow::rb_rune_rainbow: (:rb_rune_rainbow::rb_rune_rainbow::
 *    Empower me. Use only if not Empowered.)
 *    Disempower this, :rb_exhaust:: Choose a player. They gain control of this
 *    and recall it. (Send it to their base.)
 *    At the end of your turn, kill this and deal 5 to all units you control."
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1.c / 827.1.c.1：Empower 是启动式能力关键词，本卡印刷费用是 2 个
 *   :rb_rune_rainbow:，"Use only if not Empowered" 是启动限制；827.1.b.1：来源不是目标。
 * - 135.2.e.5 / 135.2.e.5.a / 163.2.b：:rb_rune_rainbow: 是任意域 Power [A]；
 *   费用计划以 kind:"power"、amount:2 与六域 allowedDomains 表达两个 [A]，
 *   不需要新增 Domain 值；golden 验证各域 Power 的支付分配。
 * - 443.1 / 443.2 / 443.2.a：Disempower 是移除 Empowered 状态的受限动作，出现在冒号前
 *   时是启动费用；415.3.a / 415.5：:rb_exhaust: 是横置来源的费用。
 * - 355.5 / 355.9.a / 355.10.e："Choose a player." 选择一个玩家（355.9.a 允许玩家作为
 *   Target）；被选玩家就是随后 "They …" 的施动者。冻结 IR 的 ObjectSelector 只覆盖
 *   对象（self/source/target/pick/linked），已合入指令注册表也没有选择玩家的指令，
 *   因此程序用一个明确标注的占位 PlayerId 记录该席位，不伪造真实玩家。
 * - 127 / 190 / 191："They gain control of this" 是 take-control（契约 3.6 的
 *   take-control GameAction，effect.control 已合入）。
 * - 457 / 458 / 459 / 460："and recall it" 是 Recall：把永久物移回其 Base，不是 Move；
 *   effect.move 的 mode "recall" 被原语显式阻断，不得用 move-location 近似。
 * - 317.1.a / 317.2.c："At the end of your turn" 是回合结束时的触发能力，对应封闭时点
 *   turn-end；"your turn" 指能力控制者（190.6.d/191.1）。
 * - 429.1：kill this 是 Kill 动作（effect.kill 的 self 形态已合入）。
 * - 418.1 / 418.1.c / 355.10.d："deal 5 to all units you control" 是按特征程序化选出的
 *   集合（"all units you control" 从不做选择），不是目标；effect.damage 只接受
 *   Finalize 锁定的 TargetSpec（ctx.targets），没有 effect.ready / effect.heal 那样的
 *   { kind: "query", filter } 非目标集合分支（同 ogn/flurry-of-blades 的判定）。
 *
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：
 * - 旧 judgeReason 的「turn-end 触发注册未接线（契约 3.5）」已不成立：触发注册
 *   （programs/triggers.ts）与替换绑定（programs/statics.ts 的 bindReplacement）均已合入；
 *   本卡 turn-end 触发未转 executable 的原因只剩第 4 条的伤害集合形态。
 * - continuous.grant-keyword / effect.empower 也已注册，本卡不使用。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 缺 Empower/Empowered KeywordDef：keywords/registry.generated.ts 没有
 *    "empower"/"empowered" 展开，尚不能把本卡的两个 [A] 费用绑定为 Empower 启动能力；
 *    [A] 的费用表示与支付分配本身已支持。
 * 2. 启动费用里的 Disempower 没有付费种类：cost/plan-values.ts 的 readCost 非标准费用
 *    只支持 exhaust/discard/recycle/kill/reveal/spend-buff。
 * 3. "Choose a player. They gain control of this and recall it"：Recall 被 effect.move 的
 *    mode "recall" 显式阻断（457–460，不是 Move）；"Choose a player" 也没有卡牌可用的
 *    Player 选择表达（冻结的 ObjectSelector 只有对象选择器，指令注册表也没有
 *    select-player 形态，故席位用占位值记录，不可执行）。
 * 4. "At the end of your turn, kill this and deal 5 to all units you control"：
 *    "all units you control" 的伤害缺非目标集合形态（effect.damage 只读 TargetSpec，
 *    355.10.d 的集合不能写成目标）。
 * golden 覆盖身份/结构与 effect.kill(self) 的真实执行；缺依赖记 test.todo。
 * 依赖：新的 Empower/Empowered 关键词任务、Recall 独立动作、非目标集合的伤害形态。
 */
const abilities: Ability[] = [
  {
    // 827.1.c：印刷费用为两个 [A]；只声明关键词身份，展开归关键词注册表。
    kind: "keyword",
    keyword: "empower",
    value: 2
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // "Disempower this, :rb_exhaust:" — 443.2.a 的 Disempower 与 415.5 的横置都是费用；
      // Disempower 付费种类未合入（见 judgeReason 第 2 条）。
      payments: [
        { kind: "disempower", object: "self" },
        { kind: "exhaust", object: "self" }
      ]
    },
    body: [
      {
        id: "glowstone.give-control",
        // "They gain control of this …" — 契约 3.6 的 take-control 动作（effect.control 已合入）；
        // "They" 是前一句 "Choose a player." 选出的玩家。冻结的 ObjectSelector 只有对象
        // 选择器、指令注册表也没有选择玩家的形态，因此该席位以占位 PlayerId 记录
        // （同 threshold-of-the-gray 对缺失席位选择器的处理），不可执行、不静默改控。
        op: "effect.control",
        args: {
          // 契约 3.6 的对象选择器写法（"self" / "source" 是符号字符串；
          // 与已合入的 rad/mordekaiser-twice-slain、rad/ezreal-dashing 一致）。
          objects: { kind: "constant", value: "source" },
          player: { kind: "constant", value: "chosen-player" }
        }
      },
      {
        id: "glowstone.recall",
        // "… and recall it" — 457/458/459/460 的 Recall：移回其 Base 且不是 Move。
        // effect.move 的 mode "recall" 被原语显式阻断（会带回 blockedReason），
        // 不得用 move-location 近似（458.1/458.3）。
        op: "effect.move",
        linkedTo: "glowstone.give-control",
        args: {
          objects: { kind: "constant", value: "source" },
          to: { kind: "constant", value: "controller-base" },
          mode: { kind: "constant", value: "recall" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    // "At the end of your turn" — 317.1.a 的回合结束时点；"your turn" = 能力控制者（190.6.d/191.1）。
    trigger: { at: "turn-end", filter: { event: "turn-end", player: "self" } },
    optional: false,
    body: [
      {
        id: "glowstone.kill-this",
        // "kill this" — 429.1 的 Kill 动作；effect.kill 的 self 形态（429.2.a 要求对象在场上）。
        op: "effect.kill",
        args: { self: { kind: "constant", value: true } }
      },
      {
        id: "glowstone.deal-5-to-your-units",
        // "and deal 5 to all units you control" — 按特征程序化选出的集合（355.10.d），
        // 从不做选择，因此不是目标；effect.damage 只读 ctx.targets(id) 的 TargetSpec，
        // 没有非目标集合分支（见 judgeReason 第 4 条），故按已合入的 ogn/flurry-of-blades
        // 同一写法用 { kind: "query", filter } 描述该集合，不声明 TargetSpec（355.7/754：
        // 不能触发"成为目标"）。
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 5 },
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: { type: "unit", zone: "board", controller: "self" }
            }
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-f4f95f0992a519e07673e9e9d3ea66ae5196b1e0be2c8a2847aa8697cfdccf53",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) 缺 Empower/Empowered KeywordDef：keywords/registry.generated.ts 没有 " +
    "\"empower\"/\"empowered\" 展开，827.1.c.1 的启动费用与「Use only if not Empowered」限制无执行路径；" +
    "印刷的两个 :rb_rune_rainbow:（任意域 Power [A]，135.2.e.5.a/163.2.b）已可用 kind:power 与六域 " +
    "allowedDomains 表达并进行支付分配（golden 覆盖），缺口是关键词展开与费用绑定。" +
    "(2) 启动费用里的「Disempower this」没有付费种类：cost/plan-values.ts 的 " +
    "readCost 非标准费用只支持 exhaust/discard/recycle/kill/reveal/spend-buff（443.2.a 的 Disempower 是受限动作）。" +
    "(3)「Choose a player. They gain control of this and recall it」里，Recall 被已合入的 effect.move 的 mode " +
    "\"recall\" 显式阻断（457–460：Recall 不是 Move，不发 Move 事件、不受移动限制），不得用 move-location 近似；" +
    "玩家选择也没有卡牌可用的 select-player 指令形态（265/355.10.e 的选择记录未合入）。" +
    "(4)「At the end of your turn, kill this and deal 5 to all units you control」的「all units you control」是按特征" +
    "程序化选出的集合（355.10.d，从不做选择），effect.damage 只接受 Finalize 锁定的 TargetSpec，没有非目标集合分支" +
    "（turn-end 时点与触发注册本身已合入，programs/triggers.ts 可消费 turn-end 模式）。golden 覆盖身份/结构与 " +
    "effect.kill(self) 的真实执行。依赖：新的 Empower/Empowered 关键词任务、Recall 独立动作、非目标集合伤害形态。",
  abilities,
  sourceText:
    "[Empower] :rb_rune_rainbow::rb_rune_rainbow: (:rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
    "Disempower this, :rb_exhaust:: Choose a player. They gain control of this and recall it. (Send it to their base.)\n" +
    "At the end of your turn, kill this and deal 5 to all units you control."
} satisfies CardProgram;
