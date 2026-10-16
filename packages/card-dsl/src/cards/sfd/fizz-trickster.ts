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
 *   effect.play 只接受已 finalize 的费用计划、从不推导印刷费用（RIFT-89 的费用计划接线缺失）。
 * - "with Energy cost no more than [3]"：356.1.c / 206 说明这是对印刷 Base Cost 的上限比较；
 *   冻结的 ObjectFilter 没有费用谓词，也没有消费者读取（见 judgeReason）。
 * - "Recycle that spell after you play it"：417.1 / 417.1.c 的回收，目标是刚被打出的那张牌；
 *   程序用一条独立的 effect.recycle（linkedTo 打出指令，读 link 的对象）保留形状。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 印刷费用上限（"no more than [3]"）没有可求值形态：冻结 ObjectFilter 无费用谓词，
 *   layers/filter.ts 与测试内核的 matchesFilter 都会静默忽略未知键（见 glasc-mixologist 同款缺口），
 *   写成过滤器会让任意垃圾场法术合法。
 * - "ignoring its Energy cost" 需要费用管线按 356.1.b.2 生成 finalized plan（Base Energy 置 0、
 *   保留 Power）；effect.play 只消费已 finalize 的计划，卡程序无法生成（RIFT-89）。
 * - "Recycle that spell after you play it" 的 it 指刚打出的法术：契约 3.6 的 ObjectSelector 只有
 *   self/source/target/pick/linked，没有"刚打出的对象"选择符；已合入的 effect.play 只链接"成功打出
 *   张数"（linkKey → number），不落对象引用，因此后一条 effect.recycle 无法命名它。
 * - card-played 触发的卡牌注册与内层锚点消费方属 RIFT-120。
 * 依赖：RIFT-89（费用计划与 ignore-Energy 接线、印刷费用上限比较）、RIFT-120（触发注册）、
 * "本次打出的对象"选择符（见回复里的契约变更请求）。
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
    "(1)「with Energy cost no more than :rb_energy_3:」需要印刷 Base Cost 上限比较（356.1.c / 206）：冻结的 ObjectFilter 没有费用谓词、" +
    "也没有消费者读取，写成过滤器（程序里的 costEnergyLte）会让任意垃圾场法术合法（与 sfd/glasc-mixologist 同一缺口）。" +
    "(2)「ignoring its Energy cost」要按 356.1.b.2 生成 finalized 费用计划（Base Energy 置 0、仍付 Power），" +
    "effect.play 只接受已 finalize 的计划、从不推导印刷费用（RIFT-89）。" +
    "(3)「Recycle that spell after you play it」的 it 指刚被打出的法术：契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，" +
    "没有「本次打出的对象」，而 effect.play 只链接成功张数（played → number）、不落对象引用，后一条 effect.recycle 无法命名该牌。" +
    "(4) card-played 触发的 CardProgram → TriggerRegistration 注册与 filter 内层锚点 source: \"self\" 的消费方属 RIFT-120。" +
    "effect.play / effect.recycle / choice.optional 均已合入，golden 对已锁定目标真实执行（另见 test.todo）。" +
    "依赖：RIFT-89、RIFT-120、「本次打出的对象」选择符（见回复里的契约变更请求）。不近似实现。",
  abilities,
  sourceText:
    "When you play me, you may play a spell from your trash with Energy cost no more than :rb_energy_3:, " +
    "ignoring its Energy cost. Recycle that spell after you play it. (You must still pay its Power cost.)"
} satisfies CardProgram;

export default program;
