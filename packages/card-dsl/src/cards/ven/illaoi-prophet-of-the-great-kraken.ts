import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Illaoi, Prophet of the Great Kraken (ven-109-166; 同一 canonical 身份的另一印刷为 ven-182-166) —
 * Unit, Chaos, tags Bilgewater/Illaoi/Champion。
 * 6 Energy, no printed Power（power: null，不是 0），Might 4。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-109-166，逐字；ven-182-166 文本相同）：
 *   When you play me or when I score, play a :rb_energy_1: :rb_might: Tentacle unit token from Bilgewater.
 *   I have +1 :rb_might: for each token unit you control.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a：“When you play me” 是 Play Effect（时点 card-played，420.4.a 在打出完成后触发）。
 * - 470.3 / 473.2：“when I score” 指 Scoring 过程（不是 “Score X points”），对应封闭时点
 *   "score"（events/timing-points.ts，ruleRefs 470.1/470.3/471/473.2）；473.2 要求 Trigger Score
 *   能力在“被计分的那个 Battlefield”触发。
 * - 187.10：“a 1 :rb_might: Tentacle unit token from Bilgewater” 是无领域、1 Might、Bilgewater
 *   标签的单位 token；effect.token 的冻结定义表 id "tentacle" 正是该定义。
 * - 143.2.a / 475–477：“+1 :rb_might: for each token unit you control” 是算术图层的持续
 *   Might 修正。
 *
 * status = judge-required（2026-10-18 M2 复核，三处当前缺口，均为实测，不近似实现）：
 * 1. score 触发的过滤器无法注册：卡牌写 { event: "score", ... }，但实测
 *    EVENT_PATTERN_TYPES 里是判别值 "scored"（管线映射到 score 时点），"score" 不是合法事件类名，
 *    registerTrigger 抛 TriggerSpecValidationError；用闭合拼写 "scored" 可以注册，但第二条缺口
 *    仍拦住整条链。
 * 2. 473.2 的宿主位置关联缺失：score emission 只带 player 与 details.battlefieldId，没有 object，
 *    而 translateTriggerFilter 把 source:"self" 翻译成事件 object 的自身引用；实测用闭合拼写
 *    "scored" 注册后发出真实的 score 事件，链上没有任何条目（pipeline-matcher 没有把宿主
 *    location 与 details.battlefieldId 做连接），无法只在 Illaoi 所在战场得分时触发。
 * 3. “+1 Might for each token unit you control” 无法求值：(a) 图层不计算 count 量——实测
 *    layers/engine.ts 的 valueOf 不求值 count（amount 退化为 0，建出一个 Tentacle 后 Might
 *    仍是 4）；(b) “token unit” 的合取谓词缺失——实测 layers/filter.ts 的 typeMatches 对
 *    type: "token" 同时命中 token gear（如 Gold），无法只匹配 token 单位。
 * 已支持部分：“play a 1 Might Tentacle unit token” 用已合入的 effect.token（mode "play"，187.10
 * 定义）在 golden 中真实执行，含从链上创建到打出、控制器归属与 null 费用的校验。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "illaoi.play-tentacle-token",
        op: "effect.token",
        args: {
          // 187.10：Tentacle = 1 Might、Bilgewater 标签的无领域单位 token。
          token: { kind: "constant", value: "tentacle" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成。
          mode: { kind: "constant", value: "play" },
          // 440.2.b.1：效果未指定位置时，永久物创建在“可被打到的任意位置”；
          // 单位的有界合法位置由 355.2.a 给出，静态 IR 不能写运行时 PlayerId，
          // 这里保留由消费方解析的 controller Base（同 noxian-emissary）。
          location: {
            kind: "constant",
            value: { type: "base", player: "controller" }
          },
          linkKey: { kind: "constant", value: "tentacle" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      // 470.3 / 473.2：Scoring 的封闭时点；“我得分” 的战场锚点见 judgeReason 第 1 点。
      at: "score",
      filter: { event: "score", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 同一条印文效果（187.10 的 Tentacle token）；与打出触发共用印文，
        // 但指令 id 在卡内唯一，故分为两条触发能力。
        id: "illaoi-score.play-tentacle-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "tentacle" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "constant",
            value: { type: "base", player: "controller" }
          },
          linkKey: { kind: "constant", value: "tentacle" }
        }
      }
    ]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      // “for each token unit you control”：集合计数作为算术图层的修正量
      // （求值路径与 token-unit 合取谓词见 judgeReason 第 2 点）。
      amount: {
        kind: "count",
        subject: "token-units-you-control",
        filter: { type: "token", controller: "controller", zone: "board" }
      }
    }
  }
];

export default {
  canonicalCardId: "card.hash-aab496105448f9073e9ec14bc0fc63bb55d3209146671be6e19899fb696a2bd2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均实测、不近似实现：(1) score 触发的过滤器无法注册——实测 EVENT_PATTERN_TYPES 里是判别值 \"scored\"（映射到 score 时点），" +
    "卡牌写的 \"score\" 不是合法事件类名，registerTrigger 抛 TriggerSpecValidationError；" +
    "(2) 473.2 的宿主位置关联缺失——score emission 只带 player 与 details.battlefieldId、没有 object，" +
    "而 translateTriggerFilter 把 source:\"self\" 翻成事件 object 的自身引用；实测改用闭合拼写 \"scored\" 注册后发出真实 score 事件，" +
    "链上没有任何条目，无法只在 Illaoi 所在战场得分时触发；" +
    "(3)「I have +1 :rb_might: for each token unit you control」无法求值——(a) 图层不计算 count 量（实测 layers/engine.ts 的 valueOf 不求值 count，" +
    "amount 退化为 0，建出一个 Tentacle 后 Might 仍是 4）；(b)「token unit」的合取谓词缺失——实测 typeMatches 对 type: \"token\" 同时命中 token gear。" +
    "已支持部分：「play a 1 Might Tentacle unit token」用已合入的 effect.token（mode \"play\"，187.10 定义）在 golden 中真实执行，" +
    "含从链上创建到打出、控制器归属与 null 费用的校验。",
  abilities,
  sourceText:
    "When you play me or when I score, play a :rb_energy_1: :rb_might: Tentacle unit token from Bilgewater.\n" +
    "I have +1 :rb_might: for each token unit you control."
} satisfies CardProgram;
