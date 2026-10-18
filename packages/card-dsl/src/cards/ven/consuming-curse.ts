import type { CardProgram } from "../../ir/index.js";

/**
 * Consuming Curse（ven-010-166）— Spell，2 能量、无印刷力量，领域 Fury，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-010-166，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\nDeal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash."
 *
 * 规则依据（Core Rules v1.5）：
 * - 「[Action]」是 806 的许可类关键词，卡文件只声明（展开归 keywords/Action.ts，契约 3.7）。
 * - 「Deal 2 to a unit at a battlefield」是 Deal 指令加目标限制（418.1、355.9.a.1、355.9.b、
 *   355.10.b：战场只是单位的限制，不成为目标）。来源缺省为法术本身（418.6.a）。
 * - 「This deals 1 Bonus Damage for each card with this name in your trash」是 418.4/418.5/713
 *   的 Bonus Damage 授予，数额按 132.1/132.3 的牌名计数：本卡在结算时按“控制者的 trash 中
 *   与本卡同名（Consuming Curse）的牌数 × 1”授予本次 Deal 动作（714 求和、715.1 单目标施加）。
 *   台账的 canonicalCardId 在本卡池里是 1:1（1080 个牌名 : 1080 个 canonical，无同名多 canonical），
 *   但 132.3 明确不同语言/印次视为同一牌名，所以语料级同名身份不能用 canonicalCardId 冒充。
 * - 已合入的 effect.damage 有 bonus 参数（714/715.2 的加总与施加）：按契约由“调用方传入的
 *   授予表达式”，原语自己不做授予（其文件头把这部分归持续效果/图层）。本卡就是那个调用方，
 *   按 132 的牌名计数写出 bonus 表达式。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：旧 judgeReason 的三条依赖均已落地——
 * (1) 牌名计数可按 132 的牌名而不是 canonicalCardId 表达：layers/filter.ts 的
 * characteristics 谓词按 ObjectSnapshot 的真实字段比较，`characteristics: { name }`
 * 命中 132.1 的牌名（132.3 的同名跨印次/语言由同一个 name 值覆盖，不经过 cardId）；
 * (2) bonus 的消费方就是 effect.damage 自己的 bonus 参数（714 加总 / 715.1 单目标施加），
 * 本卡作为调用方直接给出计数表达式，不需要额外的图层注册；
 * (3) 卡牌程序 → 链的接线已由 programs/play.ts 的 describePlay + keywords/Action.ts 完成。
 * “在 trash 里”用 zone "trash" + owner "self"（190.6.d 的隐含 "you"）限定，本卡结算时
 * 自己在 Chain 上、不在 trash 里，故不存在把自身计入的排除语义需求。
 *
 * status = executable：整卡能力都有 v1.5 依据，并由真实 ProgramBinding + ChainEngine +
 * EventPipeline 执行验证（含 2 + N 的实际伤害与 715.4 的无伤害边界）。
 */
export default {
  canonicalCardId: "card.hash-eccd412b01dd63e0ce45a6b2789921b93b875f0321bcb6cea756edf8d23c9a71",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // 印刷基础费用：2 能量；catalog power 为 null（无印刷力量），不改写为 0。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // 「Deal 2 to a unit at a battlefield」：基准 2 点（418.1）+ 418.4/713 的 Bonus Damage。
          id: "consuming-curse.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            // 418.4 / 418.5 / 713 / 714 / 715.1：“1 Bonus Damage for each card with this
            // name in your trash” = 控制者 trash 中牌名为 “Consuming Curse” 的牌数 × 1。
            // 132.1 / 132.3：按 CR 132 的牌名计数（同名跨印次/语言同值），因此用
            // characteristics.name（layers/filter.ts 按 ObjectSnapshot 的真实字段比较）
            // 而不是 canonicalCardId。结算时本卡已在 Chain 上而不在 trash，故计数天然
            // 不含自身，不需要额外的排除语义。
            bonus: {
              kind: "count",
              subject: "objects",
              filter: {
                zone: "trash",
                owner: "self",
                characteristics: { name: "Consuming Curse" }
              }
            },
            target: { kind: "constant", value: "consuming-curse.battlefield-unit" }
          },
          targets: [
            {
              id: "consuming-curse.battlefield-unit",
              filter: { type: "unit", location: "battlefield", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash."
} satisfies CardProgram;
