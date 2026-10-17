import type { CardProgram } from "../../ir/index.js";

/**
 * Ravenbloom Conservatory (sfd-215-221) — Battlefield, Rumble precon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-215-221，逐字）:
 *   "When you defend here, reveal the top card of your Main Deck. If it's a
 *    spell, put it in your hand. Otherwise, recycle it."
 *
 * 规则依据（CR v1.5）:
 * - 383.4.f / 466.2："When you defend here" 是 Defend Effect——Battlefield 自身的
 *   触发式能力，订阅 defense-declared 时点（events/timing-points.ts，refs 466.2）。
 *   "here" 指本 Battlefield（053.3 的 here referent）。
 * - "reveal the top card of your Main Deck"：425.1/425.2.a 的 Reveal（牌留在主牌库，
 *   425.1.a.2），且是**牌库顶**的真子集——契约 3.6 要求按区域内真实顺序取，effect.reveal
 *   明确拒绝用 query 推断牌库顺序（"a subset of this zone requires upstream ordered picks;
 *   query order is not deck order"），因此必须经上游有序 picks 传入（同已合入的
 *   sfd/called-shot 的 "dynamic:main-deck-top-two" 写法）。
 * - "If it's a spell"：这是对**被展示的那张牌**的类型判断，不是玩家选择。Condition 的
 *   object-property 读取链接值里首个对象的 types 数组，operator "in" 判定左侧值是否属于
 *   右侧数组，因此 compare("spell" in types) 可直接表达该判别式（golden 有真实执行证据）；
 *   两个分支各写一条带 condition 的指令，不用 choice.mode（牌面没有玩家选择，且
 *   chain/engine.ts 的 assertFinalizationSurface 对 choice.mode 抛 ChainContractBlockedError）。
 * - "put it in your hand" 是 effect.zone 的 return-to-hand（056.1/056.2 归拥有者手牌）；
 *   "Otherwise, recycle it" 是 417.1/417.1.a/417.1.c 的 Recycle（回拥有者主牌库底）。
 *
 * status = judge-required（三处依赖未合入，均不近似实现）:
 * 1. defense-declared 没有产生方：combat/flow.ts 的战斗开始事务显式抛出
 *    TurnCombatBlockedError('combat-start-transaction')，时序审计
 *    （docs/rules/timing-point-producers.md）把 attack-declared/defense-declared 记为「待后续」。
 *    触发因此无法进入链（RIFT-124 的 combat 事务后续）。
 * 2. "here" 没有词汇：053.3 的 here referent 在 EventPattern / ObjectFilter 里不可表达，
 *    已合入的 trigger-spec 校验器拒绝 here 字段（EventPattern 只允许 event/type/kind、object、
 *    source、target、player、fromZone、toZone、amount、details），CardProgram 绑定
 *    （RIFT-257）对未知过滤器字段 fail-closed 拒绝；本卡是 Battlefield 自身的能力，
 *    过滤器需要「事件发生在本战场」而静态程序无法知道运行时 battlefield id。
 * 3. effect.reveal 的 pick 参数在契约与已合入运行时之间不一致：IR 校验器要求 args 的每个
 *    值都是 Expr（写 { kind: "constant", value: id }），而 chain/interpreter-adapter.ts 的
 *    LITERAL_FIELDS 没有声明 effect.reveal 的 pick 解包，Expr 包裹会原样传给原语，
 *    原语因此只接受裸字符串 id ——
 *    实测：Expr 拼写通过 validateCardProgram 但在 produce 路径抛
 *    "effect.reveal: pick must be a non-empty id"，裸字符串则在 validateCardProgram 被拒
 *    （invalid-expression）。该不一致属引擎/契约侧修复（见最终回复的契约变更请求），
 *    卡内保持 Expr 拼写（契约 3.2 要求）并把真实执行测试的 reveal 半段改为直接驱动原语。
 * golden 用解释器 + 参考内核真实执行正文的 reveal 与两个分支（spell → hand、否则 recycle），
 * 因此判别式本身不再是缺口；整卡仍因上述两点保持 judge-required。
 */
export default {
  canonicalCardId: "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现。(1) defense-declared 没有产生方：combat/flow.ts 的战斗开始事务显式抛出 " +
    "TurnCombatBlockedError('combat-start-transaction')，时序审计（docs/rules/timing-point-producers.md）把 " +
    "attack-declared/defense-declared 记为「待后续」，触发因此进不了链（RIFT-124 的 combat 事务后续）。" +
    "(2) \"here\"（053.3）在 EventPattern / ObjectFilter 里不可表达：已合入的 trigger-spec 校验器拒绝 here 字段" +
    "（EventPattern 只允许 event/type/kind、object、source、target、player、fromZone、toZone、amount、details），" +
    "CardProgram 绑定（RIFT-257）对未知过滤器字段 fail-closed 拒绝；本卡是 Battlefield 自身的能力，过滤器需要" +
    "「事件发生在本战场」，而静态程序无法知道运行时 battlefield id。" +
    "(3) effect.reveal 的 pick 在契约与已合入运行时之间不一致：IR 校验器要求 args 的值都是 Expr，" +
    "而 chain/interpreter-adapter.ts 的 LITERAL_FIELDS 没有声明 effect.reveal 的 pick 解包，" +
    "Expr 包裹原样传给原语，原语只接受裸字符串 id；" +
    "实测 Expr 拼写通过 validateCardProgram 但在链上抛「effect.reveal: pick must be a non-empty id」，裸字符串则在校验器被拒" +
    "（按契约 3.2 保持 Expr 拼写，缺口登录在最终回复的契约变更请求）。" +
    "正文其余部分已可执行：牌库顶 1 张经有序 picks 交 effect.reveal（425.1/425.2.a、契约 3.6 的顺序要求），" +
    "「如果它是法术」由 compare(spell in object-property(types)) 判别（object-property 读链接值首个对象的 types，in 判定左侧属于右侧数组），" +
    "两个分支各用 effect.zone 回手与 effect.recycle 回收，golden 有真实执行证据（旧版记的「缺数组成员判别」已不成立）。" +
    "依赖：RIFT-124（combat 事务与 defense-declared 产生方）、here referent 的契约表达。",
  sourceText:
    "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.",
  abilities: [
    {
      kind: "triggered",
      // 466.2 / 383.4.f：Battlefield 自身的 Defend Effect；"here" 用描述性 here 占位符
      // 保留打印语义（见 judgeReason：该字段尚无词汇，校验器会拒绝）。
      trigger: { at: "defense-declared", filter: { event: "defense-declared", here: true, player: "controller" } },
      optional: false,
      body: [
        {
          // 425.1 / 425.2.a：展示主牌库顶 1 张（牌留在牌库，425.1.a.2）。牌库顶是有序位置，
          // 必须由上游有序 picks 提供（契约 3.6；effect.reveal 拒绝用 query 推断牌库顺序）。
          id: "ravenbloom.reveal",
          op: "effect.reveal",
          // effect.reveal 的 pick 是 PickSpec id；契约 3.2 要求 args 的值为 Expr，
          // 这里按契约写 Expr（已合入的链适配器未声明该字段的解包，见 judgeReason 的第 3 条缺口）。
          args: { pick: { kind: "constant", value: "ravenbloom.revealed-card" } },
          picks: [
            {
              id: "ravenbloom.revealed-card",
              // 牌库顶 1 张（按区域内真实顺序），由引擎提供有序选项。
              options: ["dynamic:main-deck-top-one"],
              filter: { zone: "deck", owner: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "If it's a spell, put it in your hand."：对被展示牌的类型判别，不是玩家选择。
          // object-property 读链接值的首个对象，in 判定 "spell" 是否属于该对象的 types 数组。
          id: "ravenbloom.to-hand",
          op: "effect.zone",
          linkedTo: "ravenbloom.reveal",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "spell" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { linked: "ravenbloom.reveal" },
              property: "types"
            }
          },
          args: {
            pick: { kind: "constant", value: "ravenbloom.revealed-hand" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          picks: [
            {
              id: "ravenbloom.revealed-hand",
              options: [
                { kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }
              ],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Otherwise, recycle it."：417.1/417.1.a/417.1.c 回拥有者主牌库底。条件取反，
          // 与上一条互斥（同一张牌只会走一条分支）。
          id: "ravenbloom.recycle",
          op: "effect.recycle",
          linkedTo: "ravenbloom.reveal",
          condition: {
            kind: "not",
            condition: {
              kind: "compare",
              left: { kind: "constant", value: "spell" },
              operator: "in",
              right: {
                kind: "object-property",
                object: { linked: "ravenbloom.reveal" },
                property: "types"
              }
            }
          },
          args: {
            objects: { kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

