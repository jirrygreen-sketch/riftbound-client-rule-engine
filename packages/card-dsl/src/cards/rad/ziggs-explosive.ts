import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ziggs, Explosive (rad-112-167) — Unit, 4 Energy, Might 4, Chaos,
 * tags Bandle City/Ziggs/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-112-167，逐字）：
 *   ":rb_energy_1:, :rb_exhaust:: Play a Bomb gear token to a battlefield. (It
 *    has [Deploy]. When it dies, deal 2 to an enemy there and kill your other
 *    Bombs there.)
 *    When I defend, you may kill a friendly gear to give me +2 :rb_might: this
 *    turn."
 *
 * 规则依据（CR v1.5）：
 * - 145.1 / 145.2 / 376 / 377：":rb_energy_1:, :rb_exhaust::" 是启动能力的费用
 *   （1 能量 + 横置自身）；时机默认 Action（381：只在合适的玩家回合与 Open State
 *   可启动）。契约 3.1 的 activated 形状用 cost + body 表达，费用在 Finalize 校验。
 * - 187.12：Bomb gear token 是域无关装备 token，带 [Deploy] 与
 *   "[Deathknell][>] Deal 2 to an enemy there and kill your other Bombs there."；
 *   830.1 Deploy 允许打到任意战场（包括敌方占据/开放战场）。
 * - 440.2.c / 185.2.a / 350.2 / 354：被“打出”的新 token 先在链上生成，再由 play
 *   动作接手；185.3 费用为空。
 * - 383.4.f / 383.4.f.1："When I defend…" 是 Defense Trigger，时点 defense-declared。
 * - "you may kill a friendly gear to give me +2 [M] this turn" 是 355.10.c.1 的
 *   成本内指令：[do X]（kill a friendly gear）是成本，[do Y]（give me +2 Might）
 *   是效果；故用 choice.optional 包住 kill 指令，加 Might 指令 linkedTo 该 kill，
 *   使“未付出成本就不给 +2”成立（契约 §3.9：可选决定用一个 choice.optional 包住
 *   被选指令，链内依赖用 linkedTo 表达）。
 * - 143.2.a.1 / 475："give me +2 [M] this turn" 是算术图层的临时 Might 修改。

 * status = judge-required（README 第 2 节）。四处缺口，均不近似实现：
 * 1. Bomb gear token 定义（187.12，自带 Deploy 与 Deathknell 能力）不在已冻结的
 *    effect.token 定义表内；原语返回 blockedReason
 *    token-definition-or-abilities-judge-required。
 * 2. 「Play a Bomb gear token to a battlefield」需要链上生成 + 战场选择：效果侧的
 *    地点选择（355.10.b/355.10.c 的 "to a battlefield"）在 IR 里没有已合入的动态
 *    地点选择器（target.location 一族未合入）。
 * 3. Deploy 自身与 Bomb 的 Deathknell（"deal 2 to an enemy there and kill your
 *    other Bombs there"）都没有展开：Deploy 无 KeywordDef；Deatknell 展开只输出
 *    trigger.leave 骨架，"there" 的地点上一次已知信息与 "your other Bombs there"
 *    的集合消灭形态都未合入。
 * 4. "give me +2 [M] this turn" 需要临时 Might 修改（continuous.might，RIFT-91 未合入）；
 *    effect.buff 明确不含临时 Might，不能拿 Buff 计数器近似。
 * 已按已合入原语写出的部分：启动能力费用形状、choice.optional 包住 effect.kill
 * （目标为「友方装备」）与尾随的 continuous.might 指令；golden 测试真实执行
 * effect.kill 与 effect.token 的已支持路径，其余写 test.todo。
 * 依赖：RIFT-62/RIFT-63（token 与链上生成）、kw-deploy 与 Deathknell 展开
 * （RIFT-82 / RIFT-81~91）、RIFT-91（continuous.might）。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    cost: {
      energy: { kind: "constant", value: 1 },
      payments: [
        // 415.5 / 415.3.a：横置符号 = cost.exhaust（“Exhaust me”）。
        { kind: "exhaust" }
      ]
    },
    timing: "action",
    body: [
      {
        id: "ziggs.play-bomb-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bomb" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：新 token 的“打出”先在链上生成。
          mode: { kind: "constant", value: "play" },
          // 830.1.b：Deploy 允许打到任意战场；具体战场由打出流程在 Finalize 选定
          // （355.2.a/355.2.b，见 judgeReason 第 2 点）。
          locations: {
            kind: "constant",
            value: [{ type: "battlefield", id: "any-battlefield" }]
          },
          choiceId: { kind: "constant", value: "bomb-token-battlefield" },
          linkKey: { kind: "constant", value: "bombToken" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      filter: { event: "defense-declared", filter: { source: "self" } }
    },
    // 印刷为 "you may kill …" 的可选决定（见上方结构说明）。
    optional: false,
    body: [
      {
        id: "ziggs.may-kill-gear",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Kill a friendly gear for +2 Might?" },
          body: {
            kind: "constant",
            value: [
              {
                // 355.10.c.1 的成本部分：选中一件友方装备并消灭；目标选择在
                // Finalize 锁定（355.8），结算时重验（359.3.e）。
                id: "ziggs.kill-gear",
                op: "effect.kill",
                args: { target: { kind: "constant", value: "ziggs.friendly-gear" } },
                targets: [
                  {
                    id: "ziggs.friendly-gear",
                    filter: { type: "gear", controller: "controller" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              },
              {
                // 143.2.a.1 / 475：本回合 +2 Might 属算术图层；continuous.might 未
                // 合入（RIFT-91），此指令只保留印刷语义（见 judgeReason 第 4 点）。
                id: "ziggs.grant-plus-two",
                op: "continuous.might",
                linkedTo: "ziggs.kill-gear",
                args: {
                  amount: { kind: "constant", value: 2 },
                  duration: { kind: "constant", value: "this-turn" },
                  target: { kind: "constant", value: "self" }
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
  canonicalCardId: "card.hash-a4dcf84569e39376034bcb5b5816e3361ee7d9b6fd2439ec78f018cb3c3ec4d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) Bomb gear token 定义（187.12，自带 [Deploy] 与 " +
    "[Deathknell][>] Deal 2 to an enemy there and kill your other Bombs there）不在已冻结的 effect.token " +
    "定义表内，原语返回 blockedReason token-definition-or-abilities-judge-required；" +
    "(2) 「Play a Bomb gear token to a battlefield」还需要动态地点选择（355.2.a/355.2.b 的战场选项），" +
    "IR 里没有已合入的地点选择器（target.location 一族未合入）；" +
    "(3) Deploy 无 KeywordDef、Deathknell 展开只输出 trigger.leave 骨架，" +
    "「deal 2 to an enemy there and kill your other Bombs there」的 there 地点与集合消灭形态都未合入；" +
    "(4) 「give me +2 [M] this turn」是 Arithmetic 图层的临时 Might 修改（143.2.a.1/475），" +
    "continuous.might 未合入（RIFT-91），effect.buff 明确不含临时 Might，不拿 Buff 计数器近似。" +
    "已写出的可执行形状：启动能力费用（145.1/145.2/376/381）、choice.optional 包住 effect.kill（友方装备目标）" +
    "并让 +2 Might 指令 linkedTo 该成本（355.10.c.1）。" +
    "依赖：RIFT-62/RIFT-63（token 与链上生成）、RIFT-82（Deathknell 展开）、kw-deploy 展开、RIFT-91（continuous.might）。",
  abilities,
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Play a Bomb gear token to a battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
    "When I defend, you may kill a friendly gear to give me +2 :rb_might: this turn."
} satisfies CardProgram;

