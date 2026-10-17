import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ocean Drake (ven-115-166) — Unit, 8 Energy + 2 Chaos Power, Might 7, Chaos,
 * tags Dragon / Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-115-166，逐字）：
 *   You may play me to an open battlefield.
 *   When you play me, you may return a non-Dragon unit to its owner's hand.
 *
 * 规则依据（CR v1.5）：
 * - 355.2.a / 355.2.b：默认合法打出位置是控制者的 Base 或该控制者控制的战场；
 *   "You may play me to an open battlefield" 是额外的位置许可（355.2.b）。
 * - 170.11.c："open" 指既未被占据（170.11.a）也未被控制（170.11.b）的战场。
 * - 383.4.a / 383.4.a.1 / 420.4.a：「When you play me」是 Play Effect，封闭时点
 *   "card-played"，filter 用 { source: "self" } 指向来源本体。
 * - 355.5 / 355.7 / 355.9.a："a non-Dragon unit" 是玩家在结算前选定的游戏对象 →
 *   TargetSpec；"non-Dragon" 是 133.8/133.8.a 的 tag 排除（Dragon 是标签，无内在
 *   规则含义，只被文本引用时生效）。
 * - 108.7 / 124 / 126："return … to its owner's hand" 把牌放回**拥有者**（而非控制者）
 *   的手牌；effect.zone 的 "hand" 目的地提交 return-to-hand 游戏动作，由动作层负责
 *   owner 路由（与已合入 ogn/zaunite-bouncer 同款写法）。
 * - "you may return …"：契约 3.9 的可选效果，写成 choice.optional 并把被选指令包在
 *   body 里。
 *
 * status = judge-required：仍缺 play-location-permission 的静态图层映射和打出位置
 * Finalize 消费（355.2.b，RIFT-357）、non-Dragon 的否定标签过滤（133.8），以及
 * choice.optional 内嵌套 TargetSpec 的 Finalize 生命周期。
 * effect.zone 回手与 owner 路由已有真实执行证据；不以手动锁定目标证明整卡可执行。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          // 170.11.c：“open” = 未占据（170.11.a）且未控制（170.11.b）。
          battlefield: { open: true },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 契约 3.9：“you may return …” 的被选指令包在 choice.optional 的 body 里。
        id: "ocean-drake.may-return",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Return a non-Dragon unit to its owner's hand?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "ocean-drake.return-unit",
                op: "effect.zone",
                args: {
                  target: {
                    kind: "constant",
                    value: "ocean-drake.non-dragon-unit"
                  },
                  // 126/108.7：目的地是拥有者的手牌；owner 路由由动作层负责。
                  to: { kind: "constant", value: "hand" }
                },
                targets: [
                  {
                    id: "ocean-drake.non-dragon-unit",
                    // “a non-Dragon unit”：133.8 的 tag 排除只能以占位键记录，
                    // 当前匹配器不读 excludeTags（见 judgeReason 第 2 条）。
                    filter: {
                      type: "unit",
                      zone: "board",
                      excludeTags: ["Dragon"]
                    },
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
];

export default {
  canonicalCardId:
    "card.hash-772fd552ac23dc61d1d65dfaf1aeda496e923d75ef3ee6143e56f48de0ebc165",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口：(1) play-location-permission 缺 programs/statics.ts 的图层映射与打出 " +
    "Finalize 的位置许可消费（355.2.b；open = 未占据且未控制，170.11.c；RIFT-357）。" +
    "(2) non-Dragon 需要否定标签过滤（133.8）：当前 ObjectFilter 与 programs/filters.ts " +
    "只支持正向 tags/tag，描述性的 excludeTags 不能提供合法目标集合，需契约增补。" +
    "(3) TargetSpec 位于 choice.optional 的 body 内，仍需嵌套目标的 Finalize 锁定与重验。" +
    "effect.zone 的 hand 目的地与 owner 路由（126/108.7）已由解释器真实执行，测试覆盖接受、拒绝与失效目标；不近似实现。",
  abilities,
  sourceText:
    "You may play me to an open battlefield.\n" +
    "When you play me, you may return a non-Dragon unit to its owner's hand."
} satisfies CardProgram;
