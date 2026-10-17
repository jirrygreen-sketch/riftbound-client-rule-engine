import type { CardProgram } from "../../ir/index.js";

/**
 * CR v1.5 355.7/355.9.a：「Choose an opponent」是玩家目标，当前 TargetSpec 仅绑定对象。
 * 425.3.a / 425.1.a.2：展示整手牌而不离区；该子效果已真实执行。
 * 355.18 / 417.1.a/.c：由施法者在已展示手牌中非目标选择 Mind 牌，再回收到拥有者牌库。
 * effect.recycle.from 由区域拥有者选择且不带卡牌过滤；effect.inspect 是私下查看选择，
 * 有序 picks 在 Finalize 锁定，都不能直接替代本牌的公开结算期选择。
 * 134：领域独立于印刷 Power 费用，不能用 power 包含 Mind 近似领域成员。
 */
const decreeOfStrength = {
  canonicalCardId: "card.hash-a8174733ce8471dd791d71e2914a7f93d9d2f6c25c8d7937bead01c30d962f4a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺三处接线：(1)「Choose an opponent」是 355.7/355.9.a 的玩家目标，TargetSpec / ctx.targets 只绑定 ObjectRef，" +
    "没有 target.player 形态及把选中玩家传入 effect.reveal.player 的表达式。" +
    "(2) 355.18/417.1.a/417.1.c：effect.recycle 仅支持 target / objects / from，" +
    "from 由区域拥有者选择且无卡牌过滤，缺本法术控制者在已展示手牌中选择再回收的描述符；" +
    "effect.inspect 的私下查看选择与 Finalize 有序 picks 不能替代该公开结算期选择。" +
    "(3) 134 的 Mind 领域缺独立快照字段与成员谓词，印刷 Power 费用不能替代领域。" +
    "event-printed 已可比较印刷费用，但不提供领域成员筛选或玩家目标。effect.reveal 整区展示已真实执行（425.3.a），不近似实现。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 1 Energy（power: null 表示无印刷 Power，不写成 0）。
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "decree-of-strength.reveal-hand",
          op: "effect.reveal",
          args: {
            // "They reveal their hand"：揭示者是第 1 句选中的对手。把玩家目标绑定到 player
            // 实参的表达式尚未合入（见 judgeReason 第 1 条），此处保留占位；golden 用具体对手执行。
            player: { kind: "constant", value: "opponent" },
            // 省略 count：展示手牌当时的全部牌（425.3.a）。
            zone: { kind: "constant", value: "hand" }
          },
          // "Choose an opponent" 的玩家目标（355.7/355.9.a）：ObjectFilter 无法匹配玩家，
          // 该形状只作可审查数据（同 Sabotage）。
          targets: [
            {
              id: "decree-of-strength.opponent",
              filter: { kind: "player", player: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "decree-of-strength.recycle-mind-card",
          op: "effect.recycle",
          linkedTo: "decree-of-strength.reveal-hand",
          args: {
            // "you choose a Mind card from it" + "They recycle that card"：在已展示手牌里
            // 由本法术控制者做一次带域限制的非目标选择，再按 417.1.a 回收。effect.recycle
            // 尚无结算期 choose 描述符、也没有域过滤（见 judgeReason 第 2、3 条），故这条
            // 只作可审查数据：不执行、不改成"任意手牌"或"固定某张"等近似写法。
            choose: {
              kind: "constant",
              value: {
                id: "decree-of-strength.chosen-card",
                filter: { zone: "hand", owner: "opponent", domain: "Mind" },
                chooser: "controller",
                visibility: "public",
                prompt: "Choose a Mind card from the revealed hand to recycle."
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose an opponent. They reveal their hand and you choose a Mind " +
    "(:rb_rune_mind:) card from it. They recycle that card."
} satisfies CardProgram;

export default decreeOfStrength;
