import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Pakaa Protector (ven-033-166) — Unit, Calm, 5 Energy, Might 4, tag Cat/Shurima.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-033-166，逐字）：
 *   When I move, reveal the top card of your Main Deck. If it's a unit, draw it.
 *   Otherwise, put it in your trash and give me +2 :rb_might: this turn.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 421.1 / 449.1 / 449.2 / 458：“When I move” 是移动触发；封闭时点
 *   events/timing-points.ts 的 object-moved 表示一次成功的 Move（用起止地点定义；
 *   Recall 不算 Move，458/458.1），filter 内层锚点用契约 3.6 的 source: "self" 指称本卡。
 * - 425.1 / 425.1.a.2 / 425.3：reveal 公开牌库顶的牌；牌仍在原区域，牌库顺序不变。
 *   契约 3.6 规定读牌库顶必须用 zoneSlice（query 不保证区域顺序），已合入的 effect.reveal
 *   对非手牌真子集明确要求上游提供有序 picks。当前 deck/count:1 路径会拒绝多张牌库的
 *   真子集；zoneSlice/牌库顶 1 张接入卡牌程序仍是缺口，不把 query 顺序近似为牌库顺序。
 * - “If it's a unit, draw it.”：compare/in 可判断标量 unit 是否属于展示牌的 types 数组。
 *   condition.predicate 在展示后的首个步骤保存布尔结果，两条 sequence 消费该结果，
 *   不交给玩家选择。414.1/414.1.a 的“draw it”走 effect.draw；展示未换区且判别到抽牌
 *   之间没有其它动作，因此抽到的仍是原顶牌，并保留 card-drawn 动作语义。
 * - “Otherwise, put it in your trash”：effect.zone 移动已展示的指定牌；PickSpec 的
 *   options 引用 reveal 的真实结果，当前仍缺 linked options 自动绑定到 ctx.picks 的路径。
 * - “and give me +2 :rb_might: this turn”：临时 Might 修正属 layers 的 continuous.might
 *   （143.2/143.2.a、479），effect.buff 文档明确临时 Might 不进入 Buff 计数器。
 *
 * status = judge-required：仍缺牌库顶 ordered-pick producer（RIFT-358）、effect.reveal
 * 的 pick 解包及 linked PickSpec 自动绑定；类型判别不再依赖新谓词。
 * object-moved 已带移动对象快照，source:self 由 translateTriggerFilter 绑定为 objectId。
 * golden 在单张牌库中执行原始 body；非单位场景提供真实有序读取的锁定 pick，
 * 仅证明已支持部分。测试还覆盖两分支、空展示、第二张牌不受影响、旧引用失效与临时 Might 到期。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "pakaa-protector.reveal-top",
        op: "effect.reveal",
        // 多张牌库的真子集会 fail closed；不能把 query 顺序当作牌库顺序。
        // 该读取仍缺 zoneSlice → reveal 的接线，因此整卡保持 judge-required。
        args: {
          zone: { kind: "constant", value: "deck" },
          count: { kind: "constant", value: 1 }
        }
      },
      {
        id: "pakaa-protector.branch",
        op: "condition.predicate",
        linkedTo: "pakaa-protector.reveal-top",
        args: {
          // 展示不换区；在后续动作前读取并保存类型判定，两个分支消费同一布尔值。
          condition: {
            kind: "constant",
            value: {
              kind: "compare",
              left: { kind: "constant", value: "unit" },
              operator: "in",
              right: {
                kind: "object-property",
                object: { linked: "pakaa-protector.reveal-top" },
                property: "types"
              }
            }
          }
        }
      },
      {
        id: "pakaa-protector.unit-mode",
        op: "sequence",
        linkedTo: "pakaa-protector.branch",
        condition: {
          kind: "expression",
          value: { kind: "linked-value", instructionId: "pakaa-protector.branch", key: "value" }
        },
        args: {
          body: {
            kind: "constant",
            value: [
              {
                id: "pakaa-protector.draw-it",
                op: "effect.draw",
                // 414.1/414.1.a：展示未移动牌，判别到抽牌之间无其它动作；抽到的仍是该顶牌。
                args: { amount: { kind: "constant", value: 1 } }
              }
            ]
          }
        }
      },
      {
        id: "pakaa-protector.otherwise-mode",
        op: "sequence",
        linkedTo: "pakaa-protector.branch",
        // 契约 3.4：整个“否则”从句受条件约束，移入 trash 与 +2 Might 共享作用范围。
        condition: {
          kind: "not",
          condition: {
            kind: "expression",
            value: { kind: "linked-value", instructionId: "pakaa-protector.branch", key: "value" }
          }
        },
        args: {
          body: {
            kind: "constant",
            value: [
              {
                id: "pakaa-protector.into-trash",
                op: "effect.zone",
                linkedTo: "pakaa-protector.reveal-top",
                args: {
                  pick: { kind: "constant", value: "pakaa-protector.revealed-card" },
                  to: { kind: "constant", value: "trash" }
                },
                picks: [
                  {
                    id: "pakaa-protector.revealed-card",
                    options: [
                      {
                        kind: "linked-value",
                        instructionId: "pakaa-protector.reveal-top",
                        key: "revealed"
                      }
                    ],
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              },
              {
                id: "pakaa-protector.might-this-turn",
                op: "continuous.might",
                args: {
                  mode: { kind: "constant", value: "add" },
                  amount: { kind: "constant", value: 2 },
                  duration: { kind: "constant", value: "this-turn" },
                  objects: { kind: "constant", value: { kind: "source" } }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-f4d87dfb750f0f23070558bd76ae0fba7b17e9097fe44c0034f1eb55e6bb564e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口是牌库顶有序读取（425.1；RIFT-358）：effect.reveal 的 deck/count:1 路径对多张牌库的真子集拒绝执行，" +
    "未把 zoneSlice 的顶牌引用接入卡牌程序；不能用 query 顺序近似牌库顺序。" +
    "若改用 ordered pick，chain/interpreter-adapter.ts 的 LITERAL_FIELDS 仍只解包 effect.reveal.target、不解包 pick，需同步适配。" +
    "另缺 effect.zone 的 linked PickSpec 绑定：interpreter.ts 只把 picks 委托给调用方，未求值 linked-value options；非单位测试显式提供锁定选择，不能证明生产绑定。" +
    "object-moved 的来源绑定、compare/in 类型判别与 condition.predicate 布尔快照已可用，两个 sequence 自动且互斥执行，" +
    "unit 分支通过 effect.draw 抽到未离开牌库顶的原牌，另一分支通过 effect.zone 与 continuous.might 处理；单张牌库有原始 body 执行证据，仍不宣称完整可执行。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's a unit, draw it. Otherwise, put it in your trash and give me +2 :rb_might: this turn."
} satisfies CardProgram;
