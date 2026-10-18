import type { CardProgram } from "../../ir/index.js";

/**
 * Mageseeker Warden (ogn-070-298).
 * CR v1.5 355.17.b explicitly uses Mageseeker Warden as a play restriction example.
 * Both restrictions exist only while the host is at a battlefield.
 * The second clause affects enemy units AND gear, but only spell/ability ready actions.
 * These are blocked continuous.restrict declarations, not executable layer registrations.
 *
 * status 判定（2026-10-18 复核）：judge-required。continuous.restrict 原语与
 * layers/rules/query.ts 的 restrictions() 查询已合入，但两条声明都还不能经生产 static binder 注册：
 * - programs/statics.ts 的 staticFilter 对 filter.controller: "opponent" 抛
 *   "Static controller:opponent filter needs a relative-player query"（实测，两条能力同因失败）。
 * - 第一条的“只能打到自己的基地”需要 Finalize 打出目的地校验读取相对玩家与 allowedDestination：
 *   chain/engine.ts 的 playDestinationIsLegal 只按 continuous.location 的具名 no-base/no-battlefield
 *   判定，不读取本卡的规则字段；“acting-player-base” 也没有消费者。
 * - 第二条只禁止 spell/ability 造成的 ready（causes: spell/ability），而 restrictions() 只按
 *   action 名匹配、不读 causes；参考内核的 block 也不消费 action/causes（实测 restrictions() 对
 *   draw/move 等任意 action 都返回该条目），登记后会过度禁止。
 * - condition 的 self-in-battlefield 判定已修正并可求值：旧拼写 count(filter { object: "self",
 *   zone: "battlefield" }) 在生产 binder 里恒 false（对象 zone 是 "board"，战场是 location 种类）；
 *   已改用 layers/filter.ts 的位置拼写 count(filter { object: "self", location: "battlefield" }) >= 1，
 *   生产 binder 实测战场 true、基地 false。条件本身不再是缺口，但它要等上面的注册与消费方接通后才生效。
 * 依赖：相对玩家目标绑定、ready 的 cause 过滤、打出目的地限制读取。
 * 不替换成入场触发或笼统禁止一切重置。
 */
const program = {
  canonicalCardId: "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "continuous.restrict 原语和 restrictions() 查询已合入，但本卡两条声明的生产绑定仍失败（通用测试台实测）：" +
    "programs/statics.ts 的 staticFilter 对 controller: \"opponent\" 抛 “Static controller:opponent filter " +
    "needs a relative-player query”，两条能力都登记不进图层。位置条件本身已修正并可求值：" +
    "count(filter { object: \"self\", location: \"battlefield\" }) 在生产 binder 实测战场 true、基地 false。" +
    "此外还有两处语义缺口：(1) 第一条的“只能打到自己的基地”需要 " +
    "Finalize 目的地校验读取 relative player 与 allowedDestination；chain/engine.ts 的 " +
    "playDestinationIsLegal 只按 continuous.location 的具名 no-base/no-battlefield 判定，“acting-player-base” " +
    "没有消费者。(2) 第二条只禁止 spell/ability 造成的 ready（causes: spell/ability），但 restrictions() " +
    "只按 action 名匹配、不读 causes，登记后会过度禁止（实测对任意 action 也返回该条目）。" +
    "依赖：相对玩家绑定、ready cause 过滤、打出目的地限制读取（CR 355.17.b / 416）。" +
    "不替换成入场触发或笼统禁止一切重置。",
  abilities: [
    {
      kind: "static",
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            object: "self",
            // 053.3 的 here / "while I'm at a battlefield"：layers/filter.ts 与
            // 解释器集合查询共用的位置拼写（object.zone 是 "board"）。
            location: "battlefield"
          }
        },
        operator: "gte",
        right: {
          kind: "constant",
          value: 1
        }
      },
      effect: {
        kind: "continuous.restrict",
        action: "play",
        filter: {
          type: "unit",
          controller: "opponent"
        },
        allowedDestination: "acting-player-base"
      }
    },
    {
      kind: "static",
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            object: "self",
            location: "battlefield"
          }
        },
        operator: "gte",
        right: {
          kind: "constant",
          value: 1
        }
      },
      effect: {
        kind: "continuous.restrict",
        action: "ready",
        filter: {
          type: [
            "unit",
            "gear"
          ],
          controller: "opponent"
        },
        causes: [
          "spell",
          "ability"
        ],
        allowed: false
      }
    }
  ],
  sourceText: "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear."
} satisfies CardProgram;

export default program;
