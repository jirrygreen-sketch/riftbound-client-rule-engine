import type { Ability, CardProgram } from "../../ir/index.js";

/** CR v1.5 827.1.c.1、828.1.b.1/828.1.c、421.1。抽牌 body 可执行，依赖能力的状态门控仍阻塞整卡。 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 3
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "covert-informant.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-a7852cd3cb51ac726ccf3fd549d64c739122b2160a5f283dd604718dda7c5bb6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Empower/Empowered 的关键词展开：827.1.c.1 的 3 Energy 起动费用、仅当未 Empowered 的限制，以及 828.1.b.1/828.1.c 的依赖能力门控。effect.empower 已能提交 Empower 动作，但 ObjectSnapshot 未暴露 442.1.a 的 Empowered 状态，无法据此绑定 object-moved 的抽牌能力；状态读取与条件谓词需补齐（RIFT-359）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] When I move, draw 1."
} satisfies CardProgram;
