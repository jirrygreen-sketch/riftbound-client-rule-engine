import type { CardProgram } from "../../ir/index.js";

/**
 * Sprite Burst (unl-069-219) — Spell, 5 energy, no printed power, no Might,
 * Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-069-219，逐字）：
 *   "Play two ready 3 :rb_might: Sprite unit tokens with [Temporary]. (Kill each
 *    at the start of its controller's Beginning Phase, before scoring.)"
 *
 * 规则依据（CR v1.5）：
 * - 「Play two … Sprite unit tokens with [Temporary]」：187.2 规定 3 [M] Sprite
 *   token 是无领域单位 token，3 Might、Fae 标签、带 [Temporary] 关键词；
 *   185.3.a 规定 token 没有费用（不是 0）。被「Play」的 token 按 440.2.c /
 *   185.2.a 先在链上创建再由 play 接手，形状即 effect.token 的 mode "play"。
 * - 「two」是数量 2（185/187 由产生效果指定数量）。
 * - 「ready」是入场状态改写：143.4 默认单位横置入场，184.1 / 185.2.d 允许创建
 *   token 的效果直接规定就绪入场，而不是事后补一次 effect.ready（那会多产生
 *   "成为就绪"事件，805.6 明说不存在"先横置再就绪"）。
 * - [Temporary]（816.1.b）是该 token 自带的触发关键词，属于 token 定义，
 *   不是本卡的独立指令。
 *
 * status = judge-required（不近似实现）：
 * - 已合入的 effect.token 只在冻结定义表（recruit / sand-soldier / mech /
 *   reflection / tentacle）里解析 token 定义；带自身能力的 token（Sprite 带
 *   Temporary，187.2）被显式阻断（blockedReason
 *   "token-definition-or-abilities-judge-required"），因此 sprite 定义缺失；
 * - create-token 不支持入场状态改写，"ready" 无法表达（143.4 / 184.1 /
 *   185.2.d）；fixture 里的 entersReady 参数不在 effect.token 的 ARGUMENTS
 *   白名单内，实测直接 TypeError（"Invalid effect.token argument: entersReady"），
 *   所以它只是待办说明而不是可用 IR；
 * - Temporary 关键词展开（RIFT-265 已合入 keywords/Temporary.ts，816.1.b）只
 *   解决 token 自身的触发；token 定义与就绪入场仍缺失。
 * 依赖：effect.token 定义表扩充（按 187.2 的官方 Sprite）与入场状态改写；
 * 不用其他 token 替代 Sprite，也不先创建再补 ready。
 */
const spriteBurst = {
  canonicalCardId: "card.hash-a332f02df43a6859fd03ddb42f9dc18e759e93aba321780ca24792d78ad7cdac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Sprite token 定义与 ready 入场改写：CR 187.2 的 3 [M] Sprite token 是「无领域 + 3 Might + Fae 标签 + [Temporary]」" +
    "的单位 token；已合入的 effect.token 只在冻结定义表（recruit/sand-soldier/mech/reflection/tentacle）解析定义 id，" +
    "带自身能力的 token 被显式阻断（blockedReason: token-definition-or-abilities-judge-required），sprite 定义缺失；" +
    "golden 用同一 mode \"play\" 形状的可解析定义证明「create on Chain → play」交接本身已可用，缺口只在定义与入场状态。" +
    "「ready」是入场状态改写（143.4 默认横置入场 / 184.1 / 185.2.d），create-token 明确不支持 entry override，" +
    "先创建再补 effect.ready 会产生错误的「成为就绪」事件；fixture 里的 entersReady 也不在 effect.token 的 ARGUMENTS 白名单内" +
    "（实测 TypeError \"Invalid effect.token argument: entersReady\"）。Temporary 关键词展开（816.1.b，RIFT-265）只覆盖" +
    "token 自身触发，不能替代 token 定义与入场状态。依赖：effect.token 定义表扩充与入场状态改写；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "sprite-burst.play-two-sprites",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 2 },
            // 440.2.c / 185.2.a：被「Play」的新 token 先在链上创建，再交给 play 流程。
            mode: { kind: "constant", value: "play" },
            // 440.4 / 185.2.a：token 由本效应的控制者拥有，入场到其基地。
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            // 143.4 / 184.1 / 185.2.d：印刷的「ready」是入场状态规定；
            // create-token 尚不支持该改写（见 judgeReason），此处仅记录。
            entersReady: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "sprites" }
          }
        }
      ]
    }
  ],
  sourceText:
    "Play two ready 3 :rb_might: Sprite unit tokens with [Temporary]. " +
    "(Kill each at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default spriteBurst;
