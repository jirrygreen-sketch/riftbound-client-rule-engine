import type { CardProgram } from "../../ir/index.js";

/**
 * Trifarian Gloryseeker — CR v1.5 812.1.b.1/812.1.c, 702.2.a, 702.3.a.
 * 复核 2026-10-17：Legion 的触发阈值与「buff me」的非目标自身选择都还不能落地；
 * 保留的 TargetSpec 是受阻描述，不是非目标 Buff 的替代。
 */
const trifarianGloryseeker = {
  canonicalCardId: "card.hash-0e5542d49264324b5497b244de3b3ad36381c763af055108066e1b17f7fb2aa7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-17 复核）：" +
    "(1) Legion 的激活条件（CR 812.1.b.1/812.1.c）在触发时不可求值：本卡触发条件里的 count 表达式只按 filter 数当前对象，" +
    "subject \"cards-finalized-this-turn\" 在 interpreter/expr.ts 的 count 分支完全不参与求值（实测空盘数出 9、7 个单位零次 play 数出 16），" +
    "未知 filter 键被静默忽略，所以该阈值实际是恒真的对象计数，不是「本回合已 Finalize 另一张牌」。" +
    "(2) effect.buff 仍只接受 TargetSpec id（effect.buff.ts::parseArgs 要求非空字符串 target），" +
    "没有非目标自身选择入口；「buff me」属 355.10.d.1 的非目标选择，保留的 self-unit TargetSpec 是受阻描述，" +
    "若强行走 Finalize 会错误产生 became-target。" +
    "(3) 触发注册与展开还有两处拒绝：触发 body 的 object:'self' 键被 programs/filters.translateObjectFilter 拒绝" +
    "（实测 registerProgramTriggers 抛 \"Unsupported filter field object\"），Legion 展开的 condition.predicate 静态谓词" +
    "被 programs/statics.ts::layerFor 拒绝（\"Static ability kind condition.predicate has no layer mapping\"），" +
    "其 history.excluding 载荷也被 interpreter/history.ts 的字段白名单拒绝（\"Unsupported history query field\"）。" +
    "已合入并有执行证据：CardProgram 触发注册的接线与 self 锚点归一化，以及该条件的契约侧经 condition.history 的 exclude:'self' " +
    "能排除本卡对象、保留同 canonicalCardId 的另一张牌（不含按卡身份排除维度）。",
  abilities: [
    { kind: "keyword", keyword: "legion" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "trifarian-gloryseeker.buff-me",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "self-unit" }
          },
          targets: [
            {
              id: "self-unit",
              filter: { object: "self", type: "unit", zone: "board" },
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
    "[Legion] — When you play me, buff me. (If I don't have a buff, I get a +1 :rb_might: buff. " +
    "Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default trifarianGloryseeker;
