import type { CardProgram } from "../../ir/index.js";

/**
 * Mushroom Pouch (ogn-101-298) — Gear, 2 energy, Mind.
 *
 * Printed text:
 *   At the start of your Beginning Phase, if you control a facedown card at a
 *   battlefield, draw 1.
 *
 * Rules evidence (Core Rules v1.5):
 * - 315.2.a.1: "At the start of Beginning Phase game effects take place" —
 *   the events/timing-points.ts `beginning-start` point (ruleRef 315.2.a.1).
 * - 107.3 / 107.3.e / 107.3.f: the Facedown Zone is a Public sub-zone of a
 *   battlefield and is not a location; 355.9.a.3: "Facedown card" refers to a
 *   card in a Facedown Zone unless specified otherwise.
 * - 355.10 / 355.10.c: "if you control a facedown card …" is a condition, not
 *   a target — nothing is chosen.
 * - 414.3: "Draw 1." is resolved with effect.draw; the implicit drawer is the
 *   ability controller (190.6.d).
 *
 * Status: judge-required（2026-10-17 复核）。`beginning-start` 由 turn/flow.ts 在回合玩家
 * Beginning Phase 发出（RIFT-270），CardProgram 触发注册与 events/pipeline.ts 的
 * TriggerCondition 回退都已合入；两处已实测的缺口：
 * - "your Beginning Phase" 需要 player: "self" 过滤。matcher 支持它，但
 *   translateTriggerFilter 只要收到 player 就会补 event: "beginning-start"，
 *   而 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭枚举（无该名称），
 *   validateTriggerSpec / registerTrigger 实测拒绝。当前 filter: {} 因此匹配双方回合。
 * - "you control a facedown card at a battlefield" 需要 Facedown Zone 词汇：
 *   107.3.a/107.3.e/355.9.a.3 的 Facedown Zone 是战场的子区域、不是 location，
 *   ZoneId（effects/contract.ts）与 OBJECT_FILTER_ZONES 都没有 facedown 成员，
 *   faceDown 只能经 states 读取；触发条件的求值走宿主适配器自己的 query，
 *   test-kernel.matchesQueryFilter 只认 type/tags/controller/owner/zone/location/combatRole
 *   并对未知键返回 true，game-server.host.matchesFilter 只认 zone/type/owner/controller
 *   且按字面比较——两者都不实现本从句。
 * The draw half is executed in isolation by the golden test; nothing is
 * approximated to make the condition pass.
 */
const mushroomPouch = {
  canonicalCardId: "card.hash-689c116add3b0f95eb8a9545f336509a3e539abe5b910af8fb28caba8512f6ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处已实测的当前缺口：(1) \"your Beginning Phase\" 的己方过滤：beginning-start 已由 turn/flow.ts 在回合玩家 " +
    "Beginning Phase 发出（RIFT-270），但 translateTriggerFilter 只要收到 player 就会补 event: \"beginning-start\"，" +
    "而 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭枚举（无 beginning-start），validateTriggerSpec 实测返回 " +
    "trigger.filter.event/invalid-event-type、registerTrigger 抛 TriggerSpecValidationError；" +
    "matchesTriggerEvent 本身支持 player: \"self\"，缺的是注册校验面的词汇/翻译。当前 filter: {} 因此会匹配双方回合。" +
    "(2) \"a facedown card at a battlefield\" 的求值：107.3.a/107.3.e/355.9.a.3 的 Facedown Zone 是战场的子区域、不是 " +
    "location，ZoneId（effects/contract.ts）与 OBJECT_FILTER_ZONES 都没有 facedown 成员，faceDown 只能经 states 读取。" +
    "触发条件的求值路径是 events/pipeline.ts 的 evaluateTriggerCondition → host.context(...).query(filter)，用的是宿主适配器" +
    "自己的 query，而两个已合入适配器都不实现本从句需要的键：effects/testing/test-kernel.ts 的 matchesQueryFilter 只认 " +
    "type/tags/controller/owner/zone/location/combatRole，其余键直接返回 true（实测 states 被忽略），" +
    "所以 {states: \"face-down\"} 会连自身与 Base 上的面朝下牌一起计入（实测命中 3 个对象、条件为真）；" +
    "apps/game-server 的 host.matchesFilter 只认 zone/type/owner/controller 并按字面比较（实测控制者不解析），" +
    "故条件恒为假。撤销的中立拼写也不存在：zone 只有 board（没有 battlefield 子区域），location: \"battlefield\" " +
    "在参考内核里与 location 对象字面比较、永不命中。" +
    "chain/engine.ts 的指令 ctx.query 能解析 controller:self + states + location 并经 layers/filter 命中战场上那一个面朝下牌，" +
    "但触发条件不走该路径。Draw 1（414.3）已合入并由 golden 单独执行；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        // Pending: the empty filter does not enforce "your Beginning Phase".
        // A player: "self" pattern currently fails production trigger-spec
        // validation after translation adds event: "beginning-start".
        filter: {},
        condition: {
          kind: "compare",
          // "if you control a facedown card at a battlefield" — the
          // facedown-zone condition (see judgeReason).
          left: {
            kind: "count",
            subject: "facedown-cards",
            filter: {
              controller: "controller",
              zone: "battlefield",
              states: "face-down"
            }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1."
} satisfies CardProgram;

export default mushroomPouch;
