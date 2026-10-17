import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Hunting Dog (rad-119-167) — Unit, 3 Energy, Might 3, Order.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-119-167，逐字）：
 *   "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your
 *    base. (When I die, get the effect. Opponents must pay :rb_rune_rainbow: to
 *    choose a [Deflect] unit with a spell or ability.)"
 *
 * 规则依据（CR v1.5）：
 * - 808.1 / 808.1.c：Deathknell 是触发式能力关键词，功能上等于 "When I die, [Effect]"；
 *   808.1.d：触发条件是永久物被消灭并送入 Trash；808.1.d.1：死亡被替代（如召回）时
 *   触发从链上移除；808.1.d.3：换区前记录位置与属性。卡牌只声明关键字
 *   （契约 3.1 / README 第 5 节），展开归 effects/keywords/Deathknell.ts（已合入声明，
 *   其指令体引用 trigger.leave，该原语尚未合入）。
 * - 808.1.b.1 / 808.1.c.1：[Effect] 是这一实例的具体规则文本，因此把
 *   "Play a 1 [M] Bird unit token ..." 写成显式 triggered 能力（时点 object-killed，
 *   filter self），与被声明关键词是一对（同 sfd/unsung-hero、ogn/ekko-recurrent 的写法）。
 * - 187.7：1 [M] Bird token 是域无关 1 Might 单位 token，带 Bird 标签与 Deflect。
 * - 440.2.c / 185.2.a / 350.2 / 354：被“打出”的新 token 先在链上生成，再由 play
 *   动作接手；185.3 费用为空。
 * - "to your base" = 控制者的基地（182/183 的归属与控制；443.2 的 token 归属）。
 * - 809.1：Deflect 是目标附加费用的被动关键词（松鼠文本给出 809.1.c 的提醒）。

 * status = judge-required（README 第 2 节，2026-10-17 复核）。逐条复核后的当前缺口（均实测），不近似实现：
 * 1. Bird token 定义（187.7，带 Deflect 关键词）仍不在 effect.token 的定义表内；
 *    bird 请求实测 negated 且 blockedReason = token-definition-or-abilities-judge-required；
 *    需要把该带能力的 token 定义与能力展开纳入 token 执行路径，不能凭卡面文本近似造出 Deflect。
 * 「to your base」已可由 LocationExpr 的 ability-controller-base 表达：先用
 * condition.value 绑定地点，再让 effect.token 读取 linked-value；这样兼容原语的 Expr
 * schema，不把相对玩家写进字面 LocationRef，也不硬编码具体玩家。
 * 2. Deathknell 关键词的展开体仍引用 trigger.leave，而 instructionDefinitionsById
 *    无该 op，需要接通正文订阅与 808.1.d.1 的死亡替代链移除。
 * 3. Deflect 的展开是 static target.tax，尚无静态绑定：programs/statics.ts 的层映射
 *    对该 kind 抛 no layer mapping；目标计划已有税适配接口，但 ChainEngine 仍把税按
 *    Energy 计入（实测 costPlan.total.energy 多 1、power 为空），需要按 809.1.c.1
 *    改为任意域 Power。
 * 下面保留有依据的形状：关键词声明 + object-killed 自发触发 + effect.token（mode play、
 * 目的地写法）；其余依赖保持 judge-required。
 * 依赖：Bird token 定义与能力展开、Deathknell 事件路径、Deflect
 * 目标税费用适配器；动态基地绑定已有执行证据。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    trigger: { at: "object-killed", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "hunting-dog.base",
        op: "condition.value",
        args: {
          value: { kind: "location", value: "ability-controller-base" }
        }
      },
      {
        id: "hunting-dog.play-bird-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：新 token 的“打出”先在链上生成，再由 play 接手。
          mode: { kind: "constant", value: "play" },
          // "to your base"（182/183、440.4）：目的地是能力控制者的基地。
          location: {
            kind: "linked-value",
            instructionId: "hunting-dog.base",
            key: "value"
          },
          linkKey: { kind: "constant", value: "birdToken" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-883ac11e924326f2848f19e337d6d2f7e70dc660d572f974d06708fc1f752353",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（实测），均不近似实现：(1) Bird token 定义（187.7，1 Might、Bird 标签、带 [Deflect]）仍不在 effect.token 的定义表内，" +
    "bird 请求 negated（token-definition-or-abilities-judge-required），需要把带能力的 token 定义与能力展开纳入 token 执行路径。" +
    "(2) Deathknell 的展开体仍引用未注册的 trigger.leave（instructionDefinitionsById 无该 op），" +
    "需接通正文订阅及 808.1.d.1 的死亡替代链移除。" +
    "(3) Deflect 的 static target.tax 无程序静态绑定（layerFor 抛 no layer mapping）；目标计划虽有税适配接口，" +
    "ChainEngine 当前仍把税计入 Energy（实测 total.energy 增加、power 为空），还需按 809.1.c/809.1.c.1 计入任意域 Power 附加费用。",
  abilities,
  sourceText:
    "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
    "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;

