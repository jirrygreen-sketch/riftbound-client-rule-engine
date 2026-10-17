import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Miss Fortune, Buccaneer (ogn-193-298) — Unit, 4 energy + 1 Chaos power, 4 Might.
 *
 * Printed text:
 *   You may play me to an open battlefield.
 *   Friendly units may be played to open battlefields.
 *
 * 规则依据（CR v1.5）：
 * - 355.2 / 355.2.a：单位打出时选择合法 Location，默认只有控制者的 Base 或
 *   其控制的战场；355.2.b：游戏效果可以授予默认之外的合法位置。
 * - 170.11.c：Battlefield 称为 “open” 当且仅当它既 unoccupied（170.11.a：没有单位）
 *   又 uncontrolled（170.11.b：无玩家控制）。两句原文用的都是这个定义。
 * - 两句都是**静态许可**（“may be played”），不是触发能力也不是可选指令：
 *   “You may play me to an open battlefield” 只给本卡自己加一个合法位置；
 *   “Friendly units may be played to open battlefields” 是一个持续授予（本卡在场期间，
 *   控制者的所有友方单位都获得该许可）。契约 3.1 的 play 能力只有 restriction（限制）
 *   字段，没有许可字段，故按同类先例（sfd/dauntless-vanguard.ts 的
 *   `play-location-permission` 静态效果）表达两条能力，由 layers/Finalize 消费。
 *
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required。三处已实测的当前缺口：
 * 1. 两条声明用的 effect kind `play-location-permission` 没有静态层映射：programs/statics.ts 的
 *    layerFor 对其抛 "Static ability kind play-location-permission has no layer mapping"（实测），
 *    生产 static binder 无法注册任何一条许可。
 * 2. 即使改写成 `continuous.location`，许可名也只有字符串（layers/rules/query.ts 的
 *    playLocations 只读 effect.permission 字符串），chain/engine.ts 的 playDestinationIsLegal
 *    只识别 no-base/no-battlefield 这类具名禁止，不认识 open battlefield（170.11.c）这一状态。
 * 3. “Friendly units may be played to open battlefields” 需要把许可持续授予控制者的所有友方单位
 *    （355.2.b）；appliesTo: "friendly-units" 与 relative 玩家在 staticFilter 里没有绑定路径
 *    （controller: "opponent" 一类相对玩家会被拒绝），Finalize 无法按打出者求值。
 * 依赖：play-location-permission/continuous.location 的静态图层映射、open battlefield 的
 * Finalize 目的地判定与友方单位许可的作用域绑定。不近似实现（不把 open 简化为任意战场）。
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
          battlefield: { occupied: false, controlled: false },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    },
    condition: { kind: "always" }
  },
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: false, controlled: false },
          appliesTo: "friendly-units"
        }
      },
      duration: "while-on-board"
    },
    condition: { kind: "always" }
  }
];

const program = {
  canonicalCardId: "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处已实测的当前缺口：" +
    "(1) 两条声明用的 effect kind `play-location-permission` 没有静态层映射——programs/statics.ts 的 " +
    "layerFor 抛 “Static ability kind play-location-permission has no layer mapping”，生产 static binder " +
    "无法注册任何一条许可。" +
    "(2) 即便改写成 continuous.location，playLocations 只读 effect.permission 字符串，chain/engine.ts 的 " +
    "playDestinationIsLegal 只识别 no-base/no-battlefield 这类具名禁止，不认识 open battlefield（170.11.c：" +
    "unoccupied 且 uncontrolled）这一位置状态，Finalize 无法推导该许可。" +
    "(3) “Friendly units may be played to open battlefields” 要把许可持续授予控制者的所有友方单位" +
    "（355.2.b），但 appliesTo: \"friendly-units\" 与 relative 玩家在 staticFilter 没有绑定路径，" +
    "Finalize 无法按打出者求值。依赖：静态图层映射、open battlefield 目的地判定与友方作用域绑定。不近似实现。",
  abilities,
  sourceText:
    "You may play me to an open battlefield.\nFriendly units may be played to open battlefields."
} satisfies CardProgram;

export default program;
