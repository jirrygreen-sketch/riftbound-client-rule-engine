import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Unsung Hero (sfd-167-221, fiora-sfd M1 卡组).
 *
 * 原文："[Deathknell] — If I was [Mighty], draw 2.
 *        (When I die, get the effect. I'm Mighty while I have 5+ :rb_might:.)"
 *
 * 规则依据（CR v1.5）：
 * - 808.1.c：Deathknell 功能上等于 "When I die, [Effect]"——触发点是自身被
 *   消灭并送入垃圾场（808.1.d；时点 object-killed，ruleRefs 429.1/808.1.d）；
 * - 808.1.c.2：Effect 用过去式书写时，指的是触发进链那一刻的状态——
 *   "If I was Mighty" 是触发条件，在进链前判定；808.1.d.3 要求在换区前记录
 *   来源的位置与属性，解释器经 last-known 回看求值（契约 3.6 `lastKnown`）。
 * - 707–711：Mighty = 有效 Might ≥ 5。
 *
 * 结构说明：
 * - Deathknell 是触发能力关键词（808.1），故 abilities[0] 用
 *   { kind: "keyword", keyword: "deathknell" } 声明（契约 3.1 关键词能力）。
 *   展开（订阅 object-killed、死亡被替代时移出链等）由
 *   engine-core 的关键词注册表负责（当前 registry 为空，属 RIFT-81~91 缺口）。
 * - 关键词只提供触发包装，[Effect] 本体以显式 triggered ability 书写
 *   （CR 808.1.c 的"功能等价"展开结果），golden 测试断言其时点与条件。
 * - "If I was Mighty" 的条件直接写在 TriggerSpec.condition 上（808.1.c.2 的
 *   过去式 = 进链时点判定），而不是加在 body 指令上：条件不满足时整个触发
 *   不进链，而不是进链后指令被跳过。
 * - draw 指令的 player 省略，默认 ctx.controller（CR 190.6.d 隐含 "you"）。
 * - 条件中 object-property 的 object 当前写字符串占位符 "source"（触发来源），
 *   因为本分支的 validateCardProgram 仍要求 object 为 string（RIFT-20 校验器）；
 *   RIFT-46（task/RIFT-46-primitive-interface-v1-test-kernel，未合入本基线）已把
 *   校验器改为 validateObjectRef，合入后应改为真实 ObjectRef 形态。
 */
const abilities: Ability[] = [
    {
      kind: "keyword",
      keyword: "deathknell"
    },
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { self: true },
        condition: {
          kind: "compare",
          left: {
            kind: "object-property",
            object: "source" as unknown as import("../../ir/index.js").ObjectRef,
            property: "might"
          },
          operator: "gte",
          right: { kind: "constant", value: 5 }
        }
      },
      optional: false,
      body: [
        {
          id: "unsung-hero.draw-2",
          op: "effect.draw",
          args: {
            amount: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ];

const program = {
  canonicalCardId: "card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "[Deathknell] — If I was [Mighty], draw 2. (When I die, get the effect. I'm Mighty while I have 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
