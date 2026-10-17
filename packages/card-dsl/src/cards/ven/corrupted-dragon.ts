import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * CR v1.5 194.3/194.3.a、359.2.c、383.3.a、421.1。首段 may 属 Finalize，可选触发不再重复包 choice.optional。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：三条缺口逐项实测仍成立（见 judgeReason 与 golden）。
 */
const moveEnemiesHome: Instruction = {
  id: "corrupted-dragon.move-enemies-home",
  op: "effect.move",
  args: {
    // “any number of enemy units here each with 5 :rb_might: or less”：
    // 由玩家在结算时选中的非空集合；min 0 表达 355.13 的“any number（含 0）”。
    // effect.move 的 objects 参数形状是单键选择器 { target: <TargetSpec id> }
    //（同已合入的 sfd/janna-savior），不是 effect.ready/effect.empower 的
    // { kind: "target", id } 写法。
    objects: { kind: "constant", value: { target: "corrupted-dragon.enemy-units-here" } },
    // 421.1 / "to their base"：目的地 = 被移动对象当前控制者的基地。
    to: { kind: "constant", value: "controller-base" },
    amount: {
      kind: "count",
      subject: "objects",
      filter: { object: { target: "corrupted-dragon.enemy-units-here" } }
    },
    linkKey: { kind: "constant", value: "movedEnemies" }
  },
  targets: [
    {
      id: "corrupted-dragon.enemy-units-here",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        // "here"：与本卡同一战场（359.3.f / 契约 3.6 的 sameLocationAs）。
        sameLocationAs: "self",
        // “each with 5 :rb_might: or less”：143.2.a 的有效 Might 上限。冻结的
        // ObjectFilter 没有 Might 谓词（同 unl/conscription 的 mightLte 记录），
        // 该键仍为描述性占位；数值谓词依赖 RIFT-359。
        mightLte: 5
      },
      // 355.13："any number" 允许选择 0 个。
      min: 0,
      selection: "up-to"
    }
  ]
};

const abilities: Ability[] = [
  {
    // “If your score is not within 3 points of the Victory Score, I enter ready.”
    // 359.2.c / 369.3 的入场替代：横置入场的事件被替换为就绪入场。
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      // 359.2.c 的默认入场状态是横置；只有横置入场才需要被替换。
      filter: { source: "self", exhausted: true }
    },
    condition: {
      // 需要当前 Victory Score（194.3/194.3.a）与双方分数；PlayerSnapshot 只有 score，
      // 没有 victoryScore 读数，Condition 也没有该谓词（同 ogn/chem-baroness）。
      // 描述性记录，不是可求值语义（见 judgeReason 第 2 条）。
      kind: "expression",
      value: { kind: "constant", value: "your-score-not-within-3-of-victory-score" }
    },
    with: [
      {
        id: "corrupted-dragon.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: true,
    body: [moveEnemiesHome]
  }
];

export default {
  canonicalCardId: "card.hash-76b98152cdda4a936f20bb7632ab2dd6facf87c9a279ac99c372403ba7e8bfe8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（2026-10-17 复核，均改装为实测证据）：" +
    "(1) 入场替代（194.3/194.3.a、359.2.c）仍缺当前 Victory Score 与自身分数的条件读取：" +
    "PlayerSnapshot 只有 score、没有 victoryScore 读数，Condition 的谓词集合（RIFT-359 增补的 " +
    "played-from-hand / played-from-zone / event-printed / result）也不含任一玩家分数或可变胜利阈值，" +
    "Expr 也没有对应读取路径；硬编码默认 8 就是臆造，故条件字符串仅作描述。" +
    "(2) 攻击能力的 mightLte: 5 与 sameLocationAs 都还不能进生产目标计划：实测 translateObjectFilter " +
    "对 mightLte 与 sameLocationAs 都抛 “Unsupported filter field”（programs/filters.ts 的 allowed 集合" +
    "只有 objectId/cardId/type/zone/location/controller/owner/states/tags/characteristics），" +
    "因此触发注册在翻译阶段就失败；143.2.a 的有效 Might 阈值谓词（RIFT-359 只覆盖印刷特征比较）与" +
    "符号位置锚点的翻译都仍未合入。" +
    "(3) combat/ 尚未发出 attack-declared：事件定义存在（events/timing-points.ts 的 emittedBy: \"combat\"），" +
    "但 combat/flow.ts 的 advance() 在进入 Combat 时直接抛 TurnCombatBlockedError('combat-start-transaction')，" +
    "没有任何 emit('attack-declared') 调用，实际取得战斗身份的路径未接入事件管线。" +
    "已合入并用真实内核执行验证的部分：effect.move 的 objects/to（421.1 的 controller-base）与「any number」含 0（355.13）。",
  abilities,
  sourceText:
    "If your score is not within 3 points of the Victory Score, I enter ready.\n" +
    "When I attack, you may move any number of enemy units here each with 5 :rb_might: or less " +
    "to their base."
} satisfies CardProgram;
