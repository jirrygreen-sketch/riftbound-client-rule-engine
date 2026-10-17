import type { CardProgram } from "../../ir/index.js";

/** Perched Grimwyrm (sfd-015-221). */
export default {
  canonicalCardId: "card.hash-1e5601a20e9eec5eb8bd27251a8711e541767f111db13703166777e918b52cbb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Play me only to a battlefield you conquered this turn』是打出限制（355.17.b、366.1），当前真实缺口有两处：" +
    "① 没有 CardProgram play restriction 到 Make Relevant Choices/Finalize 的消费方；" +
    "② 『you conquered this turn』需要按回合、按战场记录征服历史的谓词——HistoryQuery 已合入但没有可执行的战场位置维度（361/366 的位置历史）。" +
    "依赖：打出限制接线与按战场的征服历史谓词。不近似实现。",
  abilities: [
    {
      kind: "play",
      restriction: {
        kind: "play-only-to-conquered-battlefield-this-turn",
        value: {
          kind: "constant",
          value: { location: "battlefield", controller: "controller", conqueredThisTurn: true }
        }
      },
      body: []
    }
  ],
  sourceText: "Play me only to a battlefield you conquered this turn. (You can't play me anywhere else.)"
} satisfies CardProgram;
