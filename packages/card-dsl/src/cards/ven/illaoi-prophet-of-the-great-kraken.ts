import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Illaoi, Prophet of the Great Kraken (ven-109-166; 同一 canonical 身份的另一印刷为 ven-182-166) —
 * Unit, Chaos, tags Bilgewater/Illaoi/Champion。
 * 6 Energy, no printed Power（`power: null`，不是 0），Might 4。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-109-166，逐字；ven-182-166 文本相同）：
 *   When you play me or when I score, play a :rb_energy_1: :rb_might: Tentacle unit token from Bilgewater.
 *   I have +1 :rb_might: for each token unit you control.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a：“When you play me” 是 Play Effect（时点 card-played，420.4.a 在打出完成后触发）。
 * - 470.1 / 470.3 / 473.2：“when I score” 里的 “score” 指 Scoring 过程（不是 “Score X points”），
 *   对应封闭时点 "score"（events/timing-points.ts，ruleRefs 470.1/470.3/471/473.2）。
 * - 187.10：“a 1 :rb_might: Tentacle unit token from Bilgewater” 是无领域、1 Might、Bilgewater
 *   标签的单位 token；effect.token 的冻结定义表 id "tentacle" 正是该定义（might 1、tags
 *   ["Bilgewater"]、energy/power 均为 null，绝不写成 0）。
 * - 440.2.c / 185.2.a / 350.2 / 354：“play a … token” 先在链上创建，再由打出流程接手；
 *   effect.token 的 mode "play" 走的正是这条路径。
 * - 143.2.a / 475–477：“I have +1 :rb_might: for each token unit you control” 是算术图层的持续
 *   Might 修正，不是 702 的 Buff 计数器（本卡不放置任何 Buff）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处缺口均不近似实现：
 * 1. “when I score” 的订阅没有消费方：scoring/ 只把 score 的触发结果作为 flag 交给
 *    turn-executor-v2（turn/flow.ts 组装 emissions），没有把它接进唯一事件管线，也没有把
 *    CardProgram 的 triggered 能力注册成 TriggerRegistration 的生产接线（契约 3.5，RIFT-31/33/120）；
 *    “我（本战场上的单位）得分” 还需要按 473.2 把 score 事件锚定到宿主所在战场，该锚点同理未接线。
 * 2. “I have +1 :rb_might: for each token unit you control” 需要卡牌侧的 continuous.might 注册入口
 *    与按集合计数求值 amount 的能力（RIFT-91 只交付图层引擎，图层 conditionMatches 也不求值
 *    count/compare）；“token unit” 的合取谓词同样缺失——已合入过滤器把数组 type 当 OR 处理，
 *    type: "token" 会一并匹配 token gear（如 Gold），因此这里按同批卡（sfd/azir-sovereign、
 *    sfd/renata-glasc-industrialist）的写法只记录 isToken 过滤并在此说明该缺口。
 * 3. card-played 的触发注册同样缺生产接线（同上第 1 点的 RIFT-120）。
 * 已支持部分：“play a 1 Might Tentacle unit token” 用已合入的 effect.token（mode "play"，187.10
 * 定义）在 golden 中真实执行，含从链上创建到打出、以及控制器归属与 null 费用的校验。
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
    "三处缺口，均不近似实现：(1)「when I score」的订阅没有消费方：scoring/ 只把 score 的触发结果作为 flag 交给 " +
    "turn-executor-v2（turn/flow.ts 组装 emissions），未接入唯一事件管线，也没有把 CardProgram 的 triggered 能力" +
    "注册成 TriggerRegistration 的生产接线（契约 3.5，RIFT-31/33/120）；473.2 要求把该次 Scoring 锚定到宿主所在战场，" +
    "该锚点同样未接线（card-played 一侧亦缺同一注册接线）。" +
    "(2)「I have +1 :rb_might: for each token unit you control」需要卡牌侧 continuous.might 注册入口与按集合计数求值 " +
    "amount 的能力（RIFT-91 只交付图层引擎，其 conditionMatches 也不求值 count/compare）；「token unit」的合取谓词同样缺失" +
    "——已合入过滤器把数组 type 当 OR，type: \"token\" 会一并匹配 token gear（如 Gold），因此按同批卡" +
    "（sfd/azir-sovereign、sfd/renata-glasc-industrialist）只记录 isToken 过滤。" +
    "(3) 同上两处的触发注册接线（RIFT-120）。" +
    "已支持部分：「play a 1 :rb_might: Tentacle unit token」用已合入的 effect.token（187.10 定义、mode \"play\"）真实执行。",
  abilities,
  sourceText:
    "When you play me or when I score, play a :rb_energy_1: :rb_might: Tentacle unit token from Bilgewater.\n" +
    "I have +1 :rb_might: for each token unit you control."
} satisfies CardProgram;
