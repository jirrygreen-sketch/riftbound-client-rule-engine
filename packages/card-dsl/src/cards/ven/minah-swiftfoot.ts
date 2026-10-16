import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Minah Swiftfoot (ven-111-166) — Unit, Chaos, tag Ionia.
 * 6 Energy + 1 Power（印刷 `power: 1`，域由卡表 domains 给出）、Might 6。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-111-166，逐字；两行模式在目录里
 * 用 “1.Each” 直接相连，见下方数据记录）：
 *   When I move to a battlefield, choose one —
 *   Each player discards 1.Each player draws 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - 421.1 / 449.1 / 449.2 / 458：“When I move to a battlefield” 订阅 Move 事件（封闭时点
 *   object-moved）；458/458.1 的 Recall 不是 Move，因此不能订阅通用换区。filter 用
 *   { source: "self" } 指称本卡（同 sfd/corinna-veraza）。
 * - 355.3：带项目符号的模式列表在 Finalize 选择，契约 3.9 冻结为一条 choice.mode
 *   （modes[{id, body}]、count 1、different true）。
 * - 423 / 423.1 / 423.4 / 423.5：“Each player discards 1” 是 Discard（effect.discard，
 *   changeId 固定以便重放），423.4 规定尽可能多弃。
 * - 414.1 / 414.3：“Each player draws 1” 是 Draw（effect.draw）。
 * - “each player” 是全体玩家的程序化集合（355.10.d 的集合语义，不是目标）：成员由 Mode of Play
 *   决定，每名成员各自执行自己的那次动作。
 *
 * 数据记录（不改卡牌数据）：目录把两个模式写成 "...discards 1.Each player draws 1."——
 * 句号后直接接下一句，缺少空格的形态与同类模式列表（如 rad/command-attack）一致；sourceText
 * 严格保留目录字节，模式拆分按印文明确的两项处理。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处缺口均不近似实现：
 * 1. “each player discards/draws” 是逐玩家迭代：已合入 IR 是单一 body + 单一 ResolveContext
 *    （effect.discard/effect.draw 的 player 只接受单个 PlayerId，数组会被 negated/impossible），
 *    封闭 opcode 表没有玩家集合枚举或按席位重复（同 sfd/the-papertree、ogn/whirlwind 的记录，
 *    ability-templates 的 target.player 未合入）。程序保留 "each-player" 描述性占位而不是只为自己
 *    结算（那会把印文改成“你弃/你抽”）。
 * 2. “When I move to a battlefield” 的载荷不可判定：events/action-adapter.ts 为 move-location
 *    生成的 object-moved 事件不填 toZone/toKind（timing-points.ts 声明的 payloadFields），
 *    已合入 events/pipeline-match.ts 也不读取卡程序 filter 里的内层 source 锚点（同
 *    sfd/corinna-veraza 记录，RIFT-120）。触发注册本身亦无生产接线（契约 3.5，RIFT-120）。
 * 3. choice.mode 的数据形状已按契约 3.9 写出，但 Finalize 侧的消费方（选择与重放请求路径）
 *    属引擎批 4；未合入时不得把模式选择近似成固定分支。
 * 已支持部分：两个模式体各自使用的 effect.discard / effect.draw 都是已合入原语；golden 用
 * 参考内核把每条模式体单独真实执行（单席位），逐玩家扇出与模式选择写 test.todo。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      // 421.1 / 449.1 / 449.2：Move 的封闭时点；"to a battlefield" 的目的地过滤见
      // judgeReason 第 2 点（object-moved 载荷未填 toZone）。
      at: "object-moved",
      filter: {
        event: "object-moved",
        toZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        // 355.3 / 契约 3.9：从印文的两项模式里选一个（count 1、different true），
        // 被选中的模式体在原位执行（不写 choice + linkedTo）。
        id: "minah-swiftfoot.choose-one",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "minah-swiftfoot.each-player-discards",
                body: [
                  {
                    id: "minah-swiftfoot.discard",
                    op: "effect.discard",
                    args: {
                      // “Each player discards 1”：423.1 的 Discard；player 值是
                      // 全体玩家集合的描述性占位（逐玩家扇出见 judgeReason 第 1 点）。
                      amount: { kind: "constant", value: 1 },
                      player: { kind: "constant", value: "each-player" },
                      choiceId: { kind: "constant", value: "minah-swiftfoot.discard-choice" }
                    }
                  }
                ]
              },
              {
                id: "minah-swiftfoot.each-player-draws",
                body: [
                  {
                    id: "minah-swiftfoot.draw",
                    op: "effect.draw",
                    args: {
                      // “Each player draws 1”：414.1/414.3 的 Draw；同样的逐玩家扇出缺口。
                      amount: { kind: "constant", value: 1 },
                      player: { kind: "constant", value: "each-player" }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-36cf830f15dc595f32cf4fbd561b4fda41ceeefd4c262f212067596def69e2cb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「Each player discards 1 / draws 1」是逐玩家迭代：已合入 IR 是单一 body + 单一 " +
    "ResolveContext（effect.discard/effect.draw 的 player 只接受单个 PlayerId，数组会 negated/impossible），封闭 opcode " +
    "表没有玩家集合枚举或按席位重复（同 the-papertree/whirlwind，ability-templates 的 target.player 未合入），" +
    "程序保留 \"each-player\" 描述性占位而不只为自己结算；(2)「When I move to a battlefield」的载荷不可判定：" +
    "events/action-adapter.ts 为 move-location 生成的 object-moved 事件不填 toZone/toKind（timing-points.ts 声明的 " +
    "payloadFields），已合入 events/pipeline-match.ts 也不读卡程序 filter 的内层 source 锚点，且没有把 CardProgram 的 " +
    "triggered 能力注册成 TriggerRegistration 的生产接线（RIFT-120）；(3) choice.mode 的 Finalize 消费方（模式选择与重放" +
    "请求路径）属引擎批 4，未合入前不得固定分支。已支持部分：两条模式体分别使用已合入的 effect.discard / effect.draw，" +
    "golden 用参考内核单席位真实执行；逐玩家扇出与模式选择写 test.todo。",
  abilities,
  sourceText:
    "When I move to a battlefield, choose one —\n" +
    "Each player discards 1.Each player draws 1."
} satisfies CardProgram;
