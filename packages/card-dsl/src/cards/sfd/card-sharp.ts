import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Card Sharp (sfd-081-221) — Unit, Mind, Bilgewater.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-081-221，逐字）:
 *   "When you play me, you and each opponent may play a Gold gear token exhausted. For each
 *   opponent who did, you play a Gold gear token exhausted."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"（383.4.a/420.4.a）：Play Effect，时点 card-played，{ source: "self" }。
 * - "you and each opponent may play a Gold gear token exhausted"：355.10.e 规定由其他玩家（全部或部分）
 *   选出的对象集合不取目标；355.18/355.5.a 规定这类选择在结算时进行。"may" 是 403.1 的可选指令，
 *   按契约 3.9 应把被选指令包进 choice.optional —— 但这里的决定者是**多个**玩家（你与每名对手各一次），
 *   而契约 3.6 的 choose 每次只支持一个 chooser、choice.mode 的 chooser 是单个静态 id，IR 也没有
 *   「其他玩家席位列表」的 Expr 或按席位重复的控制结构（同已合入 ogn/party-favors 记录的缺口）。
 * - "play a Gold gear token exhausted"（440.2.c/185.2.a：被表述为 play 的 token 先在链上创建再由
 *   打出流程接手；184.1/185.2.d："exhausted" 是入场状态规定）：CR 187.5 的 Gold 是 domainless gear token，
 *   自带 "[Reaction][>] Kill this, [E]: [Add] [A]" 能力。
 * - "For each opponent who did, you play a Gold gear token exhausted"："for each ... who did" 需要按
 *   逐席位选择结果计数（359.3.e.14 的引用游戏动作/结果族），冻结 IR 没有「其他玩家选择结果」的绑定。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处依赖未合入，均不近似实现：
 * - 多玩家选择与逐席位结果计数没有 IR 形状（契约 3.6 的 choose 单 chooser、无其他玩家席位枚举、
 *   无按选择结果重复/分支的结构；同 ogn/party-favors 的 RIFT-9 target.player 缺口）。
 * - Gold gear token（CR 187.5）不在 effect.token 的冻结定义表里，该文件明确此类定义保持
 *   blocked/judge-required；mode: "play" 还需 440.2.c/185.2.a 的链上创建 + 打出接手，
 *   "exhausted" 的入场状态改写同样不受支持（184.1/185.2.d）。
 * 程序把两条从句的形状都保留下来（第二条的重复次数经链接值读取第一条的选择结果），供审查与
 * 依赖落地后复核；golden 只做校验/结构断言，执行场景写 test.todo。
 * 依赖：RIFT-9（target.player / 多玩家选择协调）、Gold 定义与链上创建/入场状态（token 原语任务）、RIFT-90（选择结果绑定）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        // 「you and each opponent may play a Gold gear token exhausted」：一次由多个玩家（你与每名对手）
        // 分别做出的可选决定。冻结 IR 没有该控制结构（见 judgeReason），这里以按席位选择的
        // 描述性 op 记录形状；
        // linked 结果键 opponentsWhoPlayed 供下一条从句读取（依赖落地后由该原语写入）。
        id: "card-sharp.each-player-may-play-gold",
        op: "choice.each-player",
        args: {
          choosers: { kind: "constant", value: "controller-and-each-opponent" },
          optional: { kind: "constant", value: true },
          token: { kind: "constant", value: "gold" },
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "chooser" } },
          entersExhausted: { kind: "constant", value: true },
          resultKey: { kind: "constant", value: "opponentsWhoPlayed" }
        }
      },
      {
        // 「For each opponent who did, you play a Gold gear token exhausted」：按前一条的逐席位选择结果
        // 重复（amount 读取该结果计数）；Gold 定义与 184.1/185.2.d 的入场状态改写未合入，见 judgeReason。
        id: "card-sharp.play-gold-per-opponent",
        op: "effect.token",
        linkedTo: "card-sharp.each-player-may-play-gold",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: {
            kind: "linked",
            instructionId: "card-sharp.each-player-may-play-gold",
            key: "opponentsWhoPlayed"
          },
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          entersExhausted: { kind: "constant", value: true },
          linkKey: { kind: "constant", value: "bonusGoldTokens" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-94f6785f45c0764b0cc33e8a81071bd4f8cfdc8c7bc304c63df0687a8e936307",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处依赖未合入，均不近似实现：(1)「you and each opponent may play a Gold gear token exhausted」是由多玩家分别做出的可选决定" +
    "（355.10.e/355.18 的非目标结算期选择）：契约 3.6 的 choose 每次只支持一个 chooser、choice.mode 的 chooser 是单个静态 id，" +
    "IR 也没有「其他玩家席位列表」的 Expr 或按席位重复的控制结构（同 ogn/party-favors 记录的 RIFT-9 target.player 缺口），" +
    "更无法表达「For each opponent who did」的逐席位结果计数（无选择结果绑定）。" +
    "(2) Gold gear token（CR 187.5，domainless gear token，自带 Reaction/Kill/[E]: [Add] [A] 能力）不在 effect.token 的冻结定义表，" +
    "该文件明确此类定义保持 blocked/judge-required；「play ... exhausted」还需 440.2.c/185.2.a 的链上创建 + 打出接手与" +
    "184.1/185.2.d 的入场状态改写（不支持）。程序保留两条从句的形状（第二条经 linked 读取第一条的结果键），golden 不做执行断言（执行场景为 test.todo）。" +
    "依赖：RIFT-9（多玩家选择协调）、RIFT-90（选择结果绑定）、Gold 定义与链上创建/入场状态（token 原语任务）。",
  abilities,
  sourceText:
    "When you play me, you and each opponent may play a Gold gear token exhausted. " +
    "For each opponent who did, you play a Gold gear token exhausted."
} satisfies CardProgram;

export default program;
