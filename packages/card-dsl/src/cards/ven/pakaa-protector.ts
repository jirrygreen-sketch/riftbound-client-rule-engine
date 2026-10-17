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
 *   对非手牌真子集明确要求上游提供有序 picks。现用 zoneSlice 有序来源，不把 query 顺序近似为牌库顺序；
 *   结算时来源仍待接线（见 judgeReason）。
 * - “If it's a unit, draw it.”：compare/in 可判断标量 unit 是否属于展示牌的 types 数组。
 *   condition.predicate 在展示后的首个步骤保存布尔结果，两条 sequence 消费该结果，
 *   不交给玩家选择。414.1/414.1.a 的“draw it”走 effect.draw；展示未换区且判别到抽牌
 *   之间没有其它动作，因此抽到的仍是原顶牌，并保留 card-drawn 动作语义。
 * - “Otherwise, put it in your trash”：effect.zone 移动已展示的指定牌；PickSpec 的
 *   linked 字段引用 reveal 的真实结果，linked PickSpec 由 chain/picks/linked.ts 自动绑定。
 * - “and give me +2 :rb_might: this turn”：临时 Might 修正属 layers 的 continuous.might
 *   （143.2/143.2.a、479），effect.buff 文档明确临时 Might 不进入 Buff 计数器。
 *
 * 当前执行边界见 judgeReason 与对应 golden；保留所有印刷语义。
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
        // 已合入的 producer 按真实区域顺序绑定；Finalize / Resolve 时点差异见 judgeReason。
        args: { pick: { kind: "constant", value: "pakaa-protector.top-card" } },
        picks: [{
          id: "pakaa-protector.top-card",
          options: [], ordered: true, selection: "all",
          zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
        }]
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
                    options: [], ordered: true, selection: "all",
                    linked: {
                      kind: "linked-value",
                      instructionId: "pakaa-protector.reveal-top",
                      key: "revealed"
                    }
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
  judgeReason: "当前缺口：(1) events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 不含 object-moved，programs/filters.ts 翻译的自身移动事件模式无法注册；已有 object-moved 发射与匹配不等于生产触发绑定（383.1 / 421.1）。(2) 结算时的牌库顶有序读取（425.1 / 414.1.a / 359.3）：chain/picks/plan.ts 的 zoneSlice 只在 Finalize 锁定引用，不能表达本触发 Resolve 时才展示的当前顶牌。若响应改变牌库顶，锁定的 reveal 对象与 effect.draw 抽到的当前顶牌可能不同，不能把旧引用近似为“draw it”。有序 pick、effect.reveal.pick 解包、linked PickSpec 自动绑定均已合入；golden 用原始 body 真实执行多张牌库的两个互斥分支、空牌库、Move 事件匹配和 +2 Might 到期，但在结算时读取来源接通前保持 judge-required。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's a unit, draw it. Otherwise, put it in your trash and give me +2 :rb_might: this turn."
} satisfies CardProgram;
