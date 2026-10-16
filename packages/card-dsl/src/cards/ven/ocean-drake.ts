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
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. 「You may play me to an open battlefield」需要打出位置许可的消费方：
 *    "play-location-permission" 只有卡数据声明，layers / Make Relevant Choices
 *    （CR 355.2.a/355.2.b；open = 170.11.c）没有读取实现，也没有把相对控制者的
 *    LocationRef（"your base" / "a battlefield"）绑定到运行时的路径。
 * 2. 「non-Dragon」的否定 tag 过滤缺失：ObjectFilter 与各匹配器只支持正向 tags/tag，
 *    没有排除 tag 的字段，只能用扩展键 excludeTags 声明占位（其它卡同样用 other /
 *    isToken / mightLte 这类占位；当前匹配器不读该键，只写 type: unit 会把 Dragon
 *    一并匹配），因此返回半段不得宣称可执行。
 * 返回动作本身（effect.zone 的 hand 目的地 + owner 路由）可用已合入原语执行，golden 以
 * 真实解释器（锁定 TargetSpec）覆盖该子效果，并把整卡的两处缺口保留为 test.todo。
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
    "两处缺口，均不近似实现：(1) 「You may play me to an open battlefield」需要打出位置许可的消费者：" +
    "play-location-permission 目前只有卡数据声明，layers / Make Relevant Choices（355.2.a/355.2.b；" +
    "open = 未占据且未控制，170.11.a/170.11.c）没有读取实现，也没有把相对控制者的 LocationRef " +
    "（controller base / 该控制者控制的战场）绑定到运行时的路径。(2) 「non-Dragon」的否定 tag 过滤缺失：" +
    "ObjectFilter 与各匹配器只有正向 tags/tag（133.8/133.8.a），只能按占位约定写扩展键 excludeTags" +
    "（当前匹配器不读，只写 type: unit 会把 Dragon 一并匹配，故不得放行整卡）。依赖：RIFT-91" +
    "（layers-continuous 的位置许可）、RIFT-90（打出位置校验）、否定 tag 过滤的契约增补。" +
    "「return … to its owner's hand」本体（355.7/355.9.a 的目标选择 + effect.zone 的 hand 目的地、" +
    "126 的 owner 路由）用已合入原语真实执行，golden 覆盖接受 / 拒绝与 owner 路由。",
  abilities,
  sourceText:
    "You may play me to an open battlefield.\n" +
    "When you play me, you may return a non-Dragon unit to its owner's hand."
} satisfies CardProgram;
