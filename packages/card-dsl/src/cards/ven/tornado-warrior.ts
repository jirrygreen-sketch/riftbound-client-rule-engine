import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tornado Warrior (ven-099-166) — Unit, Chaos, tags Yordle/Bandle City.
 * 3 Energy, no printed Power（`power: null`，不是 0），Might 3。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-099-166，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   When you play me from face down, you may empower something here. Disempower it at end of turn.
 *
 * 规则依据（Core Rules v1.5）：
 * - 811：​[Hidden] 是 Hide 自由行动的前提关键词；卡只声明关键词身份，展开属
 *   effects/keywords/Hidden.ts。
 * - 383.4.a / 383.4.a.2：“When you play me …” 是 Play Effect（时点 card-played），
 *   在打出完成、永久物进场后作为 Pending Item 入链；420.4.a 给出同一时点。
 * - 383.3.a / 383.3.a.1：效果首部的 “you may” 是触发能力的执行决定，同时按契约 3.9 把被选
 *   指令包进 choice.optional 的 body（不写 choice + linkedTo）。
 * - 442.1 / 442.2：“empower something here” 把本战场（053.3 的 here → sameLocationAs 宿主）
 *   上一个 Game Object 变为 Empowered；来源自身不是目标（827.1.b.1 的同源口径）。
 *   “something” 是不限定类别的对象，所以过滤器只写 zone + sameLocationAs。
 * - 443.1 / 443.2 / 443.2.a：“Disempower it at end of turn” 是一条延迟效果：329 / 391.2 规定
 *   “at end of turn” 属 Delayed Ability（窗口为本回合，317.1.a 的 turn-end 时点结算）；
 *   Disempower 是 Limited Action（443.2.a），只能由游戏效果指示执行，“it” 指被 empower 的那个对象。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，四处缺口均不近似实现：
 * 1. [Hidden] 的 KeywordDef 已合入，但消费方缺失（Hidden.ts 记录 cost.hidden / cost.pay /
 *    effect.zone / continuous.timing 均未合入），Hide 行动与面朝下区域的免费打出许可无执行路径
 *    （RIFT-89/RIFT-91）。
 * 2. “from face down” 无法判定：355.9.a.3/107.3.e 的 Facedown Zone 不在 ObjectFilter 的 zone
 *    词汇里，card-played 时点的载荷也不携带打出前的区域（同 rad/agonys-embrace、sfd/edge-of-night
 *    的记录，RIFT-84）。程序用 details.fromFaceDown 明确声明该条件，宁可 fail-closed 也不把
 *    普通打出的牌算作面朝下打出。
 * 3. “Disempower it at end of turn” 是延迟能力：契约 3.6 的 ResolveContext 有
 *    registerDelayedTrigger，但 effects/instructions/ 下没有把延迟注册暴露给卡牌程序的指令原语
 *    （trigger.delayed 未注册），卡牌程序无法按 391.2 建立该窗口（RIFT-9/RIFT-89）。因此该半段
 *    保留有依据的 IR 形状（at/window/body），并链到 empower 的链接值以说明 “it” 的指代。
 * 4. “Empowered 对象收到 Disempower” 的状态前提也没有谓词：442.1.a 的二元状态不在
 *    ObjectSnapshot / Condition 里（effect.empower 文件头记录同一契约缺口，RIFT-87）。
 * 已支持部分：“empower something here” 用已合入的 effect.empower（choose + sameLocationAs
 * 过滤器）在参考内核里真实执行，见 golden 测试。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // “when you play me”（383.4.a）＋“from face down” 的打出前区域条件
      // （细节键见 judgeReason 第 2 点：合并载荷没有该字段，条件 fail-closed）。
      filter: {
        event: "card-played",
        filter: { source: "self" },
        details: { fromFaceDown: true }
      }
    },
    optional: true,
    body: [
      {
        id: "tornado-warrior.may-empower",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Empower something here?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "tornado-warrior.empower-something-here",
                // 442.1 的 Empower 动作；对象是“本战场上的某个东西”，取结算期选择
                // （choose 是 option 描述符，不是目标；355.10.d 的集合 + 结算期选择）。
                op: "effect.empower",
                args: {
                  objects: {
                    kind: "constant",
                    value: {
                      kind: "choose",
                      id: "tornado-warrior.choose-object-here",
                      filter: { zone: "board", sameLocationAs: "self" },
                      min: 1,
                      max: 1
                    }
                  },
                  linkKey: { kind: "constant", value: "empoweredObject" }
                }
              },
              {
                // “Disempower it at end of turn.”（391.2 / 443.2 / 317.1.a）：待注册的延迟
                // 触发；body 的 “it” 读上一条指令的链接值（effect.empower 的
                // <linkKey>.objects）。op/参数形状见 judgeReason 第 3 点。
                id: "tornado-warrior.disempower-at-end-of-turn",
                op: "trigger.delayed",
                linkedTo: "tornado-warrior.empower-something-here",
                args: {
                  at: { kind: "constant", value: "turn-end" },
                  window: { kind: "constant", value: "this-turn" },
                  body: {
                    kind: "constant",
                    value: [
                      {
                        id: "tornado-warrior.disempower-it",
                        op: "effect.empower",
                        args: {
                          // “it” 指被 empower 的那个对象；链接值在延迟能力注册时锁定。
                          objects: {
                            kind: "linked",
                            instructionId: "tornado-warrior.empower-something-here",
                            key: "empoweredObject.objects"
                          },
                          mode: { kind: "constant", value: "disempower" }
                        }
                      }
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-43f2c7b5027f6a69b6596f2643e18187e455c358ab23449967a934abe533e617",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) [Hidden] 的 KeywordDef 已合入但没有消费方——Hidden.ts 记录 cost.hidden / " +
    "cost.pay / effect.zone / continuous.timing 均未合入，Hide 行动与面朝下区域的免费打出许可无执行路径（RIFT-89/RIFT-91）；" +
    "(2)「play me from face down」无法判定：355.9.a.3/107.3.e 的 Facedown Zone 不在 ObjectFilter 的 zone 词汇里，" +
    "card-played 载荷也不携带打出前区域（RIFT-84），程序用 details.fromFaceDown 声明该条件并 fail-closed；" +
    "(3)「Disempower it at end of turn」是 391.2 的延迟能力（窗口 this turn，317.1.a 的 turn-end 结算），" +
    "但 effects/instructions/ 下没有把 ResolveContext.registerDelayedTrigger 暴露给卡牌程序的指令原语，" +
    "trigger.delayed 未注册（RIFT-9/RIFT-89）；" +
    "(4) 442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 里，Disempower 的状态前提没有谓词（RIFT-87）。" +
    "已支持部分：「empower something here」用已合入的 effect.empower（choose + sameLocationAs）在 golden 中真实执行。" +
    "依赖：RIFT-84（Hidden/facedown）、RIFT-89（延迟注册/费用）、RIFT-87（状态谓词）、RIFT-91（图层接线）。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me from face down, you may empower something here. Disempower it at end of turn."
} satisfies CardProgram;
