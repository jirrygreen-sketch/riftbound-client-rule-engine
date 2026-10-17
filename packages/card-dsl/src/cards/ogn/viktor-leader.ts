import type { CardProgram } from "../../ir/index.js";

/**
 * Viktor, Leader — CR v1.5 133.8, 187.1, 383.2.c.2, 429.1, 440.2.c.
 * Trigger registration and token Expr dispatch are merged. The filter still
 * needs other/non-Recruit exclusion and simultaneous-death lifetime validation,
 * while the controller-base LocationRef needs RIFT-357.
 */
const viktorLeader = {
  canonicalCardId: "card.hash-7e53dfef149527260e304de53fa08d40d73dd789893fd093fd83cf275d95b2ac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「another non-Recruit unit you control」（CR 133.8、187.1、383.2.c.2）仍缺触发过滤的 other 自身排除和 excludeTags 负向标签维度：programs/filters.translateObjectFilter 不接受这两个键；需条件/过滤谓词 RIFT-359，不能包含 Recruit 或本卡。" +
    "effect.token 的 controller 基地占位也需位置绑定 RIFT-357；此外 383.2.c.2 要求同一死亡动作中本卡已离场时不触发，需随真正的死亡波扫描验证。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          filter: {
            type: "unit",
            controller: "controller",
            other: true,
            excludeTags: ["Recruit"]
          }
        }
      },
      optional: false,
      body: [
        {
          id: "viktor.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            linkKey: { kind: "constant", value: "recruitToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When another non-Recruit unit you control dies, play a 1 :rb_might: Recruit unit token into your base."
} satisfies CardProgram;

export default viktorLeader;
