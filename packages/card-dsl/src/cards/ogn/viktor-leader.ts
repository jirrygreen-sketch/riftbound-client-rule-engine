import type { CardProgram } from "../../ir/index.js";

/**
 * Viktor, Leader (ogn-246-298) — Unit, Order, M1 卡组 (fiora-sfd)。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-246-298):
 *   When another non-Recruit unit you control dies, play a 1 :rb_might:
 *   Recruit unit token into your base.
 *
 * 规则依据（CR v1.5）：
 * - "When … dies"：单位被消灭并从 board 送入 trash（429.1），对应封闭时点
 *   object-killed（时点 ruleRefs 429.1/808.1.d）。383.2.c.2 正是用本卡举例：只有在本卡
 *   于另一个非 Recruit 单位死后的瞬间仍在 board 上时该触发才成立。
 * - "another non-Recruit unit you control"：触发 filter 的三个维度——other: true
 *   （排除本源自身，即那次死亡的对象不是本卡；与 pit-rookie/bubble-bot 的 "another"
 *   占位约定一致）、非 Recruit（Recruit 是 133.8 的 tag，133.8.a 无固有规则含义；
 *   187.1 定义 1 Might Recruit token）、controller: "controller"（740.1.a friendly =
 *   同控制者，"you" 由触发管线按能力控制者解析）。
 * - "play a 1 [M] Recruit unit token into your base"：187.1 的 token 定义；
 *   440.2.c / 185.2.a 规定被"打出"的新 token 先在链上创建、再由 play 动作接手，因此
 *   写 mode: "play"（不是 create-then-play，见 effect.token 边界注释）。location 用
 *   { type: "base", player: "controller" }：与 assembly-rig / production-surge /
 *   rumble-scrapper 相同的控制者基地占位，需要 Finalize/管线绑定成本次结算的具体
 *   player base。
 *
 * judge-required 依据（缺哪一项就写哪一项，不近似实现）：
 * - 否定 tag 过滤缺失：ObjectFilter 与各匹配器只支持正向 tags/tag，没有排除 tag 的
 *   字段，所以 "non-Recruit" 只能用扩展键 excludeTags 声明占位（契约 3.2 的 filter
 *   允许扩展键；其它卡同样用 other / isToken / mightGte 这类占位）。当前匹配器不读该
 *   键，只写 type: unit 会把 Recruit 一并匹配，故不得放行整卡。
 * - object-killed 触发把死亡对象快照投进 TriggerSpec filter 的订阅方尚未合入
 *   （events/trigger-spec.ts 已定义 object/source/target 过滤维度，管线侧未接）。
 * - 位置绑定：静态 IR 只能写占位 LocationRef；effect.token 要求求值为合法
 *   LocationRef（参考内核按值比较，占位会被判非法位置并 negated/impossible），
 *   运行时绑定属 Finalize/管线职责。
 */
const viktorLeader = {
  canonicalCardId: "card.hash-7e53dfef149527260e304de53fa08d40d73dd789893fd093fd83cf275d95b2ac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺否定 tag 过滤：ObjectFilter 与各匹配器只有正向 tags/tag，无法表达「non-Recruit」（133.8/133.8.a 的 tag 排除，" +
    "Recruit 定义见 187.1），只能按占位约定写扩展键 excludeTags（当前匹配器不读，写近似 filter 会把 Recruit 一并匹配）；" +
    "object-killed 触发把死亡对象快照投进 TriggerSpec filter 的订阅实现尚未合入（events 管线侧，383.2.c.2 要求触发" +
    "在死亡瞬间评估本卡仍在场）；effect.token 的 mode: \"play\" 需要求值为具体 LocationRef，静态 IR 的 controller base " +
    "占位（assembly-rig/production-surge 同款约定）必须由 Finalize/管线绑定，参考内核按值比较会判为非法位置。" +
    "依赖：RIFT-91/RIFT-9 的过滤与 effect.token 位置绑定、events 管线的死亡触发订阅。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          filter: {
            type: "unit",
            controller: "controller",
            other: true,
            excludeTags: ["Recruit"]
          }
        }
      },
      optional: false,
      body: [
        {
          id: "viktor.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            linkKey: { kind: "constant", value: "recruitToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When another non-Recruit unit you control dies, play a 1 :rb_might: Recruit unit token into your base."
} satisfies CardProgram;

export default viktorLeader;
