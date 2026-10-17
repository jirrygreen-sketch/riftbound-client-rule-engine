import type { CardProgram } from "../../ir/index.js";

/**
 * Targonian Visionary (unl-098-219) — Unit, Body, Mount Targon; energy 6, Might 6.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-098-219, verbatim):
 *   [Level 11][>] I have +4 :rb_might:. (While you have 11+ XP, get the effect.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 824.1 / 824.1.a / 824.1.b: [Level N][>] is a Dependent Keyword; from the
 *   keyword to the end of the clause is the Level Ability.
 * - 824.1.b.1 / 824.1.b.2: functionally "While you have [N] or more XP, this
 *   card gains '[Text]'"; here [Text] = "I have +4 :rb_might:".
 * - 824.1.c / 824.1.c.1 / 824.1.d: the Dependent Ability is Active exactly
 *   while the card's controller has N or more XP, and it deactivates again if
 *   that controller's XP drops below N (or the controller changes).
 * - 143.2.a: "+4 :rb_might:" is an arithmetic-layer Might change (the layers
 *   order copy → trait → ability → arithmetic of contract 3.4), not a Buff
 *   counter (702/703 Buffs are objects placed on the unit).
 *
 * Status: judge-required (2026-10-17 re-check against the merged code). Merged
 * and exercised by the golden:
 * - the [Level 11] KeywordDef itself (effects/keywords/Level.ts, RIFT-268) is
 *   registered and expands the declaration into the printed threshold-11 shape;
 * - the CardProgram -> layers registration path is merged (RIFT-349:
 *   programs/statics.ts createEngineStaticBinder + programs/lifecycle.ts), so the
 *   earlier "no binder exists / no module registers CardProgram statics" claim is
 *   stale: the production binder registers this card declaration and wraps its IR
 *   condition in the interpreter evaluateCondition.
 *
 * Still missing (each pinned by a real execution in the golden, not approximated):
 * - 824.1.c / 824.1.c.1 / 824.1.d cannot read the controller XP. The retained
 *   gate is compare(count(subject "controller-xp") gte 11), but the merged
 *   interpreter count branch only performs a set query over board objects
 *   (interpreter/expr.ts case "count" -> queryObjects(expr.filter)); its subject
 *   never participates. The golden evaluates the declared condition with the
 *   merged algebra: false with 10 board objects, true with 11, and the context
 *   player() is read 0 times - it counts objects, not XP. Registered through the
 *   production binder, the +4 therefore also applies at 0 XP; the golden pins that
 *   over-application as the concrete reason for judge-required.
 * - The dependent ability has neither a binder nor a layer mapping. Level.ts only
 *   publishes a static condition.predicate ability (level-active / controller-xp /
 *   threshold); programs/statics.ts layerFor has no mapping for that kind (the
 *   golden reproduces the ProgramBindingError "Static ability kind
 *   condition.predicate has no layer mapping"), and no merged binder attaches the
 *   printed "I have +4 :rb_might:" text to that predicate, so 824.1.c.1/.d dynamic
 *   activation/deactivation cannot execute.
 *
 * Dependency: RIFT-359 (player-XP condition predicates: XP-valued evaluation and
 * predicate -> layer registration) plus the RIFT-268 Level follow-up
 * (dependent-ability binding). The retained IR keeps the printed amount (4) and the
 * 11-XP gate shape for that follow-up; it is a placeholder shape, never an XP read.
 */
export default {
  canonicalCardId: "card.hash-7a28733b1d7d68a60f53e6b2afcce546b7e3c138e103f63079734f2d3809e08f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5 824.1.c/824.1.c.1/824.1.d）：(1) 门控读不到控制者 XP——程序保留的 compare 左值是 " +
    "count(subject \"controller-xp\")，但合并解释器的 count 分支只做集合查询（interpreter/expr.ts case \"count\" → queryObjects(expr.filter)），" +
    "subject 完全不参与求值：golden 用合并的 evaluateCondition 实测同一条件在 10 个盘面对象时为 false、11 个时为 true，且 context.player 读取 0 次，" +
    "所以它数的是对象而不是 XP；把该声明静态能力交给生产 binder（RIFT-349 的 createEngineStaticBinder）注册时，" +
    "0 XP 也会 +4（golden 实测并固定该过度生效，不写成印刷语义；整卡被 ProgramRegistry 的 judge-required 状态门拒绝，先造出可执行路径才是缺口本身）。" +
    "(2) 依赖能力没有绑定与图层映射——RIFT-268 的 Level.ts 只发布 condition.predicate" +
    "（level-active/controller-xp/threshold）静态能力；programs/statics.ts 的 layerFor 没有该 kind 的映射（golden 实测抛 ProgramBindingError " +
    "\"Static ability kind condition.predicate has no layer mapping\"），也没有任何 binder 把印刷的依赖文本「I have +4 :rb_might:」" +
    "（arithmetic 图层的 continuous.might 修正）挂到该谓词上，824.1.c.1/.d 的动态 Active/Inactive 无法执行。" +
    "依赖：RIFT-359（玩家 XP 条件谓词的求值与谓词 → 图层注册）与 RIFT-268 的 Level 展开后续（依赖能力绑定）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 4 },
        filter: { object: "self" }
      },
      // 824.1.b.1：“当你有 11 点或更多 XP 时，本牌获得 ‘I have +4 Might’”。
      // 保留形状：compare/count(subject controller-xp)/gte 11 记录印刷门槛，但合并的 count
      // 原语不读 subject（见 judgeReason 与 golden 的执行证据），所以它不是 XP 判定，
      // 整卡保持 judge-required，不能当作可执行门控。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 11 }
      }
    }
  ],
  sourceText: "[Level 11][>] I have +4 :rb_might:. (While you have 11+ XP, get the effect.)"
} satisfies CardProgram;
