import type { CardProgram } from "../../ir/index.js";

/**
 * Noxian Drummer (ogn-222-298) — Unit, 3 energy, Might 3（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-222-298）：
 *   When I move to a battlefield, play a 1 :rb_might: Recruit unit token here.
 *   (It is also at the battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 421/449：Move 是对象在两个 Location 之间的移动；449.1/449.2 用起点与终点定义一次移动；
 *   458/458.1 Recall 不是 Move，不触发移动类触发。
 * - 封闭时点 object-moved（events/timing-points.ts，refs 421.1/449.1/449.2/458）用于“成功完成 Move”。
 * - 「play a … token here」：440.2.c/185.2.a/350.2/354（链上生成后打出）；Recruit 见 CR 187.1，
 *   effect.token 定义 id "recruit"。「here」= 来源当前位置（359.3.f.1/f.2）。
 *
 * 结构：object-moved 触发（filter 用 toZone: "battlefield" 表达“移动到战场”）；body[0] 读来源位置，
 * body[1] 在该位置打出 1 个 Recruit token。
 *
 * status = judge-required：object-moved 的触发过滤缺少“是本卡在移动”的可判定信息（事件物体身份
 * 只有运行时 objectId，需 RIFT-257 的注册源绑定），“终点是战场”由 turn/flow 补发的
 * object-enters-battlefield 承担、但事件本身不带 toZone。见 judgeReason。
 */
const noxianDrummer = {
  canonicalCardId: "card.hash-5518503e78770284d5f2f55292d0d27dd571a336dd4bcae40fdc3ee530d2b12d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "object-moved 时点已由 RIFT-270 的管线产生（events/action-adapter.ts 为 move-location 动作发出；" +
    "turn/flow.ts 为 move-location 补发 object-leaves-battlefield/object-enters-battlefield 等别名，" +
    "并区分 base/battlefield），但触发条件仍无法静态表达：" +
    "(1) 事件物体的同一性只在运行时（event.object 的 objectId），卡牌程序无法静态写出自己的运行时 objectId；" +
    "缺少 CardProgram 注册绑定（RIFT-257）把注册源 ref 翻译为 object 过滤（Vision.ts 的 objectId: \"self\" 形状即等待该绑定）；" +
    "(2) object-moved 事件本身不填 toZone/toKind（timing-points.ts 声明了这些 payloadFields，但 action-adapter 的动作时点发射不给该事件填 toZone），" +
    "toZone: \"battlefield\" 的过滤永远不命中；「移动到战场」可由 turn/flow 补发的 object-enters-battlefield 别名表达，但那条事件同样没有对象自指过滤。" +
    "依赖：RIFT-257（程序触发绑定）与对局实际 Standard Move 结果提交到事件管线（duel 侧执行器只把 requiresMoveTriggers 交给外层）。" +
    "不近似实现（不用任何移动都触发代替）。" +
    "token 部分（effect.token mode play + condition.value 链接位置）已可用并有 golden 执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: { event: "object-moved", toZone: "battlefield" }
      },
      optional: false,
      body: [
        {
          id: "noxian-drummer.read-here",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "location"
            },
            key: { kind: "constant", value: "here" }
          }
        },
        {
          id: "noxian-drummer.play-recruit",
          op: "effect.token",
          linkedTo: "noxian-drummer.read-here",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "noxian-drummer.read-here",
              key: "here"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I move to a battlefield, play a 1 :rb_might: Recruit unit token here. " +
    "(It is also at the battlefield.)"
} satisfies CardProgram;

export default noxianDrummer;
