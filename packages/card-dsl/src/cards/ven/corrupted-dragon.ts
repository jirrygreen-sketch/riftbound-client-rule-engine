import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Corrupted Dragon (ven-091-166) — Unit, 10 Energy + 2 Body Power, Might 10,
 * Body, tags Dragon/Shadow Isles.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-091-166，逐字）：
 *   If your score is not within 3 points of the Victory Score, I enter ready.
 *   When I attack, you may move any number of enemy units here each with
 *   5 :rb_might: or less to their base.
 *
 * 规则依据（Core Rules v1.5）：
 * - 359.2.c / 369.3：“I enter ready” 是入场替代效果（单位默认横置入场，143.4）；
 *   replacement.enter 的接线见 judgeReason 第 1 条。effect.ready 文件头明确它不参与
 *   入场替代，不能事后补一次 Ready 来模拟。
 * - 194.3：Victory Score 默认 8 点；“within 3 points of the Victory Score” 需要读取
 *   当前 Victory Score（194.3.a 说明它可被模式或卡牌效果改写），PlayerSnapshot 只暴露
 *   各自 score，没有 victoryScore 读数（同 ogn/chem-baroness、ogn/find-your-center 缺口）。
 * - 383.4.e / 466.2.c：“When I attack” 是 Attack Trigger，对应封闭时点 "attack-declared"
 *   （events/timing-points.ts，ruleRefs 323.2/383.4.e/466.2.c）。
 * - 403.1 / 契约 3.9：“you may move any number of …” 的首段 "you may" 是触发能力的可选执行
 *   （optional = true），被选指令包进 choice.optional 的 body。
 * - 355.13：“any number” 含 0 个，因此目标选择是 min 0 的 up-to，amount 由实际选中数量决定；
 *   与已合入 sfd/azir-sovereign 的 "any number of your token units" 同型。
 * - 355.7 / 355.9.a.1：“enemy units here” 指本卡所在战场上由对手控制的单位（355.10.d 不适用，
 *   因为原文指名具体对象）→ 目标选择；"here" 用契约 3.6 的 sameLocationAs 锚点。
 * - 421.1 / 359.3.f：“to their base” 的目的地随每个被移动对象的控制者（effect.move 的
 *   controller-base 语义，同 sfd/janna-savior）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（缺口见 judgeReason）。
 * golden 对未合入依赖只写 test.todo，不写“某原语尚未合入”的断言。
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
        // 该键是描述性占位，不会被已合入匹配器落实（见 judgeReason 第 3 条）。
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
    body: [
      {
        id: "corrupted-dragon.may-move-enemies",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Move any number of enemy units here with 5 Might or less to their base?"
          },
          body: { kind: "constant", value: [moveEnemiesHome] }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-76b98152cdda4a936f20bb7632ab2dd6facf87c9a279ac99c372403ba7e8bfe8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) “I enter ready” 是 359.2.c / 369.3 的入场替代（replacement.enter），" +
    "契约 3.1 的 replacement 能力是纯数据，合并代码没有把 CardProgram 的 replacement 注册进事件管线的消费方" +
    "（events/pipeline.ts 的 ReplacementRegistration 需要调用方提供 matches/apply），effect.ready 也不能事后模拟" +
    "入场状态（依赖 RIFT-89~91 的 replacement.enter 接线，同 sfd/dunebreaker、rad/firebrand-raider 的缺口）；" +
    "(2) 条件 “your score is not within 3 points of the Victory Score” 需要当前 Victory Score（194.3/194.3.a），" +
    "PlayerSnapshot 只有各自 score、没有 victoryScore 读数，Condition 也没有该谓词 —— 硬编码 8 就是臆造" +
    "（同 ogn/chem-baroness、ogn/find-your-center），程序里只作描述性记录；" +
    "(3) “When I attack” 的 attack-declared 时点没有发射方：events/action-adapter.ts 只为已提交游戏动作派生时点，" +
    "combat/ 尚未把取得 Attacker 身份接入事件管线（全仓库无 attack-declared 的 emit），也没有已合入订阅方把" +
    "CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-120），触发无法进链；同时 “each with 5 " +
    ":rb_might: or less” 是当前 Might 的数值上限（143.2.a），冻结 ObjectFilter 与已合入匹配器没有 Might 谓词，" +
    "程序里的 mightLte 只是描述性占位（同 unl/conscription），把它当已实现会让本卡接管任意敌方单位。" +
    "已支持部分：effect.move（含 controller-base 目的地与 355.13 的“any number 含 0”）与 choice.optional 的" +
    "“可以”语义已合入；本卡没有已合入依赖可真实执行（触发进不了链、目标谓词不可求值、入场替代无消费方），" +
    "因此 golden 只做结构与身份断言，未合入依赖写 test.todo。不近似实现。",
  abilities,
  sourceText:
    "If your score is not within 3 points of the Victory Score, I enter ready.\n" +
    "When I attack, you may move any number of enemy units here each with 5 :rb_might: or less " +
    "to their base."
} satisfies CardProgram;
