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
 * status 判定（cards/README.md 第 2 节）：judge-required。两处已合入缺口：
 * - object-moved 触发缺「被移动对象 = 本卡」的消费方：events/action-adapter.ts 生成的
 *   object-moved 事件带 object（被移动对象），但 events/pipeline-match.ts 只读 EventPattern
 *   的 object/source/target/player/fromZone/toZone/amount/details，不读取卡程序里的内层
 *   filter 锚点，source: "self" 没有消费者（需把被移动对象与宿主的同一性暴露给卡牌注册层，
 *   449.1/449.2 的起终点、458 的 Recall 排除据此无法执行；与已合入 sfd/corinna-veraza 同一缺口）。
 * - token 体：Gold 定义（187.5，自带 "[Reaction][>] Kill this, [E]: [Add] [A]"）不在
 *   effect.token 的冻结定义表里——该文件明确 Gold 等自带能力的定义保持 blocked/judge-required；
 *   mode "play" 需要链上创建（440.2.c/185.2.a），而冻结的 create-token 只在场上创建、
 *   effect.token 对 mode "play" 返回 negated（blockedReason: token-play-requires-chain-creation）；
 *   "exhausted" 是入场规定（184.1/185.2.d），不支持入场状态改写，effect.exhaust 的事后横置
 *   会多一次「成为横置」事件并错过 143.4，故不近似。
 * 依赖：RIFT-120（move-location 事件载荷与移动注册）、token 链上创建与入场状态（RIFT-62 后续）、
 * Gold 定义（RIFT-82 同批）。
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
    "object-moved 触发缺少「被移动对象 = 本卡」的可判定载荷：events/action-adapter.ts 为 move-location " +
    "生成的 object-moved 事件带 object（被移动对象）与起止 zone，但 events/pipeline-match.ts 只读取 " +
    "EventPattern 的 object/source/target/player/fromZone/toZone/amount/details，不读取卡程序里的内层 filter " +
    "锚点，source: \"self\" 没有消费方（需把被移动对象与宿主的同一性暴露给卡牌注册层；449.1/449.2 的" +
    "起点终点、458 的 Recall 排除据此无法执行，与已合入 sfd/corinna-veraza 记录的同一缺口）。" +
    "token 体同样不可执行：Gold gear token（CR 187.5 自带 [Reaction][>] Kill this, [E]: [Add] [A]）" +
    "不在 effect.token 的冻结定义表里（该文件明确 Gold 等自带能力的定义保持 blocked/judge-required）；" +
    "「play a … token」要求按 440.2.c/185.2.a/350.2/354 先在链上创建再接手打出，而冻结的 create-token " +
    "只在场上创建，effect.token 的 mode \"play\" 被显式 negated（blockedReason: token-play-requires-chain-creation）；" +
    "「exhausted」是入场规定（184.1/185.2.d），不支持入场状态改写，effect.exhaust 的事后横置会多一次" +
    "「成为横置」事件并错过 143.4，故不近似。" +
    "依赖：RIFT-120（move-location 事件载荷与移动注册）、token 链上创建与入场状态（RIFT-62 后续）。",
  abilities,
  sourceText: "When I move, play a Gold gear token exhausted."
} satisfies CardProgram;

export default program;
