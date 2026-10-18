import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Iterative Design (ven-051-166) — Spell, 4 energy, no printed Power/Might, domain Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-051-166，逐字）：
 *   "Play a 3 :rb_might: Mech unit token.\n[Flow] :rb_energy_2::rb_rune_mind: " +
 *   "(You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - "Play a 3 :rb_might: Mech unit token."：187.4 定义的 3 Might Mech 单位 token；
 *   440.2.c / 185.2.a 规定“被打出”的新 token 先在链上生成，再由 play 动作接手完成
 *   打出流程（350.2 / 354）。effect.token 的 DEFINITIONS 含 "mech"
 *   （might 3 / tags ["Mech"] / energy null / power null），与印刷一致。
 *   原文没有指定落点，因此按 355.2 / 355.2.a 的常规打出流程在 Finalize 选择位置
 *   （单位默认可打到控制者基地或其控制的战场）；卡侧不写死 LocationRef，也不把
 *   "here"/"to your base" 之类不存在的限定补进去。已合入的 effect.token 要求“恰好一个
 *   目的地参数”，而“落点由常规打出流程在 Finalize 决定”这一形态没有可写参数，因此本
 *   指令在真实原语下 fail-closed（argsSchema 直接抛错），不会把 token 落到错误地点。
 * - "[Flow] :rb_energy_2::rb_rune_mind:"：829.1 / 829.1.b 的功能文本是“你可以从垃圾场
 *   以其 Flow 费用打出此牌，然后放逐它”；829.1.c 的格式为 "Flow [Cost]"，
 *   829.1.c.1 明确它是替换基础费用的 alternate cost，829.1.c.2 允许费用同时包含资源与
 *   非资源部分（此处 2 Energy + 1 Mind Power）。卡侧只声明 keyword（契约 3.7、
 *   README 第 5 节），展开由 effects/keywords/Flow.ts 负责。
 *   KeywordDef.expand 的接口已经支持可选 params.cost，Flow.ts 也会读取 input.params.cost；
 *   但 CardProgram 的 KeywordAbility 仍只有 keyword/value，且 programs/keywords.ts 的
 *   expandProgram 只传 value/host，不把卡牌侧的印刷费用转发到 params.cost，因此费用仍只
 *   记录在注释与 judgeReason，不写 value、也不伪造第二条普通费用。
 *
 * status = judge-required（缺口均不近似实现）：
 * 复核（2026-10-17，RIFT-613 第三轮 M2 覆盖率复核，实测见 test.mjs 的 probe 用例）：
 * 1. effect.token 的落点形态仍不可写：生产原语的 argsSchema 要求“恰好一个目的地参数”
 *    （location/target/pick/locations），实测不带目的地的 args 被直接拒绝（TypeError
 *    "effect.token requires exactly one destination argument"）。"Play a 3 Might Mech unit
 *    token." 没有落点限定，落点应由 355.2/355.2.a 的常规打出流程在 Finalize 决定，
 *    当前契约没有该形态；本指令因此在真实原语下 fail-closed，不会落到错误地点。
 * 2. Flow 的替代费用与延迟放逐缺消费方：effects/keywords/Flow.ts 的 expand 已合入
 *    （输出 flow.cost 静态 + object-leaves-chain replacement），但实测 flow.cost 静态在
 *    programs/statics.ts 被拒（"Static ability kind flow.cost has no layer mapping"），
 *    object-leaves-chain 的 replacement body 在 replacement/planner.ts 被拒
 *    （BlockedReplacementError "Unsupported replacement opcode: effect.banish"）；
 *    cost/cost-plan.ts 虽有 kind "flow" 的 base modification，但没有调用方把 flow.cost
 *    送进去，829.1.b.1 的 leavingInstruction 标记也没有消费方。
 * 3. 已支持部分：effect.token 的 187.4 Mech 定义与链上创建 + 打出路径由 golden 用
 *    解释器 + 参考内核真实执行；生产链对已创建 token 的 play 因缺少卡牌程序适配器而失败
 *    （routeAction 要求 describePlay，token 没有 cardId）。
 * 契约变更请求：effect.token 的“落点由常规打出流程决定”形态 + CardProgram
 * KeywordAbility 的印刷费用参数承载（829.1.c.2 的 2 Energy + 1 Mind Power）。
 */
const abilities = [
  // 829.1.c：格式为 "Flow [Cost]"；印刷费用 2 Energy + 1 Mind Power 记录在注释与
  // judgeReason（KeywordAbility 没有标准化的印刷费用参数字段，见文件头）。
  { kind: "keyword", keyword: "flow" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 4 }
    },
    body: [
      {
        // "Play a 3 Might Mech unit token." — 187.4 的定型 token；440.2.c/185.2.a
        // 的链上创建 + play 接手。原文没有落点限定，位置由常规打出流程在
        // Finalize 决定（355.2/355.2.a），卡侧不写 location / target / pick。
        id: "iterative-design.play-mech-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          linkKey: { kind: "constant", value: "mechToken" }
        }
      }
    ]
  }
] as const satisfies readonly Ability[];

export default {
  canonicalCardId:
    "card.hash-8bbb12806c358b79644e7b09758a93f6352628f3333f245dd101bc444f171209",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现（2026-10-17 RIFT-613 复核实测）：(1)「Play a 3 Might Mech unit token」的 token 定义" +
    "（187.4 的 Mech：might 3 / tags [\"Mech\"]）虽已由参考内核真实执行，但落点形态不可写：生产原语的 argsSchema " +
    "要求\"恰好一个目的地参数\"（location/target/pick/locations），实测不带目的地的 args 被 " +
    "TypeError \"effect.token requires exactly one destination argument\" 拒绝；原文没有落点限定，位置应由 355.2/355.2.a " +
    "的常规打出流程在 Finalize 决定，当前契约没有该形态，本指令因此 fail-closed（契约变更请求）。(2) Flow 的替代费用、" +
    "垃圾场打出许可与 829.1.b.1 的延迟放逐缺消费方：Flow.ts 的 expand 已合入（输出 flow.cost 静态 + " +
    "object-leaves-chain replacement），但 flow.cost 静态在 programs/statics.ts 被拒（\"Static ability kind flow.cost " +
    "has no layer mapping\"），object-leaves-chain 的 body 在 replacement/planner.ts 被拒（BlockedReplacementError " +
    "\"Unsupported replacement opcode: effect.banish\"）；cost/cost-plan.ts 虽有 kind \"flow\" 的 base modification，" +
    "但没有调用方把 flow.cost 送进去，829.1.b.1 的 leavingInstruction 标记也没有消费方。印刷的 Flow 费用是 " +
    "2 Energy + 1 Mind Power（829.1.c.2），KeywordDef.expand 已支持 params.cost，但 KeywordAbility 仍只有 keyword/value、" +
    "expandProgram 只传 value/host，故不写 value、也不伪造第二条普通费用。已支持部分：effect.token 的 Mech 定义" +
    "（might 3 / tags [\"Mech\"]）与链上创建 + 打出由 golden 真实执行；生产链对已创建 token 的 play" +
    "（440.2.c / 185.2.a / 350.2 / 354）因 routeAction 缺少绑定的卡牌程序适配器（describePlay）失败。",
  abilities,
  sourceText:
    "Play a 3 :rb_might: Mech unit token.\n[Flow] :rb_energy_2::rb_rune_mind: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
