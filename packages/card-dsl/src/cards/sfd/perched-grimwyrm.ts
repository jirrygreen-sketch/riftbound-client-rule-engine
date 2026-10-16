import type { CardProgram } from "../../ir/index.js";

/** Perched Grimwyrm (sfd-015-221). */
export default {
  canonicalCardId: "card.hash-1e5601a20e9eec5eb8bd27251a8711e541767f111db13703166777e918b52cbb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Play me only to a battlefield you conquered this turn』是打出限制（355.17.b、366.1），但当前没有 CardProgram play restriction 到 Make Relevant Choices/Finalize 的消费方；" +
    "『you conquered this turn』还需要按回合、按战场记录征服历史的谓词，现有 HistoryQuery/Restriction 没有可执行的战场位置维度。依赖 RIFT-89/RIFT-120 与打出限制接线。",
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
