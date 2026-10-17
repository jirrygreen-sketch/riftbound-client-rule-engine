import type { CardProgram } from "../../ir/index.js";

/**
 * Hwei, Brooding Painter (unl-080-219) — Unit，5 能量 + 1 Power、Might 5，
 * Mind / Ionia / Hwei / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-080-219，逐字）：
 *   When I move, draw 1, then discard 1. Then, do the following based on the
 *   discarded card's type:
 *   Spell — Draw 1.Gear — Ready up to 2 runes.Unit — Give me +3 :rb_might:
 *   this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4："When I move" 是 Move 触发；449.1 / 449.2 用起止地点定义一次 Move，
 *   458 的 Recall 不是 Move、不触发移动类触发。封闭时点取 object-moved。
 * - 414.1 / 414.3："draw 1" 用 effect.draw（未指明时从 Main Deck 顶抽，190.6.d
 *   的隐含 you = 能力控制者）。
 * - 423.1 / 423.1.a / 423.4："discard 1" 是效果弃牌，由该玩家在结算时选择要弃的牌
 *   （手牌是私有区域，因此这不是目标选择而是非目标 pick，355.10.a），尽可能弃。
 * - 388.1 / 388.1.b / 389.1："do the following based on …" 属反身触发的表述；
 *   本卡的三段是**按弃牌类型自动选定**的一个分支（不是玩家选模式），因此按契约 3.9
 *   的可表达形状写成三个由类型条件守住的 sequence 分支（互斥、逐条求值），
 *   而不是 choice.mode（后者按玩家选择，语义不同）。
 * - 414.1：Spell 分支 "Draw 1."
 * - 416.1 / 431.1：Gear 分支 "Ready up to 2 runes." 是对符文区中自己符文的
 *   非目标集合选择（355.10.d 型"ready all/up to"），用 effect.ready 的 choose 选择
 *   表达（min 0 = "up to"）。
 * - 122.5 / 479.4：Unit 分支 "Give me +3 :rb_might: this turn." 是临时数值修正，
 *   归 continuous.might 图层（effect.buff 的边界注释明确临时 Might 不进 Buff 原语）。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. "When I move" 的归属不可判定：events/action-adapter.ts 为 move-location 发出的
 *    object-moved 事件不带 source（move-location 动作本身没有 source 字段），
 *    timing-points.ts 声明的 toKind/fromKind 等载荷字段也未填充，因此 TriggerSpec
 *    无法表达"是本卡在移动"（同一缺口见 ogn/noxian-drummer 的 judgeReason）。
 * 2. "based on the discarded card's type" 的判据没有可用的读取路径：effect.discard 的
 *    链接回执是 { count, player, objects }，而解释器的 ObjectSelector { linked: id }
 *    只把「本身是对象引用或引用数组（或一层记录里全是引用）」的链接值解析为对象选择
 *    （interpreter/selectors.ts 的 references），嵌套的 objects 数组读不到；本卡因此
 *    按已合入先例（sfd/stacked-deck、ogn/baited-hook）用**非目标 pick** 提供被弃的牌，
 *    使类型可读——但该 pick 的成员在生产上必须由 Finalize 锁定并由调用方补齐
 *    （链的 Finalize 只锁定 instruction.targets 的 TargetSpec，RIFT-90），并非
 *    结算期弃牌选择的现成产物。
 * 3. Unit 分支需要 continuous.might（RIFT-91）；原语已经合入，但卡牌 static/trigger
 *    接线与图层消费路径仍未完成，封闭 GameAction 集合也没有直接的 might 修改动作。
 * 4. 没有模块把 CardProgram 的 triggered ability 注册成 TriggerRegistration
 *    （引擎批 4 / RIFT-120），object-moved 订在生产链路上不可达。
 * 依赖：RIFT-90（pick/目标管线与事件载荷）、RIFT-91（layers-continuous）、RIFT-120。
 * golden 用解释器 + 参考内核真实执行已支持部分：draw 1、按 pick 弃牌、Spell 分支再抽 1、
 * Gear 分支 ready up to 2 runes，以及三条件按类型互斥求值。
 */
const hweiBroodingPainter = {
  canonicalCardId: "card.hash-ffb82a1c4cfcf34e538fde6b389b55d4affeceb3cdb2ba50ada212c3237fe8f2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1)「When I move」的归属不可判定：events/action-adapter.ts 为 move-location 发出的 object-moved 事件不带 source（move-location 动作没有 source 字段），" +
    "timing-points.ts 声明的 toKind/fromKind 等载荷也未填充（同一缺口见 ogn/noxian-drummer）；" +
    "(2)「based on the discarded card's type」的判据缺读取路径：effect.discard 的链接回执是 { count, player, objects }，" +
    "解释器的 { linked: id } 对象选择器只解析「本身是对象引用或引用数组」的链接值（interpreter/selectors.ts 的 references），嵌套 objects 读不到；" +
    "本卡改用非目标 pick 提供被弃牌，使类型可读，但该 pick 成员在生产上必须由 Finalize 锁定并由调用方补齐（链 Finalize 只锁定 TargetSpec，RIFT-90）；" +
    "(3) Unit 分支「Give me +3 :rb_might: this turn」依赖已合入的 continuous.might 原语，但卡牌接线与图层消费路径仍缺（RIFT-91）；" +
    "(4) 没有模块把 CardProgram 的 triggered ability 注册成 TriggerRegistration（引擎批 4 / RIFT-120），object-moved 订不可达。" +
    "依赖：RIFT-90、RIFT-91、RIFT-120。draw 1、按 pick 弃牌、Spell 分支、Gear 分支已在 golden 中真实执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // "When I move"：449.1/449.2 的 Move（Recall 不算，458）；归属缺口见 judgeReason 第 1 点。
        filter: { event: "object-moved", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "hwei.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "hwei.discard-1",
          // 423.1.a：由该玩家在结算时选择要弃的牌；手牌是私有区域，选择是非目标 pick
          // （355.10.a）。pick 提供被弃牌的身份，供后续分支读取类型。
          op: "effect.discard",
          args: {
            amount: { kind: "constant", value: 1 },
            pick: { kind: "constant", value: "hwei.discarded" }
          },
          picks: [
            {
              id: "hwei.discarded",
              // 该 pick 的成员由上游 Finalize / 调用方提供（见 judgeReason 第 2 点）；
              // 这里只描述"要弃的那张手牌"。
              options: ["chosen-card-from-your-hand"],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "hwei.spell-branch",
          // "Spell — Draw 1."：条件是被弃牌的 types 含 spell（388.1.b 的按类型分支）。
          op: "sequence",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "spell" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { pick: "hwei.discarded" },
              property: "types"
            }
          },
          args: {
            body: {
              kind: "constant",
              value: [
                {
                  id: "hwei.spell-draw-1",
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        },
        {
          id: "hwei.gear-branch",
          // "Gear — Ready up to 2 runes."：对符文区里自己的符文做至多 2 个的非目标选择
          // （355.10.d 型"up to"集合，min 0）。
          op: "sequence",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "gear" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { pick: "hwei.discarded" },
              property: "types"
            }
          },
          args: {
            body: {
              kind: "constant",
              value: [
                {
                  id: "hwei.gear-ready-runes",
                  op: "effect.ready",
                  args: {
                    objects: {
                      kind: "constant",
                      value: {
                        kind: "choose",
                        id: "hwei-runes",
                        filter: { zone: "rune-zone", type: "rune", owner: "controller" },
                        min: 0,
                        max: 2
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        {
          id: "hwei.unit-branch",
          // "Unit — Give me +3 :rb_might: this turn."：临时 Might 修正归 continuous.might
          // 图层（见 judgeReason 第 3 点）；"me" 用对象锚点 self 表达。
          op: "sequence",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "unit" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { pick: "hwei.discarded" },
              property: "types"
            }
          },
          args: {
            body: {
              kind: "constant",
              value: [
                {
                  id: "hwei.unit-give-plus-3",
                  op: "continuous.might",
                  args: {
                    amount: { kind: "constant", value: 3 },
                    duration: { kind: "constant", value: "this-turn" }
                  },
                  targets: [
                    {
                      id: "hwei.me",
                      filter: { zone: "board", type: "unit", object: "self" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I move, draw 1, then discard 1. Then, do the following based on the discarded card's type:\n" +
    "Spell — Draw 1." +
    "Gear — Ready up to 2 runes." +
    "Unit — Give me +3 :rb_might: this turn."
} satisfies CardProgram;

export default hweiBroodingPainter;
