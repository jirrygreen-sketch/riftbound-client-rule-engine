import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Treasure Hunter (sfd-130-221) — Unit, Chaos, tag Shurima.
 * energy 2, power: none printed, Might 1.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-130-221，逐字）:
 *   "When I move, play a Gold gear token exhausted."
 *
 * 规则依据（CR v1.5）：
 * - "When I move"（421.1、449.1/449.2、458/458.1）：Move 是永久物在两个 Location
 *   之间的移动，Recall 不是 Move；封闭时点 object-moved 表示一次成功的 Move
 *   （events/timing-points.ts，refs 421.1/449.1/449.2/458），filter 用内层锚点
 *   source: "self" 指称本卡（已合入 ogn/traveling-merchant 同型）。
 *   原文没有限定目的地，所以不写 toZone 过滤。
 * - "play a Gold gear token exhausted"：440.2.c / 185.2.a 规定被「打出」的 token 先在
 *   链上生成再由打出流程接手（350.2/354）；184.1 / 185.2.d 允许效果规定该 token 以
 *   横置状态入场；Gold gear token 的印刷定义见 187.5。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。object-moved 的
 * source: "self" 绑定与 Recall 排除已经由事件对象和触发过滤器消费；当前仍有三处
 * token 侧缺口：Gold 定义（187.5，自带 "[Reaction][>] Kill this, [E]: [Add] [A]"）
 * 不在 effect.token 的冻结定义表里，entry exhausted override 未接入，且 token 的
 * controller-relative Base marker 仍需要位置选择/解析（RIFT-357）。
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
        id: "treasure-hunter.play-gold-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被「打出」的 token 先在链上生成。
          mode: { kind: "constant", value: "play" },
          // 名义上的装备 token 目的地；"exhausted" 是入场规定（184.1/185.2.d），
          // 从不写成事后的 effect.exhaust（143.4）。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          entersExhausted: { kind: "constant", value: true },
          linkKey: { kind: "constant", value: "goldToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-391b4e14a6ac07093188b967dee259bef4f8692e3d1e87e6bb28cf249f3e788a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "object-moved 触发的 source: \"self\" 过滤已经能绑定事件对象，且 Recall 不会发出 object-moved；" +
    "token 体仍不可执行：Gold gear token（CR 187.5 自带 [Reaction][>] Kill this, [E]: [Add] [A]）" +
    "不在 effect.token 的冻结定义表里（该文件明确 Gold 等自带能力的定义保持 blocked/judge-required）；" +
    "mode \"play\" 按 440.2.c/185.2.a 的链上创建与打出接手已合入；但「exhausted」是入场规定（184.1/185.2.d），" +
    "不能用事后 effect.exhaust（143.4）近似；" +
    "当前 create-token/play 不支持入场状态改写，且程序中的 controller-relative Base marker 尚无位置解析（RIFT-357），故不近似。",
  abilities,
  sourceText: "When I move, play a Gold gear token exhausted."
} satisfies CardProgram;

export default program;
