import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Fizz, Trickster (sfd-140-221) — Unit, Chaos, Yordle/Fizz/Bilgewater/Champion.
 * energy 3, power 1, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-140-221，逐字）:
 *   "When you play me, you may play a spell from your trash with Energy cost no more than :rb_energy_3:,
 *    ignoring its Energy cost. Recycle that spell after you play it. (You must still pay its Power cost.)"
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：383.4.a / 383.4.a.1 的 Play Effect（420.4.a），时点 card-played，filter 用
 *   内层锚点 source: "self" 指称本卡（已合入 sfd/sandshifter、ogn/the-good-stuff 同型）。
 * - "you may …"（403.1、契约 3.9）：被选指令包进 choice.optional 的 body，不用 choice + linkedTo。
 * - "play a spell from your trash"：420.3 的游戏效果 Play；trash 是 Public Zone（108.2.d），
 *   要玩家选出的牌是目标（355.7/355.9.a/355.10.a）——与已合入 sfd/glasc-mixologist 的
 *   "play a unit … from your trash" 同一形状（更换 type 为 spell）。
 * - "ignoring its Energy cost"：356.1.b.2 只把基础 Energy 费置零、保留 Power 费；
 *   cost.buildCostPlan / cost.pay 已能执行该计划，但 effect.play 只接受调用方已经
 *   finalize 的费用覆盖，当前 CardProgram 绑定没有把所选对象的印刷费用接到该计划。
 * - "with Energy cost no more than [3]"：356.1.c / 206 说明这是对印刷 Base Cost 的上限比较；
 *   冻结的 ObjectFilter 没有费用谓词，也没有消费者读取（见 judgeReason）。
 * - "Recycle that spell after you play it"：417.1 / 417.1.c 的回收，目标是刚被打出的那张牌；
 *   程序用一条独立的 effect.recycle（linkedTo 打出指令，读 link 的对象）保留形状。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 印刷费用上限（"no more than [3]"）没有可求值形态：冻结 ObjectFilter 无费用谓词，
 *   layers/filter.ts 与测试内核的 matchesFilter 对未知键静默放行，而生产绑定
 *   programs/filters.ts 的 translateObjectFilter 对 costEnergyLte 这类描述性键直接 fail closed
 *   （judge-required）——两种行为都不是费用上限本身（见 glasc-mixologist 同款缺口）。
 * - "ignoring its Energy cost" 需要把被选中的垃圾场法术读入 cost.buildCostPlan 的
 *   ignore-base 计划（Base Energy 置 0、保留 Power）；effect.play 只消费已 finalize 的计划、
 *   从不推导印刷费用，当前 CardProgram → 选中对象 → 费用计划接线不存在。
 * - "Recycle that spell after you play it" 的 it 指刚打出的法术：契约 3.6 的 ObjectSelector 只有
 *   self/source/target/pick/linked，没有"刚打出的对象"选择符；已合入的 effect.play 只链接"成功打出
 *   张数"（linkKey → number），不落对象引用，因此后一条 effect.recycle 无法命名它。
 * 已合入并真实执行：choice.optional 的接受/拒绝、effect.play 对锁定目标 + 调用方零费计划的执行、
 * effect.recycle 的回收与 stale 目标 ignored（见 golden）。card-played → 触发注册路径
 * （RIFT-257 的 createProgramBinding / attachProgramLifecycle 与 source: "self" 映射）已合入，
 * 但整卡在 ProgramRegistry 中因 judge-required 被拒绝，不能据此声称可执行。
 * 依赖：RIFT-90（目标过滤的印刷费用谓词或契约变更）、所选对象到 ignore-base 费用计划的
 * 生产接线，以及“本次打出的对象”选择符（见回复里的契约变更请求）。
 * 不近似实现：不省略费用上限，也不用"回收垃圾场任意法术"代替"回收刚打出的那张"。
 */
const TRASH_TARGET = "fizz-trickster.spell-in-trash";

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "fizz-trickster.may-play",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Play a spell from your trash with Energy cost 3 or less, ignoring its Energy cost?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "fizz-trickster.play-spell",
                op: "effect.play",
                args: {
                  target: { kind: "constant", value: TRASH_TARGET },
                  // 420.3 / 355.2：效果未指定打出地点，按通常的打出流程处理，故不写 location。
                  // 356.1.b.2 的 ignore-Energy 需要费用管线生成 plan；卡层不伪造零费计划。
                  linkKey: { kind: "constant", value: "played" }
                }
              },
              {
                id: "fizz-trickster.recycle-played",
                op: "effect.recycle",
                linkedTo: "fizz-trickster.play-spell",
                args: {
                  // "that spell" = 刚打出的那张；effect.play 只链接张数（played → number），
                  // 没有对象引用可读，故此处的 linked 选择符是形状保留（见 judgeReason）。
                  objects: {
                    kind: "linked-value",
                    instructionId: "fizz-trickster.play-spell",
                    key: "played"
                  },
                  linkKey: { kind: "constant", value: "recycled" }
                }
              }
            ]
          }
        },
        targets: [
          {
            id: TRASH_TARGET,
            filter: {
              zone: "trash",
              type: "spell",
              owner: "controller",
              costEnergyLte: 3
            },
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
  canonicalCardId: "card.hash-2ec80d5a21eaf14b1c8f15f0a61f40ed1d29d8ff68bc87b3e69ce652dbfe74fd",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口：(1)「with Energy cost no more than :rb_energy_3:」（206 / 356.1.c）需要印刷费用上限谓词：" +
    "ObjectFilter 没有费用字段，生产绑定 translateObjectFilter 会拒绝 costEnergyLte，故当前 IR 只保留描述性记录（RIFT-90 或契约变更）。" +
    "(2)「ignoring its Energy cost」需要从被选中法术读印刷费用并按 356.1.b.2 生成 ignore-base finalized 计划" +
    "（Base Energy 置 0、仍付 Power）；effect.play 只接受调用方已 finalize 的计划，当前没有所选对象到费用计划的 CardProgram 接线。" +
    "(3)「Recycle that spell after you play it」的 it 指刚打出的法术：effect.play 只链接成功张数（played → number），" +
    "契约 3.6 的 ObjectSelector 无法命名「刚打出的对象」（契约变更请求）。" +
    "已合入并真实执行：choice.optional 接受/拒绝、effect.play（锁定目标 + 调用方零费计划）、effect.recycle 回收与 stale 目标 ignored；" +
    "card-played 触发注册与 source: \"self\" 映射已有真实执行证据。依赖：RIFT-90、所选对象费用计划接线与选择符契约变更。不近似实现。",
  abilities,
  sourceText:
    "When you play me, you may play a spell from your trash with Energy cost no more than :rb_energy_3:, " +
    "ignoring its Energy cost. Recycle that spell after you play it. (You must still pay its Power cost.)"
} satisfies CardProgram;

export default program;
