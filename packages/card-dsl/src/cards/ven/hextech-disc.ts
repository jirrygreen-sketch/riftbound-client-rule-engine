import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Hextech Disc (ven-087-166) — Gear, 4 Energy + 1 printed Power (Body),
 * no Might, Body, no tags.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-087-166，逐字）：
 *   "[Empower] — :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)
 *    Disempower this, :rb_energy_1:, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1.c / 827.1.c.1：Empower 是启动式能力关键词，本卡印刷费用是横置来源
 *   （415.5："Exhaust this"），"Use only if not Empowered" 是 827.1.c.1 的启动限制；
 *   827.1.b.1：来源本身不是目标。
 * - 443.1 / 443.2 / 443.2.a：Disempower 是移除 Empowered 状态的受限动作（Limited
 *   Action），只有游戏效果指示时才执行；"Disempower this" 出现在冒号之前，是启动费用。
 * - 415.3.a / 415.5：:rb_exhaust: 是横置来源的费用；:rb_energy_1: 是 1 点资源费用。
 * - 151 / 151.2：Gear 的启动能力，默认 Action 时机（无 [Action]/[Reaction] 时按
 *   381.1 的默认时机）。
 * - 187.4：3 :rb_might: Mech 是定型 token（effect.token 的冻结定义表 "mech"：unit、
 *   Mech 标签、Might 3）；440.2 / 440.2.c / 185.2.a："play … token to your base"
 *   先在链上生成再由 play 动作接手，目的地是控制者的 Base。
 *
 * status = judge-required（缺口均不近似实现）：
 * 复核（2026-10-17，RIFT-613 第三轮 M2 覆盖率复核，实测见 test.mjs 的 probe 用例）：
 * 1. Empower/Empowered 关键词已合入（effects/keywords/Empower.ts），但本卡的印刷费用是
 *    横置来源（827.1.c），该费用没有承载通道：KeywordAbility 只有 keyword/value，
 *    expandProgram 只传 value/host，实测本卡展开出的第二条 activated.cost 是
 *    { kind: "empower" }，describeActivate 随后以 "Unsupported cost kind empower" 拒绝。
 *    展开里的 restriction.condition 读 object-property "empowered"，而 ObjectSnapshot
 *    （effects/contract.ts）不暴露 Empowered 状态——Empower.ts 头部把 "ObjectSnapshot must
 *    expose the reference kernel's live empowered count" 记为尚未合入的共享集成依赖，
 *    827.1.c.1 / 442.1.b 的 "Use only if not Empowered" 因此在契约定义的快照上没有读数来源。
 * 2. 启动费用里的 Disempower 没有付费种类：cost/plan-values.ts 的 readCost 非标准费用只支持
 *    exhaust/discard/recycle/kill/reveal/spend-buff，实测 buildCostPlan 对本卡的 disempower
 *    支付抛 CostPlanError（reason "judge-required"，message "Unsupported payment kind:
 *    disempower"）；443.2/443.2.a 的 Disempower 是受限动作，不能用别的付费种类替换。
 * 3. "Play a 3 :rb_might: Mech unit token to your base" 的生产链接收方仍未接线：
 *    effect.token 的 mode "play" 在参考内核可执行（链上创建 + play 接手），但生产链的
 *    routeAction 对 play 动作要求绑定的卡牌程序（describePlay），token 没有 cardId，
 *    实测对已创建到链上的 token 提交 play 抛 "Play action requires a card-program
 *    adapter"（同 sfd/assembly-rig 的判定）。
 * golden 用真实解释器执行 effect.token 的 Mech 定义与打出路径，并断言以上缺口：Empower
 * 展开的费用形状、Disempower 被费用计划拒绝、token-play 在生产链上没有接收方。
 * 依赖：KeywordAbility 印刷费用参数承载 + expandProgram 转发、生产 ObjectSnapshot 的
 * Empowered 状态、disempower 付费种类、生产链 token-play 接收方。
 */
const abilities: Ability[] = [
  {
    // 827.1.c：印刷费用是横置来源；只声明关键词身份，展开归关键词注册表。
    kind: "keyword",
    keyword: "empower"
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // 印刷顺序："Disempower this, :rb_energy_1:, :rb_exhaust:"。
      energy: { kind: "constant", value: 1 },
      payments: [
        // 443.2/443.2.a 的 Disempower 作为费用；付费种类未合入（见 judgeReason 第 2 条）。
        { kind: "disempower", object: "self" },
        // 415.3.a/415.5：横置来源。
        { kind: "exhaust", object: "self" }
      ]
    },
    body: [
      {
        id: "hextech-disc.play-mech-token",
        // "Play a 3 :rb_might: Mech unit token to your base." — 187.4 的 Mech 定义；
        // 440.2.c/185.2.a 先在链上生成再打出。目的地是控制者的 Base（440.2.b.1）。
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          linkKey: { kind: "constant", value: "mechToken" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-ef829cc2fd46f6ca1486fc90e662a97b9fb324fa8a832165e80e9896ab89c6ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现（2026-10-17 RIFT-613 复核实测）：(1) Empower/Empowered 关键词已合入" +
    "（effects/keywords/Empower.ts），但横置来源的印刷费用（827.1.c）没有承载通道：KeywordAbility 只有 " +
    "keyword/value，expandProgram 只传 value/host，实测本卡展开出的 activated.cost 是 { kind: \"empower\" }，" +
    "describeActivate 以 \"Unsupported cost kind empower\" 拒绝；展开的 restriction.condition 读 " +
    "object-property \"empowered\"，ObjectSnapshot（effects/contract.ts）不暴露 Empowered 状态" +
    "（Empower.ts 头部记为未合入的共享集成依赖），827.1.c.1/442.1.b 的「Use only if not Empowered」" +
    "没有契约定义的读数来源。(2)「Disempower this」没有付费种类：" +
    "cost/plan-values.ts 的非标准费用只有 exhaust/discard/recycle/kill/reveal/spend-buff，实测 buildCostPlan " +
    "抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: disempower\"）；" +
    "443.2/443.2.a 的 Disempower 是受限动作，不用别的付费种类替换。(3)「Play a 3 :rb_might: Mech unit token " +
    "to your base」的生产链接收方未接线：参考内核可执行链上创建 + play 接手，但生产链 routeAction 对 play " +
    "要求绑定的卡牌程序（describePlay），token 没有 cardId，实测对已创建到链上的 token 提交 play 抛 " +
    "\"Play action requires a card-program adapter\"（440.2.c/185.2.a）。依赖 KeywordAbility 印刷费用承载与 " +
    "expandProgram 转发、生产 ObjectSnapshot 的 Empowered 状态、disempower 付费种类、生产链 token-play 接收方。",
  abilities,
  sourceText:
    "[Empower] — :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)\n" +
    "Disempower this, :rb_energy_1:, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;
