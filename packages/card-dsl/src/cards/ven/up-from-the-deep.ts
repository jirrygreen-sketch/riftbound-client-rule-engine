import type { CardProgram } from "../../ir/index.js";

/**
 * Up from the Deep（ven-100-166）— Spell，3 Energy，无印刷 Power，领域 Chaos。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-100-166，逐字）：
 *   "Play two 1 :rb_might: Tentacle unit tokens from Bilgewater.\n"
 *   "[Flow] :rb_energy_3: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - "Play two 1 :rb_might: Tentacle unit tokens from Bilgewater."：被"打出"的新 token 先在链上生成
 *   （440.2.c / 185.2.a：游戏动作可隐含创建区域；350.2 / 354 的打出流程接手），已合入的 effect.token
 *   以 mode: "play" 完成 create-on-chain + play 交接。token 定义是 CR 187.10 的
 *   "A 1 [M] Tentacle token is a domainless unit token with 1 Might and the Bilgewater tag"，
 *   即 effect.token 定义表里的 "tentacle"；185.3 让它的 energy/power 保持 null（不是 0）。
 *   控制者/拥有者是能力控制者（182 / 183 / 440.4）。
 * - 两个 token 各自的打出位置按 355.2 / 355.2.a 是该 token 打出的合法位置集合（默认：控制者的 Base 或
 *   其控制的战场）；每个 token 的位置在它自己的 Finalize 决定（355.2），不是本卡结算期的一次选择。
 * - [Flow]（829.1 / 829.1.b / 829.1.c）：被动关键词，功能等价于"可从废牌堆以其 Flow 费用打出，然后放逐"；
 *   印刷 Flow 费用为 :rb_energy_3:（3 Energy）。按 README 第 5 节只声明关键词身份，展开归 Flow.ts。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. 打出位置集合是动态的："from Bilgewater" 只是 token 的标签来源（187.10），不是目的地限制；
 *    但"控制者控制的战场"取决于打出时的战场控制状态，而 effect.token 的 locations 只接受具体
 *    LocationRef；没有已合入的生产方把"你控制的战场"集合解析成 LocationRef（ResolveContext 暴露的是
 *    对象查询，不是位置集合），也没有把 355.2 的 token 级位置选择接进 Finalize 的路径——与本仓
 *    ogs-015-024 Recruit the Vanguard 同一缺口。程序里的描述性 query 占位保留该意图，不硬编码某个战场。
 * 2. [Flow] 的展开依赖未合入：Flow.ts 记录 flow.cost 需要 RIFT-261 的替代费用消费方（选择 Flow 费用、
 *    记录实际支付的 Flow 实例），其替代放逐需要 RIFT-260 的 replacement 注册/排序路径；印刷 Flow 费用
 *    按契约 3.8.3 应经 KeywordDef.expand 的 params.cost 承载，但 KeywordAbility 无该字段（契约变更请求）。
 * 依赖：RIFT-9 target.location（位置集合读数）与 355.2 的打出位置选择接线、RIFT-260/261（Flow）。
 * token 定义、数量与 create-on-chain + play 交接均已合入，golden 用真实原语执行"打出到控制者 Base"
 * 半段（具体目的地由调用方给出，同 Recruit the Vanguard 的做法）。
 */
const upFromTheDeep = {
  canonicalCardId: "card.hash-27f697d8384808a5cf80e06751e46fc43cf1638403edee35321de02b26e3af2e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 两个 token 的打出目的地集合是动态的——「控制者控制的战场」取决于打出时的战场控制状态，" +
    "而 effect.token 的 locations 只接受具体 LocationRef；没有已合入的生产方把该集合解析成 LocationRef" +
    "（ResolveContext 只暴露对象查询，没有位置集合读数），也没有把 355.2 的 token 级打出位置选择接进 Finalize 的路径" +
    "（同 ogs-015-024 Recruit the Vanguard）。程序用描述性 query 占位，不硬编码某个战场、也不直接在场上创建来近似。" +
    "(2) [Flow]（829.1/829.1.c）的展开依赖未合入：flow.cost 需要 RIFT-261 的替代费用消费方、替代放逐需要 RIFT-260 的 replacement 路径；" +
    "印刷 Flow 费用（3 Energy）按契约 3.8.3 应经 params.cost 承载，而 KeywordAbility 无该字段（契约变更请求）。" +
    "依赖：RIFT-9 target.location 与 355.2 的打出位置接线、RIFT-260/261。token 定义（187.10）、数量与 create-on-chain + play 交接（440.2.c/185.2.a/350.2/354）" +
    "均已合入，golden 用真实原语执行「打出到控制者 Base」半段（具体目的地由调用方给出）。不近似实现。",
  abilities: [
    // 829.1.c：印刷 "[Flow] :rb_energy_3:"；费用本身归 Flow.ts 的展开（见 judgeReason 第 2 条）。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 3 Energy（power: null 表示无印刷 Power，不写成 0）。
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          id: "up-from-the-deep.play-tentacles",
          op: "effect.token",
          args: {
            // 187.10：1 Might、无域、Bilgewater 标签的 Tentacle 单位 token（energy/power 为 null，185.3）。
            token: { kind: "constant", value: "tentacle" },
            amount: { kind: "constant", value: 2 },
            // 440.2.c / 185.2.a / 350.2 / 354：新 token 在链上创建后交给打出流程。
            mode: { kind: "constant", value: "play" },
            // 355.2.a 的默认合法位置之一：控制者的 Base（具体战场集合见 judgeReason 第 1 条，
            // 描述性 query 只标记运行时供给方，绝不被当作具体 LocationRef 执行）。
            locations: {
              kind: "constant",
              value: [
                { type: "base", player: "controller" },
                { kind: "query", filter: { type: "battlefield", controller: "self" } }
              ]
            },
            choiceId: { kind: "constant", value: "up-from-the-deep.location" }
          }
        }
      ]
    }
  ],
  sourceText:
    "Play two 1 :rb_might: Tentacle unit tokens from Bilgewater.\n" +
    "[Flow] :rb_energy_3: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default upFromTheDeep;
