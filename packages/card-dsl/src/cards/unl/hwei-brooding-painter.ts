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
 *   458 的 Recall 不是 Move、不触发移动类触发。封闭时点取 object-moved，
 *   translateTriggerFilter 把 { source: "self" } 绑定为移动对象 = 本卡。
 * - 414.1 / 414.3："draw 1" 用 effect.draw（未指明时从 Main Deck 顶抽，190.6.d
 *   的隐含 you = 能力控制者）。
 * - 423.1 / 423.1.a / 423.4："discard 1" 是效果弃牌，由该玩家在结算时选择要弃的牌
 *   （手牌是私有区域，属非目标 pick，355.10.a）；effect.discard 不带 pick 时提供
 *   整手牌选择（恰 1 张时直接弃）；链接记录 hwei.discard-1 持有回执，解释器从
 *   回执提取被弃牌引用并以 last-known 快照读类型（弃牌前状态，359.3.e）。
 * - 388.1 / 388.1.b / 389.1："do the following based on …" 是按弃牌类型自动选定的
 *   一个分支（不是玩家选模式），写成三个由类型条件守住的 sequence 分支
 *   （互斥、逐条求值），条件读 { linked: "hwei.discard-1" } 回执中的被弃牌 types。
 *   当前 IR 只能在原能力 body 内执行这些 sequence，尚不能把选中的分支作为新的待定
 *   Chain item 入链；因此这里只保留可执行的分支形状，整张卡仍为 judge-required。
 * - 414.1：Spell 分支 "Draw 1."
 * - 416.1 / 431.1：Gear 分支 "Ready up to 2 runes." 是对符文区中自己符文的非目标
 *   集合选择（355.10.d 型 "ready all/up to"，min 0 = "up to"）。
 * - 122.5 / 479.4：Unit 分支 "Give me +3 :rb_might: this turn." 是临时数值修正，
 *   归 continuous.might 图层；"me" 经 args.appliesTo 的 self 锚点。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. 「When I move」的 object-moved 触发不能经程序绑定注册：translateTriggerFilter 把
 *    { source: "self" } 翻译为 event: "object-moved" 的 EventPattern，但
 *    events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 白名单没有 object-moved，
 *    registerProgramTriggers 在 assertTriggerSpec 即抛 TriggerSpecValidationError。
 * 2. 388.1.b / 389.1 要求 “do the following” 产生新的待定 Chain item；当前
 *    sequence 只在原能力内直接结算，真实 ChainEngine 只产生原能力的一次 pending/resolved，
 *    不能证明分支作为新的链项进入 Chain。
 * body 的 draw、discard、类型读回与 Might 分支均有真实执行 golden，但这两处缺口
 * 仍阻止整张卡升级为 executable。
 */
const hweiBroodingPainter = {
  canonicalCardId: "card.hash-ffb82a1c4cfcf34e538fde6b389b55d4affeceb3cdb2ba50ada212c3237fe8f2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，不近似实现：(1) object-moved 不在 events/trigger-spec.ts 的 " +
    "EVENT_PATTERN_TYPES 白名单中，registerProgramTriggers 会抛 TriggerSpecValidationError；" +
    "(2) CR 388.1.b/389.1 要求按类型选出的分支作为新的待定 Chain item，" +
    "当前 sequence 只在原能力内直接结算。其余 body 形状与 draw/discard/type readout/Might " +
    "均有真实执行 golden 覆盖。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // "When I move"：449.1/449.2 的 Move（458 的 Recall 不算）。translateTriggerFilter
        // 把 { source: "self" } 绑定为移动对象 = 本卡（object-moved 事件携带移动对象快照）。
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
          // 423.1.a：由该玩家在结算时选择要弃的牌；手牌是私有区域，属非目标 pick
          // （355.10.a）。effect.discard 不带 pick 时提供整手牌选择：恰 1 张时直接弃，
          // 多张时经链的 choice 管线询问。链接记录持有弃牌回执（默认键 discarded），
          // 解释器从回执提取被弃牌引用并按 last-known 读弃牌前快照（359.3.e）。
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "hwei.spell-branch",
          // "Spell — Draw 1."：条件是被弃牌的 types 含 spell（388.1.b 的按类型分支）；
          // 被弃牌经 { linked: "hwei.discard-1" } 从弃牌回执记录读取。
          op: "sequence",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "spell" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { linked: "hwei.discard-1" },
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
          // （355.10.d 型 "up to" 集合，min 0）。owner 的 "self" 由链上下文归一化为
          // 能力控制者。
          op: "sequence",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "gear" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { linked: "hwei.discard-1" },
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
                        filter: { zone: "rune-zone", type: "rune", owner: "self" },
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
          // 图层（122.5 / 479.4）；"me" 经 args.appliesTo 的 self 锚点传给解释器。
          op: "sequence",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "unit" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { linked: "hwei.discard-1" },
              property: "types"
            }
          },
          args: {
            appliesTo: { kind: "constant", value: "self" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "hwei.unit-give-plus-3",
                  op: "continuous.might",
                  args: {
                    amount: { kind: "constant", value: 3 },
                    duration: { kind: "constant", value: "this-turn" }
                  }
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
