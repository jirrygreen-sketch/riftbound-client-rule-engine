import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Eminent Benefactor (sfd-152-221) — Unit, Order, Piltover.
 * energy 6, power: none printed, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-152-221，逐字）:
 *   "When I hold, play two Gold gear tokens exhausted."
 *
 * 规则依据（CR v1.5）：
 * - "When I hold"（383.4.d / 383.4.d.2.a）：Hold Effect，时点 hold（315.2.b.2 / 471.2 / 473.2.b；
 *   turn/flow.ts 的计分流程发出），filter 用内层锚点 source: "self" 指称本卡（与已合入
 *   sfd/dunebreaker、sfd/guardian-of-the-passage、ogn/hallowed-tomb 同型）。
 * - "play two Gold gear tokens"：440.2.c / 185.2.a / 350.2 / 354——被"打出"的 token 先在链上创建，
 *   再由 play 动作接手完成打出流程；token 的控制器/拥有者是能力控制者（182/183、440.4）。
 * - Gold gear token = 187.5（无印刷费用的装备 token，自带 "[Reaction][>] Kill this, [E]: [Add] [A]"）。
 * - "exhausted" 是入场状态规定（184.1 / 185.2.d：效果可以指定 token 以与默认相反的横置/就绪状态进场），
 *   不是事后横置（143.4；effect.exhaust 文件头明确先创建再补横置不等价，会多一次"成为横置"事件）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required——依赖仍未合入，均不近似实现：
 * - mode "play" 的链上创建 + 打出路径已合入（effect.token 会先 create-token 到 Chain 再由 play 接手，
 *   实测 mech/sand-soldier 等定义可执行），但 Gold 定义（187.5，自带 "Kill this, [E]: [Add] [A]" 能力）
 *   仍不在 DEFINITIONS 表里：对 "gold" 执行得到 negated / blockedReason:
 *   token-definition-or-abilities-judge-required（与已合入 sfd/trove-golem、sfd/honest-broker、
 *   sfd/treasure-horde 同款缺口）。
 * - "exhausted" 的入场状态改写不被 create-token/play 支持：effect.token 的 ARGUMENTS 集合不含
 *   entersExhausted，实测 schema 抛 "Invalid effect.token argument: entersExhausted"；也没有任何
 *   place 提交横置入场（184.1 / 185.2.d；143.4 明确事后 effect.exhaust 不等价）。
 * - 相对控制者的目的地也不可求值：effect.token 的 location 只接受常量 LocationRef，不接受
 *   location 表达式（实测抛 "Invalid effect.token argument: location"），因此
 *   { type: "base", player: "controller" } 无法解析为相对控制者的 Base。
 * - 通用触发注册已合入，但 hold 只发出 player/details.battlefieldId（payload 无对象），
 *   source: "self" 被翻译为 event.object，实测匹配返回 false，仍缺 383.4.d.2.a 所需的
 *   驻守单位/战场过滤绑定。
 * 仍缺 Gold 定义、横置入场规定、相对控制者目的地与单位 Hold 绑定。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "hold",
      filter: { event: "hold", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "eminent-benefactor.play-gold-tokens",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 2 },
          // 440.2.c / 185.2.a：被"打出"的 token 先在链上生成。
          mode: { kind: "constant", value: "play" },
          // 440.2.b.1：效果未指定地点时，永久物在可打出的位置上创建（此处为控制者的 Base）。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          // 184.1 / 185.2.d 的入场状态规定，绝不是事后 effect.exhaust（143.4）。
          entersExhausted: { kind: "constant", value: true },
          linkKey: { kind: "constant", value: "goldTokens" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-817b13977c7d2a024cbbd611deceb4cb9fc4c925146ad3da8e575aee8d77325f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "effect.token 的 mode \"play\" 已有链上创建和打出路径（CR 440.2.c/185.2.a），" +
    "但仍缺 Gold 的完整定义与能力（187.5）、entersExhausted 入场规定（184.1/185.2.d），" +
    "以及 { type: \"base\", player: \"controller\" } 的相对控制者 LocationRef 绑定：" +
    "effect.token 的 location 只接受常量 LocationRef，写 location 表达式实测抛 " +
    "\"Invalid effect.token argument: location\"。" +
    "另缺单位 Hold 的事件/位置过滤绑定（383.4.d.2.a）：turn/flow.ts 的 hold 只含 player 与 details.battlefieldId，" +
    "payload 没有对象，programs/filters.ts 的 source: \"self\" 却要求 event.object，实测匹配为 false，" +
    "不能判定本单位驻守了该战场。" +
    "不能用其他 token 定义替代 Gold，也不能以事后横置代替横置入场（143.4）。",
  abilities,
  sourceText: "When I hold, play two Gold gear tokens exhausted."
} satisfies CardProgram;

export default program;
