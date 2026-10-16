import type { CardProgram } from "../../ir/index.js";

/**
 * Death Mark (ven-144-166) — Spell, 2 energy + 1 Fury/Chaos power, tags Zed/Signature.
 * Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-144-166，逐字）:
 *   "[Burn 3]. (Put the top 3 cards of your Main Deck into your trash.)\n"
 *   "Play a 0 :rb_might: Shadow Clone unit token. (It has \"When I attack, you may banish a unit
 *    from your trash. If you do, give me [Assault 4] this turn.\")\n"
 *   "[Flow] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）：
 * - "[Burn 3]"：441.1/441.2 的 Burning（把主牌库顶 3 张移入弃牌区），441.4 要求尽可能多地烧；
 *   已合入的 effect.mill 用 zoneSlice 按真实区域顺序取顶、提交封闭 GameAction `mill`
 *   （Burn Out 的后续由内核负责，原语只读取真实结果；同型记录见 ven/shadow-temple）。
 *   括号句是 441.2 的格式说明（不是第二条能力），Burn 在 441.1.a 之后结算触发。
 * - "Play a 0 :rb_might: Shadow Clone unit token"：440.2.c/185.2.a 规定「打出」一个新 token
 *   先在 Chain 上生成再交给打出流程（420.3/420.3.a），这正是已合入 effect.token 的 mode "play"；
 *   187.11 固定 Shadow Clone 的印刷特征（domainless 单位 token，0 Might，自带
 *   "When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn."）。
 *   token 费用为 null（185.3，绝不改写成 0）。
 * - [Flow]（829）同其他卡：只声明关键词身份，展开归 keywords/Flow.ts。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处依赖未合入，均不近似实现：
 * (1) Shadow Clone 的 token 定义不在 effect.token 的冻结定义表内：该表只含
 *     recruit / sand-soldier / mech / reflection / tentacle 这些**没有额外能力**的定义，
 *     187.11 的 Shadow Clone 自带一条攻击触发，原语因此以
 *     blockedReason "token-definition-or-abilities-judge-required" negated，
 *     不创建任何错误 token（同型记录见 ogn/sprite-call、rad/hexplosive-minefield 的 Bomb）。
 * (2) 该 token 内嵌能力的依赖闭合未落地："When I attack …"（383.4.e 的攻击触发）需要
 *     attack-declared 时点与卡牌程序触发注册（RIFT-120），"banish a unit from your trash"
 *     需要从 Trash 选择单位的 pick 与 effect.banish 的组合，"give me [Assault 4] this turn"
 *     需要带期限的 continuous.grant-keyword（未注册）与 Assault 的图层展开（RIFT-81/RIFT-91）。
 *     RIFT-9 调研明确要求 token 的被引用能力必须有依赖闭包，不能只看本卡出现的词。
 * (3) [Flow] 的备选费用与延迟替代路径未合入（829.1.b/829.1.c；依赖 RIFT-261 与 RIFT-260）。
 * 已合入且可真实执行的部分：[Burn 3] 的 effect.mill（441.1/441.2/441.4）；golden 用真实原语
 * 执行烧牌半段（含牌库不足只烧得到的部分），token 与 Flow 部分用 test.todo 记录。
 */
const deathMark = {
  canonicalCardId: "card.hash-abf7e6ef39804eabe153a1ee70a3ec9ebdb7f4da0b7ad72855b0aa57798dd5c2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1) Shadow Clone token 的定义不在 effect.token 的冻结定义表内" +
    "（该表只含没有额外能力的 recruit / sand-soldier / mech / reflection / tentacle），" +
    "187.11 的 Shadow Clone 自带攻击触发，原语以 blockedReason \"token-definition-or-abilities-judge-required\" " +
    "negated，不创建任何替代 token（同型记录见 ogn/sprite-call、rad/hexplosive-minefield 的 Bomb）。" +
    "(2) token 内嵌能力的依赖闭包未落地：383.4.e 的攻击触发需要 attack-declared 时点与卡牌程序触发注册" +
    "（RIFT-120），「banish a unit from your trash」需要 Trash 的 pick 与 effect.banish 组合，" +
    "「give me [Assault 4] this turn」需要带期限的 continuous.grant-keyword（未注册）与 Assault 图层展开" +
    "（RIFT-81/RIFT-91）；RIFT-9 调研要求 token 的被引用能力必须有依赖闭包。" +
    "(3) [Flow]（829.1.b/829.1.c）的备选费用与延迟替代需要 RIFT-261（费用消费方）与 RIFT-260" +
    "（替代注册/排序），没有卡牌侧生产者。" +
    "已支持部分：[Burn 3] 用已合入的 effect.mill（441.1/441.2/441.4，顶 3 张按真实区域顺序入弃牌区、" +
    "牌库不足只烧得到的部分），golden 用真实解释器 + 参考内核执行。",
  abilities: [
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // "[Burn 3]" / "Put the top 3 cards of your Main Deck into your trash."
          // （441.1/441.2/441.4）：烧牌者缺省为能力控制者（190.6.d），
          // 主牌库顶与 Burn Out 的后续由内核拥有。
          id: "death-mark.burn-3",
          op: "effect.mill",
          args: { amount: { kind: "constant", value: 3 } }
        },
        {
          // "Play a 0 :rb_might: Shadow Clone unit token"：440.2.c/185.2.a 的链上生成 + 打出。
          // 定义 id "shadow-clone" 不在冻结定义表内，原语会以 blockedReason negated
          // （见 judgeReason 第 1 点），不会创建替代 token。
          id: "death-mark.play-shadow-clone",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "shadow-clone" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "shadowClone" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Burn 3]. (Put the top 3 cards of your Main Deck into your trash.)\n" +
    "Play a 0 :rb_might: Shadow Clone unit token. (It has \"When I attack, you may banish a unit " +
    "from your trash. If you do, give me [Assault 4] this turn.\")\n" +
    "[Flow] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default deathMark;
