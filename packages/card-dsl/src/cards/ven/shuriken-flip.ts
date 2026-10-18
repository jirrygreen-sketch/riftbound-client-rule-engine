import type { CardProgram } from "../../ir/index.js";

/**
 * Shuriken Flip (ven-140-166) — Spell, 1 energy + 1 Fury/Calm power, tags Akali/Signature.
 * Might null（法术无印刷 Might；domains ["Fury", "Calm"] 是双领域印刷）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-140-166，逐字）:
 *   "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n"
 *   "[Flow] :rb_energy_3::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）：
 * - "Deal 2 to up to one enemy unit at a battlefield"：418 的 Deal 动作，来源是该法术自身
 *   （418.6.a，缺省 source），非战斗伤害（418.1.c）。"up to one" 允许选 0 个（355.13），
 *   因此 TargetSpec 为 min 0 / max 1 / selection "up-to"；被点名的单位是目标（355.7/355.9.a.1），
 *   "enemy" 用 controller: "opponent"，"at a battlefield" 是目标限制而非第二个目标（355.10.b），
 *   用已合入的 location: "battlefield" 表达（ogn/gust、sfd/arcane-shift 同写法）。
 * - "then move a friendly unit"：448-451 的效果 Move（非 144 的标准移动：无横置费用、
 *   无 Main Phase 门槛，451.1 由来源声明目的地限制）。原文没有印刷目的地，因此目的地按
 *   355.4/355.4.a 在结算时选一个合法 Location。被移动的友方单位是目标（355.7/355.9.a.1）。
 *   "then" 只是 158.1 的自上而下结算顺序；这句不引用伤害的结果对象，因此不写 linkedTo
 *   （README 第 4 节：独立语句不强行链接；否则「选择 0 个伤害目标」会让移动被
 *   linked-ignored 连坐，凭空发明条件）。
 * - [Flow]（829）同其他卡：只声明关键词身份，展开归 keywords/Flow.ts。
 *
 * status 判定（cards/README.md 第 2 节，持续复核 2026-10-18）：
 * judge-required。位置选择器批次合入后目的地已是可执行 IR：Expr kind "location" 的
 * { kind: "choose", id, filter } 由 interpreter/locations.ts 的 normalizeMoveArguments
 * 在 effect.move 参数边界解析，target/location/candidates.ts 提供候选。本任务 golden
 * 用真实解释器 + 参考内核执行完整 body：伤害半段与 Move 半段都执行
 * （up-to 的 0 选择、目标锁定与重验、实际位移、目的地候选集合均已断言）。
 * 仍缺的只有 [Flow] 的印刷费用：829.1.c 的 "[Flow] :rb_energy_3::rb_rune_rainbow:"
 * 需要把费用从卡牌侧传到 KeywordDef.expand 的 params.cost（契约 3.8.3），但
 * 契约 3.1 的 KeywordAbility 只有 keyword/value 字段，programs/keywords.ts 的
 * expandProgram 也只调用 def.expand({ value, host })；展开出的 flow.cost 没有进入
 * CostPlanInput.modifications 的消费方，且 829.1.b.1 排除法术自身指令离链的收据缺失。
 * 属共享契约变更请求（见最终回复），不在本卡近似实现。
 */
const shurikenFlip = {
  canonicalCardId: "card.hash-eead7ad848e8aa64f2ca544f7174c4bc3764b8eb661c26cfd050804e8ce278e5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一当前缺口是 [Flow] 的印刷费用不可达（持续复核 2026-10-18；不近似实现）：" +
    "829.1.c 的 3 Energy + 1 rainbow rune 需要经契约 3.8.3 的 params.cost 进入 KeywordDef.expand，" +
    "但契约 3.1 的 KeywordAbility 只有 keyword/value，programs/keywords.ts 的 expandProgram 只调用 " +
    "def.expand({ value, host })；展开出的 flow.cost 也没有进入 CostPlanInput.modifications 的消费方，" +
    "829.1.b.1 的「排除法术自身指令造成的离链」收据同样缺失，属共享契约变更请求。" +
    "已合入且有真实执行证据：已合入的 LocationExpr（Expr kind \"location\" + symbolic choose）经 " +
    "interpreter/locations.ts 与 target/location/candidates.ts 解析成合法目的地；golden 用真实解释器 + " +
    "参考内核执行完整 body（up-to 0/1 选择、目标锁定与重验、实际位移、候选集合）；" +
    "目标 Finalize/Resolve 缓存面与 effect.damage（418.1.c/418.6.a）也都已执行；" +
    "本卡不再保留不可执行的占位形状。",
  abilities: [
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // "Deal 2 to up to one enemy unit at a battlefield"：up to one 可为零（355.13）。
          id: "shuriken-flip.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "shuriken-flip.enemy-unit" }
          },
          targets: [
            {
              id: "shuriken-flip.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent", location: "battlefield" },
              min: 0,
              max: 1,
              selection: "up-to"
            }
          ]
        },
        {
          // "then move a friendly unit"（158.1 的顺序，非结果引用）。原文没有印刷目的地，
          // 按 355.4/355.4.a/451.1 在结算时选一个合法 Location：已合入的
          // LocationExpr 运行期选择（kind "location" 携带 symbolic choose），不是描述性标记。
          id: "shuriken-flip.move-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "shuriken-flip.friendly-unit" } },
            to: {
              kind: "location",
              value: {
                kind: "choose",
                id: "shuriken-flip.destination",
                filter: { type: "any" }
              }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "shuriken-flip.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "self" },
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
    "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n" +
    "[Flow] :rb_energy_3::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default shurikenFlip;
