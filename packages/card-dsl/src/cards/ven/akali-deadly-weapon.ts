import type { CardProgram } from "../../ir/index.js";

/**
 * Akali, Deadly Weapon (ven-021-166) — Unit, 3 Energy（无印刷 Power），3 Might,
 * Fury, Ionia/Akali/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-021-166，逐字）：
 *   [Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me.
 *   Use only if not Empowered.)
 *   When I move, you may deal 1 to a unit at a battlefield I moved to or from.
 *   If I'm [Empowered], deal 2 instead.
 *   [Empowered][>] I have +1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是 Activated Ability 关键词，功能等价于
 *   “[2 Energy + 1 Fury Power]：Empower me。仅当未 Empowered 时启动。”按契约 3.7 卡牌只
 *   声明 `{ kind: "keyword", keyword: "empower" }`；印刷费用记录在注释与 judgeReason 里
 *   （KeywordAbility 没有 params 字段，见 RIFT-238 已记录的契约变更请求）。
 * - 421.1 / 449.1 / 449.2 / 458.1：“When I move” 是一次成功 Move 的触发，观察时点是封闭
 *   时点 "object-moved"；458/458.1 规定 Recall 不是 Move、不触发移动类触发。
 * - 383.3.a / 契约 3.9："you may deal 1 …" 是效果正文里的可选决定，把被选的指令包进
 *   `choice.optional` 的 body（不写成 choice + linkedTo 串联）。
 * - 418.1.b/418.1.c："deal 1"="deal 2" 是同一个 Deal 动作的数额替换；"If I'm
 *   [Empowered], deal 2 instead" 以宿主 Empowered 状态为准（442.1.a 的二元状态）。
 * - 355.9.a.1 / 355.9.b / 355.10："a unit at a battlefield I moved to or from" 是控制者选择
 *   的一个对象（未特别说明时 "unit" 指 Board 上的单位），"at a battlefield" 与“我移动到的/
 *   出发的那个战场”都是目标限制，不额外产生目标。
 * - 828.1.a/828.1.b.1：[Empowered][>] 是 Dependent Keyword，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”，本条为静态 +1 Might（479 的算术图层）。
 *
 * status = judge-required（四处缺口均不近似实现）：
 * 1. 没有 Empower / Empowered 的 KeywordDef（keywords/registry.generated.ts 没有它们），
 *    827.1.c.1 的启动费用与“仅当未 Empowered 时”限制无法展开；
 * 2. Empowered 状态不在 ObjectSnapshot / Condition 里（442.1.a），828.1.b.1 的依赖能力门槛
 *    与“If I'm Empowered, deal 2 instead”都无法求值；
 * 3. 移动触发缺可判定载荷：events/action-adapter.ts 为 move-location 发出的 object-moved
 *    事件不带 toZone/toKind/起点终点，事件对象与“来源 = 本卡”的同一性也没有卡牌侧绑定
 *    （同 sfd/noxian-drummer 的判定），因此“我移动到的或出发的那个战场”无法作为目标锚点；
 * 4. “give me +1 [M]” 需要卡牌侧 continuous.might 静态效果的注册/求值入口（RIFT-91 只合入了
 *    图层引擎；契约 3.6 的封闭 GameAction 集合没有 Might 修改动作）。
 * 可执行部分："you may" 的 choice.optional 拒绝分支真实执行（实测 negated/skipped）；
 * 数额读取用描述性 object-property（结算时读不到该特征即按缺信息 ignored，fail-closed），
 * 绝不写死 1 或 2 冒充 Empowered 分支。
 */
export default {
  canonicalCardId: "card.hash-7b24e8fb2cf27a115102e669fe4fd9219a98b10d2411cc5caf4bb1826db5e3c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“2 Energy + 1 Fury Power：Empower me，仅当未 Empowered 时启动”无法展开；" +
    "(2) Empowered 状态（442.1.a）不在 ObjectSnapshot / Condition 里，828.1.b.1 的依赖能力门槛与" +
    "正文的“If I'm [Empowered], deal 2 instead”都没有可求值谓词，因此本程序的伤害数额用描述性 " +
    "object-property 读取（读不到即按缺信息 ignored，fail-closed），绝不写死 1 或 2 冒充分支；" +
    "(3) “When I move” 缺可判定载荷：move-location 发出的 object-moved 事件不带起点/终点" +
    "（449.1/449.2、458.1 的 Recall 排除与“我移动到的或出发的战场”锚点都无从判定，" +
    "同 sfd/noxian-drummer 的结论）；(4) “I have +1 :rb_might:” 需要卡牌侧 continuous.might 与图层" +
    "注册入口（RIFT-91 只合入了图层引擎）。依赖：新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）、" +
    "RIFT-91（layers 接线）与 RIFT-120（移动时点载荷）。“you may” 的 choice.optional 拒绝分支已可真实执行。" +
    "不近似实现。",
  abilities: [
    // 印刷费 2 Energy + 1 Fury Power（827.1.c.1）见 judgeReason；不伪造启动能力。
    { kind: "keyword", keyword: "empower" },
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: { event: "object-moved", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          // 383.3.a / 契约 3.9：“you may deal …” 把被选指令包进 body。
          id: "akali.may-deal-damage",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Deal damage to a unit at a battlefield I moved to or from?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "akali.deal-damage-at-moved-battlefield",
                  op: "effect.damage",
                  args: {
                    // “deal 1 … If I'm Empowered, deal 2 instead”：数额取决于宿主 Empowered
                    // 状态（442.1.a）。该谓词尚未合入（见 judgeReason 第 2 条），故不做成常量、
                    // 不用某个固定数额充当分支结果；结算时读不到该特征即按缺信息 ignored。
                    amount: {
                      kind: "object-property",
                      object: "source",
                      property: "empoweredReplacementDamage"
                    },
                    target: {
                      kind: "constant",
                      value: "akali.unit-at-moved-battlefield"
                    }
                  },
                  targets: [
                    {
                      id: "akali.unit-at-moved-battlefield",
                      // “a unit at a battlefield”：实际战场必须是我这次移动的起点或终点。
                      // 该锚点依赖移动时点的起点/终点载荷（449.1/449.2），描述性键
                      // movedToOrFrom 记录待接线的限制（见 judgeReason 第 3 条）。
                      filter: {
                        type: "unit",
                        zone: "board",
                        location: "battlefield",
                        movedToOrFrom: "self"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    },
    {
      // [Empowered][>] I have +1 :rb_might:（828.1.b.1 的依赖能力 + 479 算术图层）。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        appliesTo: "self"
      },
      // 828.1.c：依赖能力仅在宿主拥有 Empowered 状态时生效。该门槛没有可求值的谓词，
      // 以描述性 expression 记录（同已合入的 applied-researchers / grumpy-rockbear）。
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "empowered" }
      }
    }
  ],
  sourceText:
    "[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)\n" +
    "When I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
