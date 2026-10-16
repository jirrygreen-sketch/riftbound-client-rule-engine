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
 *   scoring/ 的计分流程发出），filter 用内层锚点 source: "self" 指称本卡（与已合入
 *   sfd/dunebreaker、sfd/guardian-of-the-passage、ogn/hallowed-tomb 同型）。
 * - "play two Gold gear tokens"：440.2.c / 185.2.a / 350.2 / 354——被"打出"的 token 先在链上创建，
 *   再由 play 动作接手完成打出流程；token 的控制器/拥有者是能力控制者（182/183、440.4）。
 * - Gold gear token = 187.5（无印刷费用的装备 token，自带 "[Reaction][>] Kill this, [E]: [Add] [A]"）。
 * - "exhausted" 是入场状态规定（184.1 / 185.2.d：效果可以指定 token 以与默认相反的横置/就绪状态进场），
 *   不是事后横置（143.4；effect.exhaust 文件头明确先创建再补横置不等价，会多一次"成为横置"事件）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required——三处依赖未合入，均不近似实现：
 * - Gold 定义（187.5，自带能力的 token）不在 effect.token 的冻结定义表里；该文件明确此类定义保持
 *   blocked/judge-required，对 "gold" 执行会得到 negated / blockedReason: token-definition-or-abilities-judge-required
 *   （与已合入 sfd/trove-golem、sfd/honest-broker、sfd/treasure-hoard 同款缺口）。
 * - "play … tokens" 要求先在链上创建再接手打出（440.2.c / 185.2.a）；冻结的 create-token 只在场上创建，
 *   effect.token 的 mode "play" 对不支持的定义被显式 negated。
 * - "exhausted" 的入场状态改写不被 create-token/play 支持（184.1 / 185.2.d）。
 * - hold 触发的卡牌注册与 Hold 时点载荷（此处不需要额外载荷）属 RIFT-120。
 * 依赖：Gold 定义与链上创建/入场状态（token 原语的后续任务）、RIFT-120（触发注册）。
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
    "Gold gear token（CR 187.5，自带「Kill this, [E]: [Add] [A]」能力）不在 effect.token 的冻结定义表里——" +
    "该文件明确此类定义保持 blocked/judge-required，对「gold」执行会得到 negated/blockedReason: token-definition-or-abilities-judge-required。" +
    "「play two … tokens」还必须按 440.2.c/185.2.a/350.2/354 先在链上创建再由 play 接手，冻结的 create-token 只在场上创建、" +
    "effect.token 的 mode「play」对不支持的定义被显式 negated；「exhausted」是入场规定（184.1/185.2.d），create-token/play 不支持改写，" +
    "事后 effect.exhaust 不等价（143.4）。hold 触发的卡牌注册属 RIFT-120。" +
    "依赖：Gold 定义与链上创建/入场状态（token 原语任务）、RIFT-120。不近似实现。",
  abilities,
  sourceText: "When I hold, play two Gold gear tokens exhausted."
} satisfies CardProgram;

export default program;
