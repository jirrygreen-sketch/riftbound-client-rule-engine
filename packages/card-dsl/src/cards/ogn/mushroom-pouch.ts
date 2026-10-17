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
 * Status: judge-required — after the RIFT-270 audit the trigger side is
 * closer: `beginning-start` is emitted by turn/flow.ts (enter('beginning'))
 * for the turn player, but that does not restrict a subscription to its own
 * controller's turn. Two gaps remain:
 * - "your Beginning Phase" needs a player: "self" event filter. The matcher
 *   supports it, but translateTriggerFilter adds event: "beginning-start" and
 *   the production assertTriggerSpec rejects that event name. The placeholder
 *   filter below is empty and would match either player's Beginning Phase;
 * - it needs to evaluate "you control a facedown card at a battlefield", and
 *   the engine's ObjectFilter/ZoneId have no facedown-zone spelling: zones are
 *   deck/hand/board/battlefield/base/rune-zone/… (107.3.e says a Facedown Zone
 *   is not a location, and 107.3.a makes it a sub-zone of a battlefield), and
 *   the ZoneId type has no facedown member; an object's `faceDown` flag is only
 *   readable through `states: \"face-down\"`, which no merged query scopes to a
 *   battlefield Facedown Zone (355.9.a.3); `condition.value`'s count query is
 *   the only evaluation path and it reuses the same filter vocabulary;
 * - program trigger registration, the `beginning-start` producer and the
 *   events/pipeline.ts TriggerCondition fallback are merged; without the
 *   Facedown Zone spelling that fallback's object/zone query still has no
 *   battlefield sub-zone to count face-down cards from.
 * The draw half is executed in isolation by the golden test; nothing is
 * approximated to make the condition pass.
 */
const mushroomPouch = {
  canonicalCardId: "card.hash-689c116add3b0f95eb8a9545f336509a3e539abe5b910af8fb28caba8512f6ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺\"战场上你自己的面朝下牌\"的可求值条件：引擎 ObjectFilter/ZoneId 没有 Facedown Zone 拼写" +
    "（107.3.a/107.3.e：Facedown Zone 是战场的子区域、不是 location；ZoneId 无 facedown 成员），" +
    "faceDown 只能经 states 读取而没有任何已合入查询能把它限定到战场的 Facedown Zone（355.9.a.3），" +
    "condition.value 的 count 求值复用同一套 filter 词汇，无法判定该从句。" +
    "beginning-start 已由 turn/flow.ts 在回合玩家 Beginning Phase 发出（RIFT-270），CardProgram 触发注册也已合入；" +
    "仍缺 \"your Beginning Phase\" 的生产过滤：当前 filter: {} 会匹配双方回合，产生方的 player 载荷不会自动限定己方；" +
    "matchesTriggerEvent 虽支持 player: \"self\"，但 translateTriggerFilter 即使只收到 player 也会补 event: \"beginning-start\"，而 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 没有该名称，assertTriggerSpec 拒绝注册，尚不能在卡牌范围内接通己方阶段过滤（315.2.a.1）。" +
    "触发条件求值也已合入回退路径：events/pipeline.ts 在宿主缺 testTrigger 时用 evaluateTriggerCondition 经上下文 query 求值，生产事件不依赖 testTrigger 成员。" +
    "当前缺口是己方 Beginning Phase 过滤接线与 Facedown Zone 词汇：该回退求值复用同一套 ObjectFilter/ZoneId 词汇，没有可限定位面朝下牌的战场子区域。Draw 1（414.3）已合入并由 golden 单独执行；不近似实现。",
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
