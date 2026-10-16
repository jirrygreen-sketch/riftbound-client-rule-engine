import type { CardProgram } from "../../ir/index.js";

/**
 * Convergent Mutation (ogn-108-298) — Spell, 2 energy + 1 Mind power.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a friendly unit. This turn, increase its Might to the Might of
 *   another friendly unit.
 *
 * Status: judge-required — the effect half has no merged write path and one
 * open rules question, neither of which is approximated:
 * - "increase its Might to the Might of another friendly unit" is an
 *   arithmetic "set" effect (479.4.b uses exactly this phrasing as its
 *   snapshotting example), but contract 3.6's closed GameAction set has no
 *   Might-modification action, effect.buff documents that temporary Might
 *   belongs to the layers' continuous.might effect, and no merged instruction
 *   opcode registers a continuous effect through ctx.addContinuous (RIFT-91
 *   layers-continuous is not merged). Shield/Assault only author the static
 *   shape as data.
 * - The referenced unit is unresolved in the rules evidence: the text does
 *   not say who chooses "another friendly unit" or when, and 355.7 makes a
 *   chosen object Targeted while 479.4.b requires the value to be locked by
 *   snapshotting. Both readings are defensible, so the instruction is kept as
 *   a described target pair without claiming execution.
 *
 * The printed [Reaction] keyword is declared as a keyword ability (813 /
 * 159.2.b); its continuous.timing expansion and admission are chain-owned.
 */
const convergentMutation = {
  canonicalCardId: "card.hash-6d70f12e2dfb5fbc2398e27f4f4f03110c0310091884499b782107d95b9d6c65",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.might 的 set 写入路径：契约 3.6 封闭 GameAction 集合无 Might 修改动作，" +
    "effect.buff 明确临时 Might 属 layers 的 continuous.might，而当前没有任何指令原语可经 " +
    "ctx.addContinuous 注册该持续效果（依赖 RIFT-91 layers-continuous 与时长到期）；" +
    "另“increase its Might to the Might of another friendly unit”取值语义未定：被引用单位是否为目标" +
    "（355.7）及其 Might 按 479.4.b 快照还是结算时动态读取无官方裁决。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "This turn, increase its Might to the Might of another friendly
          // unit" — described via the layers contract shape (mode "set", value
          // read from the reference unit). No merged opcode consumes it yet; see
          // judgeReason.
          id: "convergent-mutation.set-might",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "set" },
            // TargetSpec id, as in the effect.* family's own conventions.
            appliesTo: { kind: "constant", value: "chosen-unit" },
            value: {
              kind: "object-property",
              object: { target: "another-friendly-unit" },
              property: "might"
            },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "chosen-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "another-friendly-unit",
              filter: { type: "unit", controller: "self", other: true },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit. This turn, increase its Might to the Might of another friendly unit."
} satisfies CardProgram;

export default convergentMutation;
