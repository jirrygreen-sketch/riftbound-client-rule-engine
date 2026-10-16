import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mindsplitter (ogn-192-298) — Unit, 7 energy + 2 Chaos power, 7 Might.
 *
 * Printed text:
 *   When you play me, choose an opponent. They reveal their hand. Choose a card
 *   from it, and they discard that card.
 *
 * 规则依据（CR v1.5）：
 * - “When you play me” 是 Play Effect（383.4.a.1 / 383.4.a.2），时点 card-played。
 * - “choose an opponent”：选择的是玩家而不是游戏对象，355.9.a 允许目标为 player；
 *   355.7（指名 Players）、355.10.f（“必须完成”的指示不算目标）——但这里的对手由本卡
 *   控制者选择，选项集合是“所有对手”。IR 里没有玩家目标原语：`TargetSpec` 只描述对象
 *   过滤器，`PickSpec.options` 是静态值数组，`ResolveContext.targets/picks` 返回的是
 *   ObjectRef，唯一能承载 PlayerId 的是 `picks()`（返回 `ObjectRef | PlayerId | string`）。
 *   因此本程序把对手选择写成 `target.player`，其运行语义（可选对手集合、按回合顺序
 *   展示、重放式选择）需要新原语，不能靠现有 op 近似。
 * - “They reveal their hand”：425.1 / 425.3.a（未指明张数时展示该区域当前全部牌）、
 *   425.2（Reveal 是 Limited Action）。`effect.reveal` 已合入，`player` 参数接 PlayerId。
 * - “Choose a card from it, and they discard that card”：被展示的牌位于手牌（私有区域），
 *   355.10.a 明确“非公开区域里的对象”不是目标，所以是从已展示集合里做的非目标选择
 *   （pick）；`effect.discard` 的 `pick` + `player` 正是这个形状，且 423.1.a 规定弃牌由
 *   执行者选择。`effect.discard` 已合入。
 *
 * status 判定（README 第 2 节）：judge-required。缺口是玩家选择原语 `target.player`
 * （ability-templates 第 4 节 target.player 行：“each player 与 choose opponent 不等价”），
 * 以及把该选择结果作为 `effect.reveal` / `effect.discard` 的 player 参数传递的链接值形状。
 * 后续两个指令已合入，golden 测试用链接值直接绑定对手并真实执行展示 + 弃牌两步。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "mindsplitter.choose-opponent",
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          linkKey: { kind: "constant", value: "chosenOpponent" }
        }
      },
      {
        id: "mindsplitter.reveal-hand",
        op: "effect.reveal",
        linkedTo: "mindsplitter.choose-opponent",
        args: {
          player: {
            kind: "linked-value",
            instructionId: "mindsplitter.choose-opponent",
            key: "chosenOpponent"
          },
          zone: { kind: "constant", value: "hand" }
        }
      },
      {
        id: "mindsplitter.discard-chosen-card",
        op: "effect.discard",
        linkedTo: "mindsplitter.reveal-hand",
        args: {
          amount: { kind: "constant", value: 1 },
          player: {
            kind: "linked-value",
            instructionId: "mindsplitter.choose-opponent",
            key: "chosenOpponent"
          },
          pick: { kind: "constant", value: "revealed-card" }
        },
        picks: [
          {
            id: "revealed-card",
            // 选项来自上一条 reveal 的实际结果（契约 3.9 的 linked-value）。
            options: [
              { kind: "linked-value", instructionId: "mindsplitter.reveal-hand", key: "revealed" }
            ],
            filter: { zone: "hand" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-5a79c5095e64f0c9ef63111a8530ec0264177b86281200874b657db83e5543f5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺玩家选择原语：契约 3.6 的 TargetSpec 只描述对象过滤器，PickSpec.options 是静态值数组，" +
    "targets()/picks() 的对象形状承载不了“在所有对手中选一个玩家”的重放式选择；" +
    "本程序声明的 target.player 在 effects/instructions/ 里没有实现文件" +
    "（ability-templates 第 4 节 target.player 行：each player 与 choose opponent 不等价）。" +
    "后续的 effect.reveal（show opponent's hand）+ effect.discard（pick 玩家手牌）均已合入；" +
    "golden 测试用链接值直接绑定对手玩家，真实执行这两步。依赖：target.player 原语落地。",
  abilities,
  sourceText:
    "When you play me, choose an opponent. They reveal their hand. Choose a card from it, " +
    "and they discard that card."
} satisfies CardProgram;

export default program;
