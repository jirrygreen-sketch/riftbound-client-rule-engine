import type { CardProgram } from "../../ir/index.js";

/**
 * Hidden Blade — ogn-213-298 (Spell, Order, 2 Energy + 1 Order Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-213-298):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Kill a unit at a battlefield. Its controller draws 2.
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Hidden]" (811) and "[Action]" (806) are keyword abilities expanded by
 *   the keyword registry (effects/keywords/Hidden.ts, Action.ts; contract
 *   3.7). Hidden's expansion (RIFT-84) grants the Hide discretionary action
 *   plus the facedown play permission; Action's expansion grants the Showdown
 *   timing permission. The card only names both keywords.
 * - "Kill a unit at a battlefield" is a targeted active kill (429.1.a.1.a,
 *   429.6): one unit whose location is a battlefield (355.9.b; 355.10.b
 *   explains that "at a battlefield" restricts the unit and does not target
 *   the battlefield). When this card is played from facedown, 811.1.d.2
 *   further restricts the target to the battlefield it was hidden at; that
 *   restriction belongs to Hidden's expansion and the target system
 *   (RIFT-84 / RIFT-90), not to this data.
 * - "Its controller draws 2" is a linked instruction: 359.3.e.14 uses Hidden
 *   Blade itself as its worked example — the "its" in the second instruction
 *   references the unit in the first, so the two instructions are linked.
 *   359.3.e.14.a: if the first instruction is ignored (the unit changed zones
 *   or moved to base in response), the second does not execute.
 *   359.3.e.14.b: if the kill action is negated (replaced or skipped), the
 *   second still executes because it does not reference the action directly.
 *   The merged interpreter implements exactly this propagation (linkedTo plus
 *   an object-property selector; a stale target makes both instructions
 *   ignored), and the drawer is read from the unit's controller through the
 *   target selector.
 * - The card cannot honestly be marked executable because Hidden's own
 *   expansion is still blocked: its expansion (RIFT-84, merged) is a static
 *   `cost.hidden` continuous effect with no merged consumer — nothing reads
 *   cost.hidden to grant the Hide action or the facedown play — and
 *   cost/README.md records that the current zones/actions omit the
 *   Champion/facedown zones and Hide. Both printed instructions themselves
 *   execute against the merged kernel.
 */
const hiddenBlade = {
  canonicalCardId: "card.hash-3dda301e097b7f95aea9fe9c82ccf2b5b310023e40847896aaedb9aff1c0bce1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Hidden] 展开仍不可执行：RIFT-84 已合入 Hidden 关键词展开，但它的 cost.hidden 持续效果没有消费方——" +
    "没有已合入代码据它授予 Hide 动作、facedown 区域或「facedown 免费/受限打出」；cost/README.md 记录现有区域与" +
    "动作尚缺 Hide/facedown。来自 facedown 的「目标限为藏匿所在战场」（811.1.d.2）同样依赖 Hidden 展开的消费方与" +
    "目标系统。Hide 的费用/动作接线依赖 RIFT-261，CardProgram 关键词与打出绑定依赖 RIFT-257。两条正文指令（targeted 消灭 + 链接的「Its controller draws 2」）可用已合入解释器真实执行，" +
    "见 golden 测试；整卡不因正文可执行而宣称 executable。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "hidden-blade.kill",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "hidden-blade.unit" } },
          targets: [
            {
              id: "hidden-blade.unit",
              filter: { types: "unit", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 359.3.e.14: "its" links the two instructions. The drawer is read
          // from the killed unit's controller (the target selector keeps last
          // known information after the kill); 359.3.e.14.a makes a lost
          // target ignore this instruction too, while 359.3.e.14.b keeps it
          // running when only the kill action was negated.
          id: "hidden-blade.controller-draws",
          op: "effect.draw",
          linkedTo: "hidden-blade.kill",
          args: {
            amount: { kind: "constant", value: 2 },
            player: {
              kind: "object-property",
              object: { target: "hidden-blade.unit" },
              property: "controller"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Kill a unit at a battlefield. Its controller draws 2."
} satisfies CardProgram;

export default hiddenBlade;
