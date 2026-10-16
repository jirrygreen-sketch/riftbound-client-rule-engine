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

 * status = judge-required（README 第 2 节）。四处缺口，均不近似实现：
 * 1. Bird token 定义（187.7，带 Deflect 关键词）不在已冻结的 effect.token 定义表内；
 *    原语返回 blockedReason token-definition-or-abilities-judge-required，不会凭卡面
 *    文本替 token 造出 Deflect。
 * 2. 「Play a … token」需要链上生成 + 打出管线：effect.token 的 mode "play" 路径在参考
 *    内核里可用（create-token to chain + play），但生产链（chain/effect.play 的
 *    FinalizedCostPlan 交接）与 token 定义表仍未合入。
 * 3. Deathknell 的完整展开未合入：effects/keywords/Deathknell.ts 的指令体引用
 *    trigger.leave（无该 op 文件），且 808.1.d.1 的「死亡被替代则移出链」需要
 *    chain/events 侧处理。
 * 4. Deflect 展开（809.1.c 的目标附加费用）需要 target.tax 与 cost.pay 管线（RIFT-90/
 *    RIFT-89），当前没有消费方。
 * 下面保留有依据的形状：关键词声明 + object-killed 自发触发 + effect.token（mode play、
 * 目的地控制者基地）；golden 测试真实执行 187.7 语义可验证的 token 创建路径与
 * effect.token 的 blocked 路径，其余写 test.todo。
 * 依赖：RIFT-62/RIFT-63（token 与链上生成）、RIFT-82（kw-deathknell-legion）、
 * RIFT-84（kw-deflect-hidden 的 target.tax 同批）、生产打出管线（契约 §7.2 批 4/5）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    trigger: { at: "object-killed", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "hunting-dog.play-bird-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：新 token 的“打出”先在链上生成，再由 play 接手。
          mode: { kind: "constant", value: "play" },
          // "to your base"（182/183、440.4）：目的地是能力控制者的基地。
          locations: {
            kind: "constant",
            value: [{ type: "base", player: "controller" }]
          },
          choiceId: { kind: "constant", value: "bird-token-base" },
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
    "四处缺口，均不近似实现：(1) Bird token 定义（187.7，1 Might、Bird 标签、带 [Deflect]）不在已冻结的 " +
    "effect.token 定义表内，原语返回 blockedReason token-definition-or-abilities-judge-required，" +
    "不会凭卡面替 token 造出 Deflect；(2) 「Play a … token」需要链上生成 + 生产打出管线交接 " +
    "（440.2.c/185.2.a/350.2/354），参考内核可用但生产链未合入；(3) Deathknell 展开未完成：" +
    "effects/keywords/Deathknell.ts 的指令体引用尚未合入的 trigger.leave，808.1.d.1 的「死亡被替代则移出链」" +
    "也需要 chain/events 侧处理；(4) Deflect 展开（809.1.c 的目标附加费用）需要 target.tax 与 cost.pay 管线（RIFT-90/RIFT-89）。" +
    "已写出的形状：deathknell 关键词声明 + object-killed 自发触发 + effect.token（mode play、目的地控制者基地）。" +
    "依赖：RIFT-62/RIFT-63（token 与链上生成）、RIFT-82（kw-deathknell-legion）、RIFT-84（target.tax）、契约 §7.2 批 4/5 打出管线。",
  abilities,
  sourceText:
    "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
    "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;

