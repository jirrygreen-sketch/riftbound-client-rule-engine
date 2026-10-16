import type { CardProgram } from "../../ir/index.js";

/**
 * Reckoner's Arena (ogn-286-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-286-298):
 *   "When you hold here, activate the conquer effects of units here."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1: "When you hold here …" is a Hold Effect; the closed
 *   `hold` timing point (471.2, 473.2.b) is the one scoring/ is meant to emit.
 * - 383.4.c / 383.4.c.3: Conquer Effects are the Triggered Abilities whose
 *   Condition includes a unit conquering (e.g. "When I conquer…").
 * - 383.4.g / 383.4.g.1: activating a named triggered ability means the player
 *   checks the condition of every specified effect as if the named part were
 *   fulfilled and places the qualifying ones on the chain as if they had just
 *   triggered; 383.4.g.2: no real conquer event occurs.
 *
 * Status: judge-required — two merged gaps, none approximated:
 * 1. no merged module emits `hold` (or any conquer/attack/defend declaration)
 *    into the single event pipeline, so the outer trigger cannot enter the
 *    chain (see judgeReason);
 * 2. there is no primitive to activate a named triggered ability: the RIFT-9
 *    primitive list has no such opcode, engine batch 4's chain layer also
 *    records "命名触发激活缺内部入口" as an open contract change request
 *    (chain/README.md §契约变更请求 3) and SCENARIO-COVERAGE.md marks
 *    triggers-activate-named-trigger-* as uncovered. The body below therefore
 *    documents the intended operation under a clearly-marked, unregistered
 *    opcode; it is not executable data and must not be treated as implemented.
 */
const reckonersArena = {
  canonicalCardId: "card.hash-9b2f53a5fb533d020caec1ce47a2615b15c80247a0a913af8105823ff903f909",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) hold 时点（CR 383.4.d、471.2、473.2.b）没有被任何已合入模块 emit 进唯一事件管线，" +
    "trigger 无法进链（需 scoring/触发接线，RIFT-31/RIFT-33 及契约 §7.2 批 5）；" +
    "(2) 缺“激活命名触发”原语：383.4.g.1 要求按条件检查并像刚触发一样把符合条件的 conquer effects 放进链，" +
    "而 RIFT-9 原语清单与 effects/instructions/ 都没有对应 opcode，body 里的 effect.activate-named-trigger " +
    "是未注册的占位描述（golden 以 TODO 记录待补执行场景），engine 批 4 也在 chain/README.md 契约变更请求 3 " +
    "记录“命名触发激活缺内部入口”、SCENARIO-COVERAGE.md 标注 triggers-activate-named-trigger-* 未覆盖" +
    "（RIFT-120，后续批 5 任务）。另外触发器 filter 里的 here=true 是等待 scoring 载荷的占位键，" +
    "引擎侧 assertTriggerSpec 同样拒绝它。在命名触发放进链的内部入口落地前保持 judge-required，不近似实现。",
  sourceText: "When you hold here, activate the conquer effects of units here.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here": placeholder key until the scoring payload supplies the held
        // battlefield (see judgeReason).
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "reckoners-arena.activate-conquer-effects",
          // Unregistered placeholder for the 383.4.g.1 named-trigger
          // activation (see judgeReason); not an implemented primitive.
          op: "effect.activate-named-trigger",
          args: {
            namedTrigger: { kind: "constant", value: "conquer" },
            scope: {
              kind: "constant",
              value: {
                type: "unit",
                zone: "board",
                location: "here",
                controller: "any"
              }
            },
            checkOtherConditions: { kind: "constant", value: true },
            emitOriginalEvent: { kind: "constant", value: false }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default reckonersArena;
