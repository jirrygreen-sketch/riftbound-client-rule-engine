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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：旧 judgeReason 的 RIFT-89/RIFT-120/RIFT-81~88
 * 引用已过时，缺口按当前源码重述：
 * 1. 缺 Empower/Empowered KeywordDef：keywords/registry.generated.ts 没有
 *    "empower"/"empowered" 展开的 KeywordDef。
 * 2. 启动费用里的 Disempower 没有付费种类：cost/plan-values.ts 的 readCost 非标准
 *    费用只支持 exhaust/discard/recycle/kill/reveal/spend-buff，kind "disempower"
 *    会被 blocked（同 rad/boy-who-shattered-time、ven/matriarch-of-war 的记录）。
 * 3. "Play a 3 :rb_might: Mech unit token to your base" 的链上生成 + 打出路径：
 *    effect.token 的 mode "play" 在参考内核可执行（链上创建 + play 接手），但生产链的
 *    token 链项接收方（440.2.c/185.2.a）仍未接线（同 sfd/assembly-rig 的判定）：
 *    生产链 routeAction 对 play 动作要求 describePlay 卡牌程序适配器，token 没有
 *    cardId 也就没有绑定。
 * golden 用真实解释器执行 effect.token 的 Mech 定义与打出路径，并断言 Disempower 费用
 * 种类被费用计划拒绝；不近似实现（不用 kill/reveal 等别的费用种类替换 Disempower）。
 * 依赖：新的 Empower/Empowered 关键词任务、RIFT-89（Disempower 费用种类）、
 * RIFT-120 的 token 链项接收方与契约 3.5 接线。
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
    "三处缺口，均不近似实现：(1) 缺 Empower/Empowered KeywordDef：keywords/registry.generated.ts 没有 " +
    "\"empower\"/\"empowered\" 展开的 KeywordDef，827.1.c.1 的横置启动费用与" +
    "「Use only if not Empowered」限制无执行路径（827.1.b.1：来源不是目标）。" +
    "(2) 启动费用里的「Disempower this」没有付费种类：cost/plan-values.ts 的 readCost 非标准费用只支持 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff，kind \"disempower\" 会被 blocked（443.2/443.2.a 的 " +
    "Disempower 是受限动作；同 rad/boy-who-shattered-time 的记录）。" +
    "(3)「Play a 3 :rb_might: Mech unit token to your base」需要 440.2.c/185.2.a 的链上生成再打出：" +
    "effect.token 的 mode \"play\" 在参考内核可执行（golden 断言链上创建与 play 事件接手），但生产链的 " +
    "token 链项接收方仍未接线——routeAction 对 play 动作要求 describePlay 卡牌程序适配器，" +
    "token 没有 cardId 也就没有绑定（同 sfd/assembly-rig 的判定）。" +
    "golden 另实测 Disempower 费用种类被费用计划拒绝；不近似实现（不用 kill/reveal 等别的费用种类替换 Disempower）。" +
    "依赖：新的 Empower/Empowered 关键词任务、disempower 付费种类、生产链 token-play 接收方。",
  abilities,
  sourceText:
    "[Empower] — :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)\n" +
    "Disempower this, :rb_energy_1:, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;
