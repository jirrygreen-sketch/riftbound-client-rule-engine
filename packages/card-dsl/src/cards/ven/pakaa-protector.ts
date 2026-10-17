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
 *   对非手牌真子集明确要求上游提供有序 picks（"a subset of this zone requires upstream
 *   ordered picks; query order is not deck order"），把 zoneSlice/牌库顶 1 张变成卡牌可用的
 *   有序选择尚未接线，程序用 pick "pakaa-protector.top-card" 声明该有序范围。
 * - “If it's a unit, draw it.”：414.1 的“加入手牌”是把该牌移入手牌（不是抽牌动作），
 *   走效果区域移动（effect.zone，to: "hand"）；分支判定是“展示时的卡类型”（契约 3.4 的
 *   Show Off 口径要求锁定展示时的特征值），Condition 只有 eq/ne/lt/lte/gt/gte/in（in 判
 *   左值是否属于右数组），没有数组包含，effect.reveal 也只链接 ref 列表、不落类型快照，
 *   因此分支判别器没有可求值形态（同 sfd/apprentice-smith、sfd/ravenbloom-conservatory）。
 * - “Otherwise, put it in your trash”：441 的 Burn 是把牌库顶的牌移入弃牌区；本句由效果指示
 *   指定“这张已展示的牌”，不是牌库顶批量烧牌，程序用 effect.zone（to: "trash"）记录该区域移动
 *   并显式说明与 effect.mill 的边界（mill 只按牌库顶张数工作，不能指定已展示的那张）。
 * - “and give me +2 :rb_might: this turn”：临时 Might 修正属 layers 的 continuous.might
 *   （143.2/143.2.a、479），effect.buff 文档明确临时 Might 不进入 Buff 计数器。
 *
 * status = judge-required：仍缺牌库顶 ordered-pick producer（RIFT-358）、展示时的类型快照与
 * 自动分支谓词（RIFT-359），以及 effect.reveal 的 pick 解包适配。
 * object-moved 已带移动对象快照，source:self 由 translateTriggerFilter 绑定为 objectId；
 * 通用触发注册可用。continuous.might 用已注册的 objects/source 选择器与 this-turn 期限，
 * golden 真实执行 reveal / zone 子效果及 +2 Might，未把玩家选 mode 当成自动条件。
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
        args: {
          // “the top card of your Main Deck”：非手牌的 1 张真子集必须由上游按牌库真实顺序
          // 提供有序 picks（契约 3.6 的 zoneSlice 语义；与 sfd/reksai-swarm-queen 同一写法）。
          pick: { kind: "constant", value: "pakaa-protector.top-card" }
        },
        picks: [
          {
            id: "pakaa-protector.top-card",
            // 有序牌库顶选项由引擎在依赖落地后提供；占位标记动态集合，不是 ObjectRef。
            options: ["dynamic:main-deck-top-one"],
            min: 1,
            max: 1,
            selection: "any",
            filter: { zone: "deck", owner: "controller" }
          }
        ]
      },
      {
        id: "pakaa-protector.branch",
        op: "choice.mode",
        // 两个分支互斥，但判别器（展示快照里的卡类型）尚不可求值，因此用 choice.mode 保留
        // 完整形状而不是把判定交给玩家：真正的分支判别器缺失，整卡据此保持 judge-required
        // （同 sfd/apprentice-smith 的 “If it's a gear … Otherwise …” 占位写法）。
        linkedTo: "pakaa-protector.reveal-top",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "pakaa-protector.unit-mode",
                body: [
                  {
                    id: "pakaa-protector.draw-it",
                    op: "effect.zone",
                    linkedTo: "pakaa-protector.reveal-top",
                    args: {
                      // 414.1：“draw it” 是把该张已展示的牌移入手牌；该牌在私有牌库中，
                      // 玩家自己的牌库顶不构成 355.10.a 的 target，故走 pick（355.10.a/c）。
                      // pick 的 min/max 都是 1，省略 amount 即“移动全部已选对象”（仅这一张）。
                      pick: { kind: "constant", value: "pakaa-protector.revealed-card" },
                      to: { kind: "constant", value: "hand" }
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
                  }
                ]
              },
              {
                id: "pakaa-protector.otherwise-mode",
                body: [
                  {
                    id: "pakaa-protector.into-trash",
                    op: "effect.zone",
                    linkedTo: "pakaa-protector.reveal-top",
                    args: {
                      // “put it in your trash”：被指示的对象是那张已展示的牌，不是“牌库顶 N 张”
                      // 的 Burn；卡牌效果移动走 effect.zone，mill 只会按数量烧牌库顶、无法指定
                      // 已展示的引用（441.1 描述的是 Burn 这一动作本身）。
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
                    // 临时 Might +2（this turn）；算术图层由原语固定。
                    // 不写成 Buff 计数器（702/703 的 Buff 不是 Might 变化）。
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
    "三处当前缺口：(1) 牌库顶有序 picks 生产尚未接入卡牌选择：effect.reveal 不把 query 顺序当作牌库顺序，需要 zoneSlice/top-card 的 ordered-pick producer（RIFT-358；425.1）。" +
    "(2) “If it is a unit … Otherwise …”需要展示时类型快照与自动条件分支；effect.reveal 只链接 ref 列表，当前 choice.mode 只是描述两个分支，不能让玩家代替条件选择（RIFT-359）。" +
    "(3) chain/interpreter-adapter.ts 的 LITERAL_FIELDS 对 effect.reveal 只解包 target、未解包 pick。" +
    "object-moved 的对象快照与 source:self 触发绑定、effect.zone 和 continuous.might（143.2.a / 317.2.c）均已可用；测试分别执行已支持子效果，整卡保持 judge-required。",
  abilities,
  sourceText:
    "When I move, reveal the top card of your Main Deck. If it's a unit, draw it. Otherwise, put it in your trash and give me +2 :rb_might: this turn."
} satisfies CardProgram;
