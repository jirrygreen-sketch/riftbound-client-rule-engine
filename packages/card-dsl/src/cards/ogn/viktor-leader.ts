import type { CardProgram } from "../../ir/index.js";

/**
 * Viktor, Leader — CR v1.5 133.8, 187.1, 383.2.c.2, 429.1, 440.2.c.
 * 复核 2026-10-17：token 半段与 condition.value 取基地已有真实执行证据；
 * 触发过滤的 other/excludeTags 仍被翻译器拒绝，同波死亡生命周期也未验证。
 */
const viktorLeader = {
  canonicalCardId: "card.hash-7e53dfef149527260e304de53fa08d40d73dd789893fd093fd83cf275d95b2ac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口（2026-10-17 复核）：" +
    "(1)「another non-Recruit unit you control」（CR 133.8、187.1）的过滤维度缺失：" +
    "programs/filters.ts::translateObjectFilter 对 other 与 excludeTags 都抛 ProgramBindingError" +
    "（实测 \"Unsupported filter field other\" / \"Unsupported filter field excludeTags\"），" +
    "所以 registerProgramTriggers 直接拒绝本卡，触发连注册都做不到；引擎的过滤器（layers/filter.ts、" +
    "events/pipeline-match.ts）也没有读取 excludeTags 的负向标签路径，Recruit 与本卡自身都无法排除。" +
    "(2) 383.2.c.2 要求本卡与另一个非 Recruit 单位在同一死亡动作中一起离场时不触发，" +
    "这条生命周期语义尚无真实死亡波扫描的执行证据（当前死亡清理路径没有同波判定）。" +
    "已合入并有执行证据：token 半段（condition.value 解析能力控制者基地 + effect.token 的 play 模式，" +
    "在控制者基地真实创建并打出 1 Might Recruit）与 CardProgram 触发注册接线本身。",
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
          id: "viktor.controller-base",
          op: "condition.value",
          args: {
            value: { kind: "location", value: { type: "base", player: "controller" } },
            key: { kind: "constant", value: "base" }
          }
        },
        {
          id: "viktor.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "viktor.controller-base",
              key: "base"
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
