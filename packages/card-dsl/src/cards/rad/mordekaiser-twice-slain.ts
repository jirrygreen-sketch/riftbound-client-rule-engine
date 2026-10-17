import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mordekaiser, Twice Slain — CR v1.5 805, 807, 355.10.c.1, 369, 457-460.
 * Assault layers and generic replacement registration are implemented.
 * Re-probed 2026-10-17, the card-facing boundaries are:
 * - replacement/planner.ts gives effect.kill no args.picks path: it requires an
 *   object-selector args.target and throws "effect.kill target must be an object
 *   selector spelling" at bind time, so the filtered friendly sacrifice never
 *   plans (replacement/planner.ts also has no pick-selection lifecycle).
 * - effect.move mode "recall" is explicitly negated ("no Recall action exists");
 *   457-460 need a distinct recall action instead of move+mode.
 * - ReplacementAbility (ir/types.ts) has no optional/oncePerTurn fields, so
 *   bindReplacement cannot pass the pipeline's existing oncePerTurn support.
 * - Accelerate: effects/keywords/Accelerate.ts expands static
 *   { kind: "accelerate.cost" } and an entry-replacement, but
 *   programs/statics.ts layerFor() rejects it ("Static ability kind
 *   accelerate.cost has no layer mapping") and programs/play.ts never binds the
 *   paid selection to the entry replacement. programs/play.ts also has no
 *   optionalAdditional wiring, so even a declared accelerate cost would be a
 *   base cost. Do not enter ready without payment.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "assault", value: 3 },
  {
    kind: "replacement",
    // “if I would die” — 被替代事件是来源单位被消灭（429.1.a.1；死亡替代在
    // 替代处理后、实际换区前收集）。
    replaces: { event: "object-killed", filter: { source: "self" } },
    with: [
      {
        // “kill a friendly unit” — 费用式动作，按 355.10.c.1 不是目标，因此用 picks
        // （非目标选择）而不是 targets；静态 IR 只能给出描述性选项，替代发生时的
        // 具体引用由替代层的动态 picks 适配器提供。
        id: "mordekaiser.kill-friendly",
        op: "effect.kill",
        args: { picks: { kind: "constant", value: "mordekaiser.friendly-unit" } },
        picks: [
          {
            id: "mordekaiser.friendly-unit",
            options: ["friendly-unit-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "unit", zone: "board", controller: "self" }
          }
        ]
      },
      {
        // “heal me” — effect.heal 的缺省选择就是能力来源（419.1 清除标记伤害）。
        id: "mordekaiser.heal-self",
        op: "effect.heal",
        args: {},
        linkedTo: "mordekaiser.kill-friendly"
      },
      {
        // “exhaust me” — 效果型横置（415.1）。用非目标选择（choose）加 source 过滤锚点
        // 表达“来源自己”，不把自身写成目标（355.10.c）。
        id: "mordekaiser.exhaust-self",
        op: "effect.exhaust",
        args: {
          choose: {
            kind: "constant",
            value: { id: "mordekaiser.exhaust-me", filter: { source: "source" } }
          }
        },
        linkedTo: "mordekaiser.heal-self"
      },
      {
        // “and recall me instead” — 457/458/458.3/460.1：Recall 不是 Move，不能被移动
        // 限制阻止，也不改变状态；effect.move 的 recall 模式目前显式阻断。
        id: "mordekaiser.recall-self",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: "source" },
          to: { kind: "constant", value: "controller-base" },
          mode: { kind: "constant", value: "recall" }
        },
        linkedTo: "mordekaiser.exhaust-self"
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-f7168f36176ada340afa90fee63698e923fee7c44c455b65ba0fa4cf1b747c7e",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺替代内费用的非目标动态选择（CR 355.10.c.1）：replacement/planner.ts 的 effect.kill 只规划 args.target 对象，" +
    "尚未消费本卡 args.picks，实测 bindReplacement 直接抛 “effect.kill target must be an object selector spelling”；" +
    "cost.choice 也只接受精确引用。缺区别于 Move 的 Recall 动作（457-460），effect.move 的 recall 模式与替代 planner 均阻断" +
    "（原语返回 negated/impossible：“no Recall action exists”）。ReplacementAbility 没有 optional/oncePerTurn 字段，" +
    "bindReplacement 未把本卡「you may/Once each turn」传给已有的管线支持。另缺 Accelerate（805.2.b）的付费门控：" +
    "programs/statics.ts 的 layerFor 拒绝 Accelerate 展开的 static accelerate.cost（“Static ability kind accelerate.cost has no layer mapping”），" +
    "programs/play.ts 既不消费 accelerate.cost 也不把它与 enter-ready 替代关联；不得无付费就就绪。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
    "Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead."
} satisfies CardProgram;

export default program;
