import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jae Medarda (sfd-142-221) — Unit, Chaos, Noxus.
 * energy 5, power 2, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-142-221，逐字）:
 *   "When you choose me with a spell, draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.b / 383.4.b.1 / 383.4.b.2 / 383.4.b.3："When you choose me with a spell" 是
 *   Targeting Effect——条件是某个 Game Object 成为目标，在法术指定目标后作为 Pending Item 进链；
 *   355.6/E7 规定卡面的 "choose" 等于 Targeting。时点用封闭枚举的 became-target
 *   （events/timing-points.ts，ruleRefs 355.7/383.4.b）。
 * - "with a spell"：EventPattern.source 是法术（355.9 对 "spell" 的用法），写 source: { type: "spell" }。
 * - "me"：能力宿主，filter 的 target 锚点用符号选择器 "self"（契约 3.6 的对象锚点；参考已合入
 *   ogn/the-dreaming-tree 的 target 锚点写法），不写运行时 ObjectRef。
 * - "draw 1"：414.1 / 414.3，缺省抽牌者是能力控制者（"you"，190.6.d），已合入的 effect.draw
 *   只提交封闭的 draw GameAction。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - became-target 的载荷不带法术类型判别：chain/engine.ts 在 Finalize 里发出的 became-target
 *   事件带 object/target/source/player，但 source 是"成为目标的法术或能力的来源对象"，
 *   而事件管线要按 383.4.b.3 判断式的 "with a spell" 需要该来源的牌类型；已合入的
 *   events/pipeline-match.ts 的 ObjectFilter 支持 type 匹配，但该事件载荷没有把法术类型落到
 *   可判定字段上，无法把"被法术指定"与"被能力指定"区分开（同 ogn/the-dreaming-tree 记录的缺口）。
 * - 没有把 CardProgram 的 triggered ability 注册为 TriggerRegistration 的接线，事件载荷也没有
 *   把能力宿主同一性暴露给卡牌注册层（RIFT-120）。
 * - "draw 1" 本身只用已合入的 effect.draw，golden 测试对锁定控制者的抽牌体做真实执行。
 * 依赖：RIFT-64（事件载荷的判定字段）、RIFT-90（目标管线）、RIFT-120（卡牌触发注册与事件载荷绑定）。
 * 不近似实现：不把"任何来源指定我"都当作"被法术指定"。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "became-target",
      filter: {
        event: "became-target",
        // 355.7 / 383.4.b：条件是"我成为目标"（符号选择器 "self"），来源是法术。
        target: { object: "self" },
        source: { type: "spell" },
        player: "any"
      }
    },
    optional: false,
    body: [
      {
        // 414.3：抽 1；缺省抽牌者是能力控制者（190.6.d）。
        id: "jae-medarda.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-41956626d8e2085aa462cfe2ee446c4b1d4f6fed16272a0a937256f92f5d68bb",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1) became-target 事件载荷没有可判定的「来源是法术」判别：chain/engine.ts 在 Finalize 里发出的 became-target 事件带 " +
    "object/target/source/player，但载荷没有把来源的牌类型落到可匹配字段上，383.4.b.3 要求的「其实是法术指定」无法与「被能力指定」区分" +
    "（同 ogn/the-dreaming-tree 记录的缺口）；(2) 没有把 CardProgram 的 triggered ability 注册为 TriggerRegistration 的接线，" +
    "事件载荷也没有把能力宿主同一性暴露给卡牌注册层（RIFT-120）。" +
    "「draw 1」本身只用已合入的 effect.draw（414.3），golden 对锁定控制者的抽牌体做真实执行。" +
    "依赖：RIFT-64（事件载荷判定字段）、RIFT-90（目标管线）、RIFT-120（卡牌触发注册与事件载荷绑定）。不近似实现。",
  abilities,
  sourceText: "When you choose me with a spell, draw 1."
} satisfies CardProgram;

export default program;
