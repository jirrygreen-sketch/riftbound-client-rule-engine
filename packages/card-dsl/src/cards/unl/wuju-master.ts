import type { CardProgram } from "../../ir/index.js";

/**
 * Wuju Master (unl-191-219) — Legend, Calm/Body, tag Master Yi.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-191-219，逐字）：
 *   [Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the
 *   effect.)
 *   [Level 11][>] Your units enter ready.
 *
 * 规则依据（CR v1.5）：
 * - 824.1.a / 824.1.b / 824.1.b.1 / 824.1.c：[Level N][>] 是依赖式关键词，从
 *   关键词到子句结尾整段是 Level Ability，功能等价于“当你有 N 点或更多 XP 时，
 *   本牌获得‘[Text]’”；控制者 XP 变化会即时让依赖能力 Active/Inactive
 *   （824.1.c.1 / 824.1.d）。
 * - 第一条依赖能力 “Your units have +1 [M]” 是持续性的图层修正：需要有 XP 门槛
 *   条件的 continuous.might（图层 arithmetic，作用域为你的单位）。
 * - 第二条依赖能力 “Your units enter ready” 是入场状态替代：把单位横置入场
 *   （143.4 / 359.2.c）替换成就绪入场（对照 805.6 的 Accelerate 写法：入场替代，
 *   不是先横置再就绪，不触发“成为就绪”）。
 *
 * status = judge-required（2026-10-16 复核）。已合入并可执行的部分（golden 覆盖）：
 * - RIFT-258 的 continuous.might 原语按本卡声明的 filter（zone board / type unit /
 *   controller）解析“你的单位”，数学图层真实 +1 Might；经 translateObjectFilter +
 *   resolveChainBody 的生产包装，作用域只覆盖控制者的单位（探针：友方 3→4、敌方不变）。
 * - RIFT-260 的 replacement/ 能通过 bindReplacement 校验本卡声明的静态 replaces 形态（单一
 *   source-targeted effect.ready），把它登记成 entry 声明（golden 断言登记成功与 id）。
 *   但该 entry 声明只匹配“声明者自身”的入场（见下方缺口第三条），对本卡的印刷语义无效。
 * 仍缺的缺口：
 * - [Level N][>] 的 Dependent Ability 没有绑定路径：RIFT-268 的 Level.ts 只发布
 *   condition.predicate（level-active / controller-xp / threshold），没有把依赖能力挂到关键词
 *   实例上的编译形式，Condition 也读不到控制者 XP（只有 always/never/compare/all/any/not/
 *   expression，PlayerSnapshot.xp 没有 Expr 路径），824.1.c.1/.d 的动态 Active/Inactive 无法评估。
 *   程序里的 compare 只是保留门控。
 * - 没有把 CardProgram 的 static/replacement 能力接到链与图层上的生产方：
 *   programs/statics.ts 只暴露不透明的 bindStatic/bindReplacement 回调，attachProgramLifecycle
 *   需要调用方提供 binder，没有已合入实现（RIFT-257 后续）；图层侧也没有实现该回调把
 *   continuous.might 注册进 LayerEngine 的模块。
 * - “Your units enter ready” 现在完全不可执行，需要按对象的替代窗口：RIFT-260 的 entry 声明
 *   只匹配「声明者自身」的入场（bind.ts 的 matchesEnterAction 要求 action.object.id === hostRef.id），
 *   而本卡是 Legend、声明 filter 的 type: "unit" 描述的是被替代事件的对象，因此声明者自己的入场
 *   也永远不匹配（探针：Legend 宿主 matches 返回 false）；其它友方单位入场同样不被拦截（探针：
 *   声明者声明时 matches 返回 false）。以 self 为目标的其它 entry-body 拼写会在 bind 时被拒绝
 *   （"Unsupported entry body target value"）。该路径也不评估 ability.condition（不调用 testCondition），
 *   直接绑定还会绕过 11+ XP 门槛。要让宣言影响“你的单位”需要按对象的替代绑定或链侧入场窗口适配。
 *
 * 依赖：RIFT-257 后续（CardProgram static/replacement 的 binder 接线）、RIFT-268 的 Level
 * 展开后续（依赖能力绑定与 XP 谓词求值）、RIFT-260 后续（按对象的入场朝向替代窗口）。
 */
export default {
  canonicalCardId:
    "card.hash-8b7f21bf0986b17b411aeaaeffd500931ea02096c94389c90265a214f7707ab4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "已合入并可执行：RIFT-258 的 continuous.might 按声明的 filter 解析“你的单位”，数学图层真实 +1 Might（经 translateObjectFilter + " +
    "resolveChainBody 的生产包装验证：友方单位 3→4、敌方不变，golden 断言）；RIFT-260 的 replacement/ 能通过 bindReplacement 校验本卡声明的静态 " +
    "replaces 形态并登记 entry 声明。整卡仍缺三处：" +
    "(1) [Level N][>] 的 Dependent Ability 没有绑定——RIFT-268 的 Level.ts 只发布 condition.predicate" +
    "（level-active / controller-xp / threshold），没有把依赖能力挂到关键词实例上的编译形式，Condition 也读不到控制者 XP" +
    "（只有 always/never/compare/all/any/not/expression，PlayerSnapshot.xp 没有 Expr 路径），824.1.c.1/.d 的动态 Active/Inactive 无法评估；" +
    "(2) 没有生产方把 CardProgram 的 static/replacement 能力接进链与图层：programs/statics.ts 只暴露不透明的 bindStatic/bindReplacement 回调，" +
    "attachProgramLifecycle 需要调用方注入 binder，没有已合入实现（RIFT-257 后续），也没有模块实现该回调去调用 LayerEngine 注册 continuous.might；" +
    "(3) “Your units enter ready” 完全不可执行：bind.ts 的 entry 声明只匹配「声明者自身」的入场（matchesEnterAction 要求 action.object.id === hostRef.id），" +
    "而本卡是 Legend、声明 filter 的 type: \"unit\" 描述被替代事件的对象，声明者自己的入场也不匹配（探针确认）；其它友方单位入场同样不被拦截，" +
    "以 self 为目标的其它 entry-body 拼写又会在 bind 时被拒绝（Unsupported entry body target value）；该路径也不调用 testCondition，直接绑定会绕过 11+ XP 门槛。" +
    "要让宣言影响“你的单位”需要按对象的替代绑定或链侧入场窗口适配（RIFT-260 后续），链侧入场朝向写在 resolve 内部（先 commit ready/exhaust 再 move-zone）。" +
    "依赖：RIFT-257 后续（binder 接线）、RIFT-268 的 Level 展开后续、RIFT-260 后续（按对象入场替代）。不近似实现。",
  abilities: [
    {
      kind: "static",
      // 824.1.b.1：“当你有 6+ XP 时，本牌获得 ‘Your units have +1 [M]’”。
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // 作用域：你的单位（controller 锚点由图层引擎解析）。
        filter: { zone: "board", type: "unit", controller: "controller" }
      },
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
    },
    {
      kind: "replacement",
      // “Your units enter ready”：把单位横置入场替换为就绪入场（143.4 / 359.2.c，
      // 对照 805.6）；真实注册与结算属引擎批 4。
      replaces: {
        event: "object-enters-board",
        filter: { controller: "self", type: "unit", exhausted: true }
      },
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 11 }
      },
      with: [
        {
          id: "wuju-master.enter-ready",
          op: "effect.ready",
          args: { objects: { kind: "constant", value: { kind: "source" } } }
        }
      ]
    }
  ],
  sourceText:
    "[Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the effect.)\n" +
    "[Level 11][>] Your units enter ready."
} satisfies CardProgram;
