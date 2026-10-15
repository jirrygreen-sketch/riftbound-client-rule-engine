# RIFT-9：1080 个卡牌身份的能力模板与原语调研


日期：2026-10-15；任务分支 `task/RIFT-9-survey-ability-templates`；分析基线 `e2cbcdf45ae6f98764951f20a6b67b9dfc4bb95a`。范围仅本报告及同目录 JSON；未修改源码、测试、契约或生成卡牌数据。

本地实测 **1381 个印刷 → 1080 个身份**，全部进入 JSON；目录 schema / dataVersion 见 `packages/card-data/data/deck-catalog.json:2`、`:3`，唯一身份组从 groups 数组（`packages/card-data/data/deck-catalog.json:31406`）严格校验。**147 个身份进入未归类 / 资料冲突桶**（仍保留已识别线索）。现状 coverage 的原始计数直接来自 `packages/card-data/data/effect-coverage.json:3`（1381）、`:4`（1080）、`:5`（可执行 0）、`:6`（judge-required 1348）、`:7`（no-ability 33）。**以下覆盖曲线是有前提的文本需求覆盖上界，不是已可执行卡数或可上线承诺。**

## 1. 依据、边界与复现


任务卡明确采用已批准重设计：v1.5、一个当前引擎、EffectIR 数据 + 通用解释器、单 runtime / journal。本机 `/root/swarm-rift/shared/redesign.md:60` 描述效果原语方案，`:70` 给出原语族，`:72` 要求歧义 / 未实现卡保持 judge-required，`:75` 描述单 runtime。该材料 `:4` 仍标“待评审”，本任务按任务卡的批准说明作为调研方向；没有以此修改旧契约或回放。

规则版本依据：`docs/sources.md:10`、`docs/sources.md:29`、`docs/rules-audit-current.md:7`。这些是仓库在 2026-10-12 的来源核对记录：v1.4 当时生效，目标 v1.5 生效日为 **2026-10-16**；2026-10-15 不能把它写成已生效。此轮只读本地材料，未重新联网核验公告，也未把说明文档当完整 v1.5 规则正文。`docs/rules-audit-current.md:45` 的来源权威边界、`:60` 的 judge-required 约束仍适用。

目录以 `canonicalCardId` 分组，代表文本取 `groups[].primaryPrintingId`，不按名字二次合并。脚本严格检查 1381、1080、group 的完整成员和 coverage 一一对应。每张卡的证据含 catalog 的 `文件:行号`、原文 SHA-256、UTF-16 半开区间；JSON 顶层 `sources` 记录全部输入摘要。未将 `energy:null` / `power:null` 改成 0。

印刷差异：108 个身份存在原文差异；去括号、压空白、去 [NO TEXT] 后仍有 21 个身份不同；43 个身份有卡类 / 属性 / 标签差异。**这只是机械差异，不等同语义冲突或勘误结论。** 这些身份保守移出曲线候选，待官方勘误核对；提醒文字差异单独记录而不自动判冲突。空主文本 16 个身份，其中 Rune 的固有能力按推断列需求，绝不因空文本当无规则效果。

在仓库根执行（Node 22.22.2 / pnpm 11.9.0；依赖使用现有 frozen-lockfile 安装结果）：

```bash
mkdir -p /tmp/RIFT-9-survey-ability-templates
# 将附录完整代码保存为 /tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs
node /tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs --root "$PWD" --out-dir "$PWD/docs/plans/survey"
# 复现到临时目录并逐字节比对两个产物
node /tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs --root "$PWD" --out-dir /tmp/RIFT-9-survey-ability-templates/reproduced
cmp docs/plans/survey/ability-templates.json /tmp/RIFT-9-survey-ability-templates/reproduced/ability-templates.json
cmp docs/plans/survey/ability-templates.md /tmp/RIFT-9-survey-ability-templates/reproduced/ability-templates.md
```

脚本只写两个指定输出和 `/tmp/RIFT-9-survey-ability-templates/`。它将现有 card-dsl 编译到该临时目录，再实际调用九个 description 函数；不会改 `packages/*/dist`。附录本身是完整脚本，不依赖未提交的分析辅助文件。

## 2. 方法与计数口径


1. 用句号 / 问号 / 感叹号 / 换行拆句；括号按嵌套深度遮蔽，避免 reminder 重复计数；原文和偏移保留。目录中的连写 `battlefield.Look` 也可切开。此步骤是文本切分，不是规则语法解析。
2. 方括号按实际词表识别，数值参数去尾部数字；[>] / [>>] 是布局符号，不算关键字。关键词引用分 functional-reference、reminder、unbracketed-reference，**不代表卡天然拥有该能力**。授予、条件查询和 Token 提醒中的引用都进入需求上界，可能高估。
3. 对功能句扫描触发、费用、目标、效果动词、持续 / 替代 / 条件 / 选择线索。每个命中留匹配片段及原文偏移；依赖和宏展开是明确的工程推断。否定句、费用与效果、真实目标与集合引用需要后续人工消歧；命中 damage / instead 不足以证明会执行伤害 / 替代效果。
4. 无实质操作或关键词的句子、畸形尾部、非提醒差异、属性 / 标签差异进入未归类桶。未归类是保守阻断；其余 lexical-candidate 也仅是命中线索，不能当完整编译或无歧义证明。所有卡 `requiresV15RuleReview:true`。
5. 模板表和原语表是**可重叠身份数**：同卡在同一行最多计一次；不按出现次数，不按印刷数，不可直接把各行相加。direct 是字面 / 宏 / 卡类推断需求，required 是依赖闭包。

| 互斥主分类 | 身份数 |
| --- | --- |
| lexical-candidate | 917 |
| no-ability-text | 16 |
| unclassified | 147 |

| 卡类 | 身份数 |
| --- | --- |
| Battlefield | 76 |
| Gear | 126 |
| Legend | 57 |
| Rune | 6 |
| Spell | 268 |
| Token | 2 |
| Unit | 545 |

主印刷 Energy 为 null：149；Power 为 null：648。identityExecutionStatus（任一印刷 judge-required 即保守保留）为 {"judge-required":1071,"no-ability":9}。

## 3. 模板表


模板是可组合的句式 / 关键词族，而非完整卡程序；`primitives` 为该模板局部依赖，不代表整卡需求。低 / 中 / 高是实现复杂度估计。每行都需 v1.5 规则复核；“阻断 N”表示该行匹配身份中另有未归类问题，不是已由裁判判定的数量。完整片段、卡源和逐卡组合见 JSON。

| 模板 / ID | 示例与出处 | 覆盖身份 | 涉及原语（直接） | 难度 | 规则裁定 / 复核 |
| --- | --- | --- | --- | --- | --- |
| 关键词 / 引用 Assault (kw-assault) | sfd-003-221: [Assault 2] · packages/card-data/data/deck-catalog.json:12840 | 47 | continuous.might, condition.predicate | 高 | v1.5 复核；阻断 7 |
| 关键词 / 引用 Shield (kw-shield) | ogn-241-298: [Shield 2] · packages/card-data/data/deck-catalog.json:6050 | 35 | continuous.might, condition.predicate | 高 | v1.5 复核；阻断 3 |
| 关键词 / 引用 Deflect (kw-deflect) | ogn-063-298: [Deflect] · packages/card-data/data/deck-catalog.json:1532 | 51 | target.tax | 高 | v1.5 复核；阻断 5 |
| 关键词 / 引用 Accelerate (kw-accelerate) | ogn-116-298: [Accelerate] · packages/card-data/data/deck-catalog.json:2865 | 32 | cost.additional, cost.pay, choice.optional, replacement.enter | 高 | v1.5 复核；阻断 4 |
| 关键词 / 引用 Equip (kw-equip) | ven-137-166: [Equip] · packages/card-data/data/deck-catalog.json:29445 | 51 | cost.activated, cost.pay, effect.attach | 高 | v1.5 复核；阻断 2 |
| 关键词 / 引用 Hidden (kw-hidden) | ogn-264-298: [Hidden] · packages/card-data/data/deck-catalog.json:6656 | 50 | cost.hidden | 高 | v1.5 复核；阻断 9 |
| 关键词 / 引用 Ganking (kw-ganking) | ogn-205-298: [Ganking] · packages/card-data/data/deck-catalog.json:5150 | 40 | continuous.movement | 高 | v1.5 复核；阻断 6 |
| 关键词 / 引用 Tank (kw-tank) | ven-159-166: [Tank] · packages/card-data/data/deck-catalog.json:29981 | 29 | continuous.combat | 高 | v1.5 复核；阻断 0 |
| 关键词 / 引用 Backline (kw-backline) | unl-090-219: [Backline] · packages/card-data/data/deck-catalog.json:21778 | 4 | continuous.combat | 高 | v1.5 复核；阻断 0 |
| 关键词 / 引用 Deathknell (kw-deathknell) | sfd-021-221: [Deathknell] · packages/card-data/data/deck-catalog.json:13264 | 29 | trigger.leave | 高 | v1.5 复核；阻断 1 |
| 关键词 / 引用 Temporary (kw-temporary) | unl-090-219: [Temporary] · packages/card-data/data/deck-catalog.json:21778 | 24 | trigger.phase, effect.kill | 高 | v1.5 复核；阻断 2 |
| 关键词 / 引用 Reaction (kw-reaction) | ogn-204-298: [Reaction] · packages/card-data/data/deck-catalog.json:5124 | 126 | continuous.timing | 高 | v1.5 复核；阻断 29 |
| 关键词 / 引用 Action (kw-action) | sfd-003-221: [Action] · packages/card-data/data/deck-catalog.json:12840 | 104 | continuous.timing | 高 | v1.5 复核；阻断 20 |
| 关键词 / 引用 Ambush (kw-ambush) | unl-149-219: [Ambush] · packages/card-data/data/deck-catalog.json:23321 | 15 | continuous.timing, target.location | 高 | v1.5 复核；阻断 2 |
| 关键词 / 引用 Repeat (kw-repeat) | sfd-003-221: [Repeat] · packages/card-data/data/deck-catalog.json:12840 | 25 | cost.additional, cost.pay, choice.optional, effect.repeat | 高 | v1.5 复核；阻断 3 |
| 关键词 / 引用 Empower (kw-empower) | ven-050-166: [Empower] · packages/card-data/data/deck-catalog.json:27228 | 51 | cost.activated, cost.pay, effect.empower, condition.predicate | 高 | v1.5 复核；阻断 11 |
| 关键词 / 引用 Empowered (kw-empowered) | ven-050-166: [Empowered] · packages/card-data/data/deck-catalog.json:27228 | 42 | condition.predicate | 高 | v1.5 复核；阻断 11 |
| 关键词 / 引用 Flow (kw-flow) | ven-003-166: [Flow] · packages/card-data/data/deck-catalog.json:26026 | 17 | condition.history, condition.predicate | 高 | v1.5 复核；阻断 4 |
| 关键词 / 引用 Legion (kw-legion) | ogn-217-298: [Legion] · packages/card-data/data/deck-catalog.json:5455 | 10 | condition.history, condition.predicate | 高 | v1.5 复核；阻断 2 |
| 关键词 / 引用 Mighty (kw-mighty) | ogn-232-298: [Mighty] · packages/card-data/data/deck-catalog.json:5782 | 12 | condition.value | 高 | v1.5 复核；阻断 0 |
| 关键词 / 引用 Vision (kw-vision) | unl-089-219: [Vision] · packages/card-data/data/deck-catalog.json:21726 | 9 | trigger.play, effect.inspect, effect.recycle, choice.optional | 高 | v1.5 复核；阻断 2 |
| 关键词 / 引用 Predict (kw-predict) | unl-211-219: [Predict] · packages/card-data/data/deck-catalog.json:24913 | 13 | effect.inspect, effect.recycle, effect.order, choice.optional | 高 | v1.5 复核；阻断 0 |
| 关键词 / 引用 Hunt (kw-hunt) | unl-117-219: [Hunt 2] · packages/card-data/data/deck-catalog.json:22459 | 12 | trigger.score, effect.xp | 高 | v1.5 复核；阻断 1 |
| 关键词 / 引用 Level (kw-level) | unl-151-219: [Level 3] · packages/card-data/data/deck-catalog.json:23424 | 15 | condition.value, condition.predicate | 高 | v1.5 复核；阻断 1 |
| 关键词 / 引用 Burn (kw-burn) | ven-108-166: [Burn 1] · packages/card-data/data/deck-catalog.json:28651 | 8 | effect.mill | 高 | v1.5 复核；阻断 1 |
| 关键词 / 引用 Deploy (kw-deploy) | rad-116-167: [Deploy] · packages/card-data/data/deck-catalog.json:10926 | 22 | continuous.location | 高 | v1.5 复核；阻断 2 |
| 关键词 / 引用 Quick-Draw (kw-quick-draw) | sfd-064-221: [Quick-Draw] · packages/card-data/data/deck-catalog.json:14435 | 5 | continuous.timing, trigger.play, effect.attach | 高 | v1.5 复核；阻断 0 |
| 关键词 / 引用 Weaponmaster (kw-weaponmaster) | sfd-092-221: [Weaponmaster] · packages/card-data/data/deck-catalog.json:15174 | 12 | trigger.play, cost.modify, effect.attach, choice.optional | 高 | v1.5 复核；阻断 3 |
| 关键词 / 引用 Unique (kw-unique) | sfd-191-221: [Unique] · packages/card-data/data/deck-catalog.json:17733 | 3 | continuous.deck | 高 | v1.5 复核；阻断 0 |
| 关键词 / 引用 Show Off (kw-show-off) | rad-082-167: [Show Off] · packages/card-data/data/deck-catalog.json:10135 | 3 | cost.reveal, condition.result | 高 | v1.5 复核；阻断 1 |
| 关键词 / 引用 Disarm (kw-disarm) | rad-097-167: [Disarm] · packages/card-data/data/deck-catalog.json:10499 | 7 | trigger.combat, continuous.might, continuous.duration | 高 | v1.5 复核；阻断 1 |
| 关键词 / 引用 Stun (kw-stun) | ven-120-166: [Stun] · packages/card-data/data/deck-catalog.json:29009 | 29 | effect.stun | 高 | v1.5 复核；阻断 6 |
| 关键词 / 引用 Buff (kw-buff) | ogn-141-298: buff · packages/card-data/data/deck-catalog.json:3515 | 49 | effect.buff | 高 | v1.5 复核；阻断 8 |
| 关键词 / 引用 Add (kw-add) | ogn-204-298: [Add] · packages/card-data/data/deck-catalog.json:5124 | 39 | effect.resources | 高 | v1.5 复核；阻断 7 |
| When 打出 (trigger-play) | ogn-141-298: When you play · packages/card-data/data/deck-catalog.json:3515 | 231 | trigger.play | 高 | v1.5 复核；阻断 21 |
| 死亡 / 离场触发 (trigger-leave) | sfd-203-221: When one or more enemy units die · packages/card-data/data/deck-catalog.json:18016 | 18 | trigger.leave | 高 | v1.5 复核；阻断 1 |
| 攻击 / 防守 / 战斗事件 (trigger-combat) | unl-137-219: When I attack · packages/card-data/data/deck-catalog.json:22973 | 61 | trigger.combat | 高 | v1.5 复核；阻断 8 |
| Hold / Conquer 事件 (trigger-score) | sfd-207-221: When you conquer · packages/card-data/data/deck-catalog.json:18107 | 93 | trigger.score | 高 | v1.5 复核；阻断 17 |
| At the start / end 阶段 (trigger-phase) | unl-050-219: at the start · packages/card-data/data/deck-catalog.json:20637 | 30 | trigger.phase | 高 | v1.5 复核；阻断 4 |
| 移动事件 (trigger-move) | sfd-048-221: When I move · packages/card-data/data/deck-catalog.json:13953 | 51 | trigger.move | 高 | v1.5 复核；阻断 3 |
| When / Whenever 一般事件 (trigger-state) | sfd-207-221: When · packages/card-data/data/deck-catalog.json:18107 | 420 | trigger.state | 高 | v1.5 复核；阻断 49 |
| next 阶段延迟执行 (delayed) | unl-050-219: at the start of your next · packages/card-data/data/deck-catalog.json:20637 | 2 | trigger.delayed | 高 | v1.5 复核；阻断 1 |
| 费用 : 效果 (activated) | ogn-099-298: Recycle 3 from your trash, :rb_energy_1:, :rb_exhaust:: D · packages/card-data/data/deck-catalog.json:2458 | 176 | cost.activated | 高 | v1.5 复核；阻断 28 |
| 支付资源 (cost-resources) | sfd-207-221: pay :rb_energy_1: · packages/card-data/data/deck-catalog.json:18107 | 58 | cost.pay | 中 | v1.5 复核；阻断 3 |
| as an additional cost (additional-cost) | rad-014-167: additional cost · packages/card-data/data/deck-catalog.json:8749 | 40 | cost.additional | 中 | v1.5 复核；阻断 5 |
| 减费 / 忽略费用 / 替代费用 (cost-modify) | ogn-195-298: cost :rb_energy_1: less · packages/card-data/data/deck-catalog.json:4867 | 94 | cost.modify | 高 | v1.5 复核；阻断 4 |
| 横置费用 (cost-exhaust) | ogn-099-298: :rb_exhaust: · packages/card-data/data/deck-catalog.json:2458 | 98 | cost.exhaust | 中 | v1.5 复核；阻断 13 |
| 弃牌费用 (cost-discard) | ogn-202-298: discard one or more cards, ready me and give me +1 : · packages/card-data/data/deck-catalog.json:5058 | 11 | cost.discard | 中 | v1.5 复核；阻断 1 |
| kill 费用候选 (cost-sacrifice) | rad-014-167: kill a friendly unit or gear as an additional cost · packages/card-data/data/deck-catalog.json:8749 | 31 | cost.sacrifice | 高 | v1.5 复核；阻断 3 |
| recycle 费用候选 (cost-recycle) | ogn-099-298: Recycle 3 from your trash, : · packages/card-data/data/deck-catalog.json:2458 | 3 | cost.recycle | 中 | v1.5 复核；阻断 1 |
| Spend XP (cost-xp) | unl-126-219: Spend 3 XP · packages/card-data/data/deck-catalog.json:22739 | 11 | cost.xp | 中 | v1.5 复核；阻断 1 |
| Draw N (draw) | sfd-048-221: draw · packages/card-data/data/deck-catalog.json:13953 | 154 | effect.draw | 低 | v1.5 复核；阻断 18 |
| Discard N (discard) | ogn-202-298: discard · packages/card-data/data/deck-catalog.json:5058 | 38 | effect.discard | 低 | v1.5 复核；阻断 4 |
| Deal N / Might damage (damage) | ogn-149-298: deal · packages/card-data/data/deck-catalog.json:3688 | 99 | effect.damage | 中 | v1.5 复核；阻断 25 |
| Heal (heal) | sfd-173-221: heal · packages/card-data/data/deck-catalog.json:17251 | 5 | effect.heal | 中 | v1.5 复核；阻断 1 |
| Kill (kill) | ven-003-166: Kill · packages/card-data/data/deck-catalog.json:26026 | 80 | effect.kill | 中 | v1.5 复核；阻断 12 |
| Move / Recall (move) | sfd-048-221: move · packages/card-data/data/deck-catalog.json:13953 | 116 | effect.move | 高 | v1.5 复核；阻断 19 |
| Return / Put 区域迁移 (zone) | sfd-207-221: return a unit you control here to its owner's hand · packages/card-data/data/deck-catalog.json:18107 | 52 | effect.zone | 高 | v1.5 复核；阻断 5 |
| Ready (ready) | sfd-203-221: ready · packages/card-data/data/deck-catalog.json:18016 | 112 | effect.ready | 低 | v1.5 复核；阻断 13 |
| Exhaust / Exhausted (exhaust) | sfd-203-221: exhaust · packages/card-data/data/deck-catalog.json:18016 | 100 | effect.exhaust | 低 | v1.5 复核；阻断 12 |
| Add 资源 (resources) | ogn-204-298: [Add] · packages/card-data/data/deck-catalog.json:5124 | 28 | effect.resources | 中 | v1.5 复核；阻断 5 |
| Channel rune (channel) | rad-029-167: channel · packages/card-data/data/deck-catalog.json:9133 | 31 | effect.channel | 中 | v1.5 复核；阻断 3 |
| Play / Create token (token) | sfd-207-221: play a 2 :rb_might: Sand Soldier unit token · packages/card-data/data/deck-catalog.json:18107 | 96 | effect.token | 高 | v1.5 复核；阻断 14 |
| Attach Equipment (attach) | sfd-011-221: Attach · packages/card-data/data/deck-catalog.json:13014 | 15 | effect.attach | 高 | v1.5 复核；阻断 5 |
| Detach Equipment (detach) | sfd-011-221: detach · packages/card-data/data/deck-catalog.json:13014 | 3 | effect.detach | 中 | v1.5 复核；阻断 1 |
| 非通常区域 / 额外打出 (special-play) | sfd-203-221: to play · packages/card-data/data/deck-catalog.json:18016 | 99 | effect.play | 高 | v1.5 复核；阻断 9 |
| Recycle (recycle) | ogn-099-298: Recycle · packages/card-data/data/deck-catalog.json:2458 | 46 | effect.recycle | 中 | v1.5 复核；阻断 13 |
| Banish (banish) | ogn-122-298: Banish · packages/card-data/data/deck-catalog.json:3086 | 28 | effect.banish | 中 | v1.5 复核；阻断 5 |
| Reveal (reveal) | rad-018-167: reveal · packages/card-data/data/deck-catalog.json:8837 | 27 | effect.reveal | 中 | v1.5 复核；阻断 8 |
| Look at / Search (inspect) | ogn-242-298: Look at · packages/card-data/data/deck-catalog.json:6070 | 18 | effect.inspect | 中 | v1.5 复核；阻断 2 |
| Put back / 顶底排序 (order) | sfd-212-221: put the top · packages/card-data/data/deck-catalog.json:18207 | 3 | effect.order | 中 | v1.5 复核；阻断 0 |
| Buff / Spend buff (buff) | ogn-141-298: buff · packages/card-data/data/deck-catalog.json:3515 | 53 | effect.buff | 中 | v1.5 复核；阻断 8 |
| Gain XP (xp) | unl-136-219: Gain 1 XP · packages/card-data/data/deck-catalog.json:22950 | 18 | effect.xp | 低 | v1.5 复核；阻断 3 |
| Empower / Disempower (empower) | ven-050-166: Empower · packages/card-data/data/deck-catalog.json:27228 | 53 | effect.empower | 高 | v1.5 复核；阻断 12 |
| Score / Gain point (score) | ogn-205-298: score 1 point · packages/card-data/data/deck-catalog.json:5150 | 22 | effect.score | 高 | v1.5 复核；阻断 5 |
| Win the game (win) | ogn-293-298: win the game · packages/card-data/data/deck-catalog.json:7275 | 3 | effect.win | 高 | v1.5 复核；阻断 0 |
| Take control (control) | ogn-203-298: Take control · packages/card-data/data/deck-catalog.json:5104 | 7 | effect.control | 高 | v1.5 复核；阻断 3 |
| Counter spell / ability (counter) | ven-015-166: countered · packages/card-data/data/deck-catalog.json:26283 | 14 | effect.counter | 高 | v1.5 复核；阻断 4 |
| Copy (copy) | ven-137-166: copy · packages/card-data/data/deck-catalog.json:29445 | 6 | effect.copy | 高 | v1.5 复核；阻断 1 |
| Repeat effect (repeat) | sfd-003-221: Repeat · packages/card-data/data/deck-catalog.json:12840 | 25 | effect.repeat | 高 | v1.5 复核；阻断 3 |
| Stun (stun) | ven-120-166: Stun · packages/card-data/data/deck-catalog.json:29009 | 33 | effect.stun | 中 | v1.5 复核；阻断 6 |
| 修改 Might (might) | ven-159-166: +1 · packages/card-data/data/deck-catalog.json:29981 | 182 | continuous.might | 中 | v1.5 复核；阻断 32 |
| This turn / Until (duration) | unl-183-219: this turn · packages/card-data/data/deck-catalog.json:24276 | 240 | continuous.duration | 高 | v1.5 复核；阻断 48 |
| 时机许可 (timing) | ogn-117-298: opponent's turn · packages/card-data/data/deck-catalog.json:2891 | 2 | continuous.timing | 高 | v1.5 复核；阻断 1 |
| 移动许可 / 限制 (movement) | unl-137-219: may pay :rb_energy_1: to move · packages/card-data/data/deck-catalog.json:22973 | 27 | continuous.movement | 高 | v1.5 复核；阻断 2 |
| 战斗伤害修改 / 指派 (combat) | unl-171-219: combat damage · packages/card-data/data/deck-catalog.json:23872 | 13 | continuous.combat | 高 | v1.5 复核；阻断 0 |
| 不能 / 必须 / 仅可 (restrict) | ven-015-166: can't · packages/card-data/data/deck-catalog.json:26283 | 64 | continuous.restrict | 高 | v1.5 复核；阻断 8 |
| 不触发 / 失去能力 (suppress) | unl-090-219: don't trigger · packages/card-data/data/deck-catalog.json:21778 | 1 | continuous.suppress | 高 | v1.5 复核；阻断 0 |
| 构筑数量例外 (deck-limit) | ven-097-166: Your deck can have · packages/card-data/data/deck-catalog.json:28419 | 1 | continuous.deck | 中 | v1.5 复核；阻断 0 |
| Enter Ready / Exhausted (enter) | ogn-129-298: enter ready · packages/card-data/data/deck-catalog.json:3252 | 39 | replacement.enter | 高 | v1.5 复核；阻断 1 |
| Would / Instead 候选 (replacement) | sfd-173-221: would · packages/card-data/data/deck-catalog.json:17251 | 43 | replacement.event | 高 | v1.5 复核；阻断 11 |
| 防伤 / 防死亡候选 (prevention) | ogn-189-298: don't take damage · packages/card-data/data/deck-catalog.json:4693 | 5 | replacement.prevent | 高 | v1.5 复核；阻断 2 |
| If / While / Otherwise (condition) | sfd-207-221: If · packages/card-data/data/deck-catalog.json:18107 | 219 | condition.predicate | 中 | v1.5 复核；阻断 37 |
| 动态数值 / 比较 / X (value) | sfd-203-221: more · packages/card-data/data/deck-catalog.json:18016 | 274 | condition.value | 高 | v1.5 复核；阻断 46 |
| Once / First / Nth / Played 历史 (history) | ogn-205-298: third · packages/card-data/data/deck-catalog.json:5150 | 56 | condition.history | 高 | v1.5 复核；阻断 8 |
| If you do / Paid / This way (result) | sfd-207-221: If you do · packages/card-data/data/deck-catalog.json:18107 | 46 | condition.result | 高 | v1.5 复核；阻断 9 |
| You may (optional) | sfd-207-221: may · packages/card-data/data/deck-catalog.json:18107 | 200 | choice.optional | 中 | v1.5 复核；阻断 23 |
| Choose one / two / Or (mode) | sfd-203-221: or · packages/card-data/data/deck-catalog.json:18016 | 169 | choice.mode | 中 | v1.5 复核；阻断 45 |
| Any order (choice-order) | ogn-291-298: any order · packages/card-data/data/deck-catalog.json:7235 | 1 | choice.order | 高 | v1.5 复核；阻断 0 |
| 对象引用 / Choose / Pick (target) | sfd-207-221: a unit · packages/card-data/data/deck-catalog.json:18107 | 451 | target.query | 中 | v1.5 复核；阻断 93 |
| 友敌 / 类型 / 控制者筛选 (filter) | sfd-207-221: unit · packages/card-data/data/deck-catalog.json:18107 | 742 | target.filter | 中 | v1.5 复核；阻断 117 |
| 地点引用 (location) | sfd-207-221: here · packages/card-data/data/deck-catalog.json:18107 | 382 | target.location | 高 | v1.5 复核；阻断 67 |
| Each / All / Up to / 多选 (many) | ogn-141-298: up to · packages/card-data/data/deck-catalog.json:3515 | 198 | target.many | 高 | v1.5 复核；阻断 44 |
| 玩家引用 / 选择 (player) | unl-205-219: player · packages/card-data/data/deck-catalog.json:24793 | 64 | target.player | 中 | v1.5 复核；阻断 16 |
| 卡类隐含正常支付 (implicit-printed-cost) | unl-090-219: Unit · packages/card-data/data/deck-catalog.json:21778 | 939 | cost.printed | 中 | v1.5 复核；阻断 134 |
| Rune 固有能力待核验 (inherent-rune) | ogn-166-298: Rune · packages/card-data/data/deck-catalog.json:4187 | 6 | effect.resources, cost.exhaust, cost.recycle | 高 | v1.5 复核；阻断 0 |
| 无印刷能力文本 (no-ability-text) | ogn-088-298: (无印刷能力文本) · packages/card-data/data/deck-catalog.json:2204 | 16 | 无 / 见逐卡保留需求 | 低 | v1.5 复核；阻断 0 |
| 未归类 / 资料冲突桶 (unclassified) | ogn-122-298: Take a turn after this one. · packages/card-data/data/deck-catalog.json:3086 | 147 | 无 / 见逐卡保留需求 | 高 | v1.5 复核；阻断 147 |

Hold / Conquer 实际作为触发句出现；Recruit 是 Token 名称，既不是 [Recruit] 关键词，也不是单独的效果 opcode。Equip 同时存在带方括号和普通单词形式。Assault / Shield 的数字、Show Off 的对象、Empowered 条件块、[>] 布局、Rune 符号均保留在逐卡 evidence，不据词频补默认语义。

## 4. 建议的 EffectIR v2 原语清单（工程推断）


分类固定为 cost / target / effect / trigger / replacement / continuous（持续）/ condition（条件）/ choice（选择）。依赖是本报告用于估算的模块关系；它们不是已批准类型定义，也不是已实现声明。effect.zone、事件、对象引用、选择收据的具体契约由父任务制定。每个名称有稳定 ID；需要某关键词而未明确实施时，整卡继续 judge-required。

| 类别 / 原语 | 直接 / 含依赖身份数 | 依赖 | 难度 | 语义边界 / 待核验 |
| --- | --- | --- | --- | --- |
| cost / cost.printed: 印刷费用；null 保留为无印刷值 | 939 / 965 | 无 | 中 | 空费用、0 与符文 Power 不得互换 |
| cost / cost.pay: 支付能量 / 指定域或通用 Power | 213 / 297 | 无 | 中 | 资源池、符文回收与支付原子性 |
| cost / cost.activated: 激活费用与效果的边界 | 243 / 243 | 无 | 中 | 符号内部冒号不属于费用分隔符 |
| cost / cost.additional: 可选 / 强制附加费用及支付记录 | 96 / 96 | cost.printed | 中 | 费用承诺与后续 if-paid 关联 |
| cost / cost.modify: 费用增减与忽略 / 替代支付 | 106 / 106 | cost.printed, condition.value | 高 | 减费顺序、最低值和忽略 Energy 与全部费用的区别 |
| cost / cost.exhaust: 横置自身或其他对象作为费用 | 104 / 104 | target.query | 中 | 费用横置与效果横置分开 |
| cost / cost.discard: 弃牌费用 | 11 / 11 | effect.zone | 中 | 费用不可退与隐藏牌选择 |
| cost / cost.sacrifice: 消灭友方 / 自身作为费用 | 31 / 31 | effect.kill | 高 | 明确是费用还是效果，不能由 kill 单词决定 |
| cost / cost.recycle: 回收对象作为费用 | 9 / 9 | effect.recycle | 中 | 回收区域与对象类型 |
| cost / cost.xp: 支付 XP | 11 / 11 | 无 | 中 | XP 是玩家状态，区别于能量 |
| cost / cost.reveal: 展示 / Show Off 的承诺 | 3 / 3 | effect.reveal, choice.mode | 高 | 从手牌展示与选友方对象两分支 |
| cost / cost.hidden: Hidden 隐藏与解禁成本 | 50 / 50 | cost.pay, effect.zone, continuous.timing | 高 | 秘密区域、拥有权和合法使用时机 |
| target / target.query: 对象查询 / 选择与重验 | 451 / 1059 | 无 | 中 | 自指、外部目标和不以目标为前提的集合查询须区分 |
| target / target.filter: 类型 / 控制者 / 标签 / 数值筛选 | 742 / 782 | target.query | 中 | 所有权不等于控制权 |
| target / target.location: here / there / base / battlefield 引用 | 389 / 545 | target.query | 高 | 触发源离场后的地点与指代绑定 |
| target / target.many: 数量范围与集合分配 | 198 / 198 | target.query | 高 | up to、each、all、分摊和同时性 |
| target / target.player: 玩家 / 对手选择 | 64 / 79 | target.query | 中 | each player 与 choose opponent 不等价 |
| target / target.tax: Deflect 目标附加支付 | 51 / 51 | target.query, cost.pay | 高 | 合法性与选择目标时支付顺序 |
| effect / effect.draw: 抽牌 | 154 / 154 | effect.zone | 低 | 空牌库及隐藏投影归内核 |
| effect / effect.discard: 弃牌 | 38 / 38 | effect.zone, target.query | 低 | 效果弃牌和费用弃牌分开 |
| effect / effect.damage: 造成 / 分配伤害 | 99 / 99 | target.query | 中 | 动态数额、同时伤害、Bonus Damage |
| effect / effect.heal: 清除伤害 / heal | 5 / 5 | target.query | 中 | 不引入实验性玩家生命语义 |
| effect / effect.kill: kill / 死亡处理 | 104 / 104 | effect.zone, target.query | 中 | 消灭与被替代的死亡分开 |
| effect / effect.zone: 跨区域移动与对象身份 | 52 / 524 | target.query | 高 | 隐藏信息、离场、归属和最后已知信息 |
| effect / effect.move: 场上移动 / recall | 116 / 116 | target.location | 高 | 移动路径、占领和战斗建立 |
| effect / effect.ready: 重置 | 112 / 112 | target.query | 低 | enter ready 使用入场替代而非事后重置 |
| effect / effect.exhaust: 横置 | 100 / 100 | target.query | 低 | 作为效果执行 |
| effect / effect.resources: 增加 Energy / Power | 45 / 45 | 无 | 中 | 资源能力的时机与是否入链 |
| effect / effect.channel: channel 符文 | 31 / 31 | effect.zone | 中 | 从符文库、exhausted 入场与资源池不同 |
| effect / effect.token: 创建 / 打出 token | 96 / 96 | effect.zone, target.location | 高 | 需 Token 定义及被引用的 Token 能力依赖 |
| effect / effect.attach: 装备附着 / 重附着 | 64 / 65 | target.filter, target.location | 高 | 附着目标、控制权、脱离与持续效果 |
| effect / effect.detach: 脱离装备 | 3 / 3 | effect.attach | 中 | 独立于杀死装备 |
| effect / effect.play: 从区域打出卡 / 获得打出许可 | 99 / 99 | effect.zone, cost.printed, continuous.timing | 高 | 嵌套打出与忽略费用的边界 |
| effect / effect.recycle: recycle 回收 | 67 / 73 | effect.zone | 中 | 区域、顺序和卡库底部 |
| effect / effect.banish: banish 放逐 | 28 / 28 | effect.zone | 中 | 后续指向被放逐对象的链接 |
| effect / effect.reveal: 展示信息 | 27 / 30 | target.query | 中 | 谁可见与展示有效期 |
| effect / effect.inspect: 查看 / 搜索卡库 | 40 / 40 | target.query | 中 | 私有选项、范围和失败查询 |
| effect / effect.order: 排序 / 放回牌库 | 16 / 16 | effect.zone, choice.order | 中 | 顶部 / 底部顺序 |
| effect / effect.shuffle: 洗牌 | 0 / 0 | effect.zone | 中 | 由内核确定性随机源驱动 |
| effect / effect.mill: Burn / 卡库到弃牌区 | 8 / 8 | effect.zone | 中 | 烧牌及后续 that-card 绑定 |
| effect / effect.buff: Buff 标记的添加 / 消耗 | 53 / 53 | continuous.might, condition.predicate | 中 | 与临时 Might 修改分开 |
| effect / effect.xp: 获得 XP | 29 / 29 | 无 | 低 | 玩家 XP 资源 |
| effect / effect.empower: Empower / Disempower 状态 | 53 / 53 | condition.predicate | 高 | 新关键字须核验 v1.5 |
| effect / effect.score: 得分 | 22 / 22 | target.player | 高 | 最后一分、计分窗口与替代 |
| effect / effect.win: 直接胜负条件 | 3 / 3 | condition.predicate | 高 | 与得分胜利分开 |
| effect / effect.control: 改变控制权 | 7 / 7 | target.query, continuous.duration | 高 | 拥有者、结束条件与回归 |
| effect / effect.counter: 反制链上 spell / ability | 14 / 14 | target.query | 高 | 反制合法性与费用不退 |
| effect / effect.copy: 复制对象 / 效果 | 6 / 6 | target.query, continuous.duration | 高 | 复制层、例外与原对象引用 |
| effect / effect.repeat: 重复 spell 效果 | 25 / 25 | choice.mode | 高 | 重选目标与重复不是重打卡 |
| effect / effect.stun: Stun 状态 | 33 / 33 | continuous.combat, continuous.duration | 中 | 伤害限制与状态有效期 |
| trigger / trigger.play: 打出自身 / 其他卡触发 | 255 / 255 | 无 | 高 | play、enter 和源对象身份分开 |
| trigger / trigger.leave: 死亡 / 离场 / Deathknell | 47 / 47 | 无 | 高 | 最后已知信息与同时事件 |
| trigger / trigger.combat: 攻击 / 防守 / 战斗胜负触发 | 68 / 68 | 无 | 高 | 参与战斗和取得 attacker designation 的差别 |
| trigger / trigger.score: Hold / Conquer / 计分触发 | 105 / 105 | 无 | 高 | Hold 是触发事件，此目录不是 [Hold] 关键字 |
| trigger / trigger.phase: 阶段开始 / 回合结束触发 | 53 / 53 | 无 | 高 | before scoring、next 与控制者 |
| trigger / trigger.move: 移动触发 | 51 / 51 | 无 | 高 | 移动成功、次数与不同来源 |
| trigger / trigger.state: 状态改变 / 其余事件触发 | 420 / 420 | 无 | 高 | 事件过滤、同时触发和观察窗口 |
| trigger / trigger.delayed: 延迟触发注册 | 2 / 2 | trigger.phase, continuous.duration | 高 | 触发源离场后是否仍存在 |
| replacement / replacement.enter: 入场 ready / exhausted | 71 / 71 | 无 | 高 | 加速成本与入场替代绑定 |
| replacement / replacement.event: would / instead 事件替代 | 43 / 43 | condition.predicate | 高 | 句法 instead 可能仅为条件分支，需人工判断 |
| replacement / replacement.prevent: 防伤 / 防死亡 | 5 / 5 | condition.predicate | 高 | 与禁止分配战斗伤害分开 |
| continuous / continuous.might: Might 加减 / 设值 / 倍增 | 267 / 311 | target.query, continuous.duration | 中 | Assault / Shield、层次及动态取值 |
| continuous / continuous.keyword: 授予 / 移除能力或标签 | 0 / 0 | target.query, continuous.duration | 高 | 引用关键词不等于拥有该关键词 |
| continuous / continuous.duration: 效果持续时间 / 清理 | 245 / 424 | 无 | 高 | 本回合、持续直到和源对象存续 |
| continuous / continuous.timing: Action / Reaction / Ambush 时机 | 231 / 337 | 无 | 高 | 整卡时机与授予的激活能力时机不同 |
| continuous / continuous.movement: Ganking / 移动许可和限制 | 67 / 67 | target.location | 高 | 战场到战场和基地权限 |
| continuous / continuous.combat: 战斗伤害限制 / Tank / Backline | 44 / 76 | target.query | 高 | 指派顺序、must 与 cannot |
| continuous / continuous.restrict: 一般许可 / 禁止 / 数量限制 | 64 / 64 | condition.predicate | 高 | 禁止优先级、每回合上限和例外 |
| continuous / continuous.suppress: 抑制触发 / 能力失去 | 1 / 1 | target.query | 高 | 特定 Temporary 抑制或泛用失去能力 |
| continuous / continuous.location: Deploy 等入场地点许可 | 22 / 22 | target.location | 高 | Gear 入场地点与移动许可分开 |
| continuous / continuous.deck: Unique / 同名构筑限制 | 4 / 4 | 无 | 中 | 构筑期语义也属于整卡覆盖 |
| condition / condition.predicate: 条件 / 布尔 / 逻辑分支 | 360 / 445 | 无 | 中 | 谓词求值时间与 if-do 记录分开 |
| condition / condition.value: 动态数值 / 阈值 / X / 指代 | 295 / 305 | target.query | 高 | 取值时机、null、Last Known Information |
| condition / condition.history: 本回合 / 次数 / Flow / Legion 历史 | 83 / 83 | 无 | 高 | 事件历史范围和 once / first / third |
| condition / condition.result: if-do / paid / this-way 结果绑定 | 46 / 46 | condition.predicate | 高 | 费用凭证和效果结果可追踪 |
| choice / choice.optional: may 可选执行 | 279 / 279 | 无 | 中 | 谁选择、拒绝路径与信息可见性 |
| choice / choice.mode: 模式 / or / 分支选择 | 169 / 194 | 无 | 中 | one / two / different 和复合费用 or |
| choice / choice.order: 牌序 / 多事件排序 | 1 / 16 | 无 | 高 | 顺序由玩家选择与规则决定的区别 |

Token 能力、复制目标的能力、授予任意引用能力等动态依赖不能由这些静态边完全证明；上述 effect.token / effect.copy / continuous.keyword 只是静态规划族。批量编卡时必须对引用到的 Token 定义、被授予宏、动态闭包继续做验证，未闭合时阻断。

## 5. 按覆盖收益的实现路线与累积曲线


规划公式：C(S) = 当前无资料阻断且 requiredPrimitives ⊆ S 的身份数。分母固定 1080；无能力卡也要求基础内核和正常费用。先实现基础内核（官方开局 / 回合 / 战斗 / 计分、状态和事件、HOT FEPR、隐藏投影、确定性随机和 command journal），这些不作为免费已实现效果；曲线仅估算其后的卡效工作。**所有步骤均假设完整语义复核、IR 编写与每卡 golden 通过；没有这些前提，实际新增可执行数仍是 0。**

排序用“完成整卡所需原语包”的贪心：枚举尚未闭合卡的缺失依赖包，最大化 `新闭合身份数 / 新增原语数`；同分按新增身份、估计难度（低 1 / 中 2 / 高 3）、ID 破同分，再按依赖拓扑逐原语落点。这避免只有最后一块原语才有收益的互补问题，但**不是全局最优，也不是工期估算**。每个原语权重 1 的曲线会偏向通用模块，难度只用于同分。

| 目标 | 需要身份 | 达到时原语数 | 规划闭合身份 | 说明 |
| --- | --- | --- | --- | --- |
| 30% | 324 | 32 | 325 (30.09%) | 仅静态需求上界 |
| 70% | 756 | 53 | 756 (70%) | 仅静态需求上界 |
| 95% | 1026 | 不可达 | 933 (86.39%) | 当前资料 / 未识别阻断限制；先处理剩余 147 个身份 |

**30% 的累计原语集合**（前 32 项）：

`cost.printed`、`cost.activated`、`cost.pay`、`target.query`、`target.filter`、`target.location`、`effect.attach`、`condition.predicate`、`continuous.combat`、`continuous.duration`、`continuous.might`、`continuous.timing`、`effect.damage`、`target.many`、`choice.mode`、`condition.value`、`cost.modify`、`effect.zone`、`effect.draw`、`trigger.play`、`trigger.state`、`trigger.combat`、`effect.ready`、`replacement.enter`、`condition.history`、`continuous.movement`、`continuous.restrict`、`effect.move`、`cost.exhaust`、`effect.empower`、`target.tax`、`choice.optional`。

**70% 的累计原语集合**（前 53 项）：

`cost.printed`、`cost.activated`、`cost.pay`、`target.query`、`target.filter`、`target.location`、`effect.attach`、`condition.predicate`、`continuous.combat`、`continuous.duration`、`continuous.might`、`continuous.timing`、`effect.damage`、`target.many`、`choice.mode`、`condition.value`、`cost.modify`、`effect.zone`、`effect.draw`、`trigger.play`、`trigger.state`、`trigger.combat`、`effect.ready`、`replacement.enter`、`condition.history`、`continuous.movement`、`continuous.restrict`、`effect.move`、`cost.exhaust`、`effect.empower`、`target.tax`、`choice.optional`、`effect.exhaust`、`effect.play`、`effect.token`、`trigger.score`、`effect.buff`、`cost.hidden`、`effect.kill`、`trigger.phase`、`cost.additional`、`trigger.move`、`effect.resources`、`trigger.leave`、`effect.stun`、`target.player`、`effect.channel`、`condition.result`、`cost.sacrifice`、`replacement.event`、`continuous.location`、`effect.discard`、`effect.repeat`。

**95% 的累计原语集合**（现有候选全部实现仍未达到）：

`cost.printed`、`cost.activated`、`cost.pay`、`target.query`、`target.filter`、`target.location`、`effect.attach`、`condition.predicate`、`continuous.combat`、`continuous.duration`、`continuous.might`、`continuous.timing`、`effect.damage`、`target.many`、`choice.mode`、`condition.value`、`cost.modify`、`effect.zone`、`effect.draw`、`trigger.play`、`trigger.state`、`trigger.combat`、`effect.ready`、`replacement.enter`、`condition.history`、`continuous.movement`、`continuous.restrict`、`effect.move`、`cost.exhaust`、`effect.empower`、`target.tax`、`choice.optional`、`effect.exhaust`、`effect.play`、`effect.token`、`trigger.score`、`effect.buff`、`cost.hidden`、`effect.kill`、`trigger.phase`、`cost.additional`、`trigger.move`、`effect.resources`、`trigger.leave`、`effect.stun`、`target.player`、`effect.channel`、`condition.result`、`cost.sacrifice`、`replacement.event`、`continuous.location`、`effect.discard`、`effect.repeat`、`effect.score`、`effect.xp`、`effect.banish`、`effect.inspect`、`effect.recycle`、`effect.reveal`、`cost.xp`、`cost.discard`、`cost.recycle`、`effect.counter`、`choice.order`、`effect.order`、`effect.mill`、`effect.copy`、`continuous.deck`、`effect.heal`、`effect.control`、`effect.win`、`replacement.prevent`、`effect.detach`、`cost.reveal`、`continuous.suppress`、`trigger.delayed`。

| N | 新增原语 | 新增闭合身份 | 累计身份 | 占 1080 |
| --- | --- | --- | --- | --- |
| 0 | (基础内核前提下的空需求) | 0 | 0 | 0% |
| 1 | cost.printed | 10 | 10 | 0.93% |
| 2 | cost.activated | 0 | 10 | 0.93% |
| 3 | cost.pay | 0 | 10 | 0.93% |
| 4 | target.query | 0 | 10 | 0.93% |
| 5 | target.filter | 0 | 10 | 0.93% |
| 6 | target.location | 0 | 10 | 0.93% |
| 7 | effect.attach | 26 | 36 | 3.33% |
| 8 | condition.predicate | 0 | 36 | 3.33% |
| 9 | continuous.combat | 2 | 38 | 3.52% |
| 10 | continuous.duration | 0 | 38 | 3.52% |
| 11 | continuous.might | 22 | 60 | 5.56% |
| 12 | continuous.timing | 11 | 71 | 6.57% |
| 13 | effect.damage | 8 | 79 | 7.31% |
| 14 | target.many | 10 | 89 | 8.24% |
| 15 | choice.mode | 1 | 90 | 8.33% |
| 16 | condition.value | 9 | 99 | 9.17% |
| 17 | cost.modify | 8 | 107 | 9.91% |
| 18 | effect.zone | 8 | 115 | 10.65% |
| 19 | effect.draw | 9 | 124 | 11.48% |
| 20 | trigger.play | 3 | 127 | 11.76% |
| 21 | trigger.state | 31 | 158 | 14.63% |
| 22 | trigger.combat | 17 | 175 | 16.2% |
| 23 | effect.ready | 15 | 190 | 17.59% |
| 24 | replacement.enter | 16 | 206 | 19.07% |
| 25 | condition.history | 15 | 221 | 20.46% |
| 26 | continuous.movement | 9 | 230 | 21.3% |
| 27 | continuous.restrict | 12 | 242 | 22.41% |
| 28 | effect.move | 19 | 261 | 24.17% |
| 29 | cost.exhaust | 14 | 275 | 25.46% |
| 30 | effect.empower | 16 | 291 | 26.94% |
| 31 | target.tax | 20 | 311 | 28.8% |
| 32 | choice.optional | 14 | 325 | 30.09% |
| 33 | effect.exhaust | 12 | 337 | 31.2% |
| 34 | effect.play | 17 | 354 | 32.78% |
| 35 | effect.token | 19 | 373 | 34.54% |
| 36 | trigger.score | 24 | 397 | 36.76% |
| 37 | effect.buff | 25 | 422 | 39.07% |
| 38 | cost.hidden | 22 | 444 | 41.11% |
| 39 | effect.kill | 22 | 466 | 43.15% |
| 40 | trigger.phase | 23 | 489 | 45.28% |
| 41 | cost.additional | 20 | 509 | 47.13% |
| 42 | trigger.move | 26 | 535 | 49.54% |
| 43 | effect.resources | 25 | 560 | 51.85% |
| 44 | trigger.leave | 22 | 582 | 53.89% |
| 45 | effect.stun | 19 | 601 | 55.65% |
| 46 | target.player | 22 | 623 | 57.69% |
| 47 | effect.channel | 20 | 643 | 59.54% |
| 48 | condition.result | 18 | 661 | 61.2% |
| 49 | cost.sacrifice | 20 | 681 | 63.06% |
| 50 | replacement.event | 19 | 700 | 64.81% |
| 51 | continuous.location | 18 | 718 | 66.48% |
| 52 | effect.discard | 19 | 737 | 68.24% |
| 53 | effect.repeat | 19 | 756 | 70% |
| 54 | effect.score | 16 | 772 | 71.48% |
| 55 | effect.xp | 16 | 788 | 72.96% |
| 56 | effect.banish | 15 | 803 | 74.35% |
| 57 | effect.inspect | 2 | 805 | 74.54% |
| 58 | effect.recycle | 24 | 829 | 76.76% |
| 59 | effect.reveal | 18 | 847 | 78.43% |
| 60 | cost.xp | 10 | 857 | 79.35% |
| 61 | cost.discard | 9 | 866 | 80.19% |
| 62 | cost.recycle | 8 | 874 | 80.93% |
| 63 | effect.counter | 8 | 882 | 81.67% |
| 64 | choice.order | 0 | 882 | 81.67% |
| 65 | effect.order | 15 | 897 | 83.06% |
| 66 | effect.mill | 7 | 904 | 83.7% |
| 67 | effect.copy | 5 | 909 | 84.17% |
| 68 | continuous.deck | 4 | 913 | 84.54% |
| 69 | effect.heal | 4 | 917 | 84.91% |
| 70 | effect.control | 4 | 921 | 85.28% |
| 71 | effect.win | 3 | 924 | 85.56% |
| 72 | replacement.prevent | 3 | 927 | 85.83% |
| 73 | effect.detach | 2 | 929 | 86.02% |
| 74 | cost.reveal | 2 | 931 | 86.2% |
| 75 | continuous.suppress | 1 | 932 | 86.3% |
| 76 | trigger.delayed | 1 | 933 | 86.39% |

候选曲线天花板：933/1080 = 86.39%。未进入候选路线的原语：effect.shuffle, continuous.keyword。完整按包收益及逐原语曲线在 JSON 的 implementationPlan；不得把粗略“出现过这个动词”统计直接解释为可执行整卡。

建议父任务顺序：先冻结目标 / 值表达式 / 费用承诺 / 事件 / 持续时间 / 隐藏选择的公共表示，再按上表原语包实施及编卡；30% / 70% 阶段都以整卡 golden 闭合验收；95% 若被资料问题阻挡，先核对下节差异与残句，再新增经过规则证据证明的原语。禁止为了达到比例把未识别句忽略或当 no-op。

## 6. 现有 opcode 与 description 可复用部分


`packages/card-dsl/src/index.ts:860` 的 EffectOpcode 只有四项，参数表在 `:885`；它们来自 synthetic-demo IR，存在类型不代表当前官方卡通过编译。下表关联卡数是本报告需求的重叠线索数，绝不是四个 opcode 已覆盖的卡数。

| 已有 opcode | 对应规划原语 | 需求关联身份 | 可复用 / 缺口 |
| --- | --- | --- | --- |
| draw.cards | effect.draw | 154 | 固定整数 count；不含条件、触发、牌库选择 · packages/card-dsl/src/index.ts:861 |
| damage.target | effect.damage | 99 | 固定整数 amount / targetId；不含动态 Might、分摊、防伤 · packages/card-dsl/src/index.ts:862 |
| gain.energy | effect.resources | 45 | 整数 Energy + player；不含 Power 域 / 符文 channel · packages/card-dsl/src/index.ts:863 |
| summon.self | effect.play | 99 | synthetic-demo 的 summon.self；官方 Unit 打出与 token 创建不能直接等同 · packages/card-dsl/src/index.ts:864 |

九个 description 以**当前源码临时编译后逐印刷调用**统计，只有返回 status=known 才计；不把关键词子串当 whole-ability known。身份列按任意印刷 known 去重，主印刷列更严格；没有修改 registry，也没有授予执行权。其规则依据多为 CR v1.4，复用前仍须核验 v1.5。

| description / 源码 | known 印刷 / 身份 / 主印刷身份 | 对应原语 |
| --- | --- | --- |
| assault · packages/card-dsl/src/duel/assault-description-v1.ts:342 | 4 / 3 / 3 | continuous.might, condition.predicate |
| shield · packages/card-dsl/src/duel/shield-description-v1.ts:434 | 2 / 2 / 2 | continuous.might, condition.predicate |
| accelerate · packages/card-dsl/src/duel/optional-play-cost-v1.ts:375 | 2 / 2 / 2 | cost.additional, cost.pay, replacement.enter |
| temporary · packages/card-dsl/src/duel/temporary-description-v1.ts:437 | 2 / 1 / 1 | trigger.phase, effect.kill |
| hold-score · packages/card-dsl/src/duel/hold-score-description-v1.ts:493 | 2 / 1 / 1 | trigger.score, effect.score |
| attack-might-damage · packages/card-dsl/src/duel/attack-might-damage-description-v1.ts:475 | 2 / 1 / 1 | trigger.combat, condition.value, effect.damage |
| beginning-draw · packages/card-dsl/src/duel/beginning-draw-description-v1.ts:487 | 3 / 1 / 1 | trigger.phase, effect.draw |
| equip · packages/card-dsl/src/duel/equip-description-v1.ts:604 | 28 / 28 / 28 | cost.activated, effect.attach |
| point-damage · packages/card-dsl/src/duel/point-damage-description-v1.ts:181 | 4 / 4 / 4 | effect.damage, target.query |

description known 身份并集为 43（行间有重叠可能，不相加）。 `packages/card-dsl/src/duel/ability-bindings.ts:53` 另有 Ganking 字面绑定；它也不是完整卡程序覆盖。JSON existing.descriptions 给出全部 known 印刷 / 身份及 unknown 原因直方图，便于后续按原文复用。

## 7. 未归类、数据问题与规则待决


以下列表是所有未归类身份的显式阻断原因。未列出的 lexical-candidate 也有句法误判风险；尤其 Trigger 作用域、grant 与 query、费用 / 效果、instead 条件分支 / 替代、同名 / Token 动态能力不可自动定论。`requiresV15RuleReview` 不参与乐观曲线过滤，否则所有官方卡都应继续阻断；真实运行必须核验它。

| 身份 / 主印刷 | 阻断原因 | 残句（若有） / 出处 |
| --- | --- | --- |
| Time Warp (ogn-122-298) | unmatched-functional-clause | Take a turn after this one. · packages/card-data/data/deck-catalog.json:3086 |
| Yasuo, Windrider (ogn-205-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:5150 |
| Angle Shot (sfd-011-221) | unmatched-functional-clause | Choose a unit and an Equipment with the same controller. · packages/card-data/data/deck-catalog.json:13014 |
| Wind and Ghosts (ven-106-166) | unmatched-functional-clause | Choose a unit at a battlefield. · packages/card-data/data/deck-catalog.json:28611 |
| Stormbringer, Volibear (ogn-250-298) | unmatched-functional-clause | Choose a friendly unit in your base. · packages/card-data/data/deck-catalog.json:6314 |
| Guerilla Warfare, Teemo (ogn-264-298) | unmatched-functional-clause | You can hide cards ignoring costs this turn. · packages/card-data/data/deck-catalog.json:6656 |
| Rengar, Pouncing (sfd-025-221) | unmatched-functional-clause | I can be played to a battlefield you're attacking. · packages/card-data/data/deck-catalog.json:13359 |
| Rally for War (rad-007-167) | unmatched-functional-clause | Choose an occupied enemy battlefield. · packages/card-data/data/deck-catalog.json:8651 |
| Arachnoid Horror (unl-117-219) | unmatched-functional-clause | I can be played to an occupied battlefield if an enemy unit is alone there. / Friendly units can be played to an occupied battlefield if an enemy unit is alone there. · packages/card-data/data/deck-catalog.json:22459 |
| Mirror Image (unl-200-219) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:24679 |
| Possession (ogn-203-298) | unmatched-functional-clause | Choose an enemy unit at a battlefield. · packages/card-data/data/deck-catalog.json:5104 |
| Call to Battle (unl-101-219) | unmatched-functional-clause | Then, choose an opponent. · packages/card-data/data/deck-catalog.json:22041 |
| Conscription (unl-140-219) | unmatched-functional-clause | Choose an enemy unit at a battlefield with 3 :rb_might: or less. · packages/card-data/data/deck-catalog.json:23033 |
| Iron Revenant (rad-143-167) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:11511 |
| Viktor, Innovator (ogn-117-298) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:2891 |
| Challenge (ogn-128-298) | unmatched-functional-clause | Choose a friendly unit and an enemy unit. · packages/card-data/data/deck-catalog.json:3232 |
| Gentlemen's Duel (ogs-008-024) | unmatched-functional-clause | Then choose an enemy unit. · packages/card-data/data/deck-catalog.json:8115 |
| Void Burrower (sfd-187-221) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:17636 |
| Yone, Blademaster (rad-181-167) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:12313 |
| Nasus, Ascended (ven-046-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:27115 |
| Draven, Showboat (ogn-028-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:665 |
| Command: Attack (rad-033-167) | unmatched-functional-clause | Choose one — · packages/card-data/data/deck-catalog.json:9173 |
| Nasus, Guardian of Knowledge (ven-063-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:27507 |
| Repulse (unl-106-219) | unmatched-functional-clause | Choose a friendly unit at a battlefield. · packages/card-data/data/deck-catalog.json:22148 |
| Friendship (unl-046-219) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:20549 |
| Encore (rad-152-167) | unmatched-functional-clause | Choose two — · packages/card-data/data/deck-catalog.json:11702 |
| Forge of the Fluft (sfd-208-221) | unmatched-functional-clause | " · packages/card-data/data/deck-catalog.json:18127 |
| Improvised Projectile (rad-056-167) | unmatched-functional-clause | Choose a friendly gear. · packages/card-data/data/deck-catalog.json:9617 |
| Riven, Shattered (ven-041-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:26971 |
| Dancing Grenade (unl-020-219) | unmatched-functional-clause | Its controller may play this spell again for :rb_rune_rainbow:. · packages/card-data/data/deck-catalog.json:19835 |
| Curtain Call (unl-182-219) | unmatched-functional-clause | Choose one you haven't already chosen — · packages/card-data/data/deck-catalog.json:24253 |
| Lotus Trap (unl-013-219) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:19688 |
| Renekton, Rage Fueled (ven-019-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:26378 |
| Swain, Visionary (ven-065-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:27583 |
| Ivern, Friend to All (unl-177-219) | unmatched-functional-clause | As you play me, choose Bird, Cat, Dog, or Poro. / I gain that tag. · packages/card-data/data/deck-catalog.json:24062 |
| The List (unl-138-219) | unmatched-functional-clause | As you play this, name a tag. · packages/card-data/data/deck-catalog.json:22993 |
| Riven, Deserter (rad-114-167) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:10859 |
| Cataclysmic Duel (ven-090-166) | unmatched-functional-clause | Each player chooses a unit they control. · packages/card-data/data/deck-catalog.json:28233 |
| Bandle Tree (ogn-278-298) | unmatched-functional-clause | You may hide an additional card here. · packages/card-data/data/deck-catalog.json:6975 |
| Party Favors (ogn-071-298) | unmatched-functional-clause | Each other player chooses Cards or Runes. · packages/card-data/data/deck-catalog.json:1740 |
| Bone Skewer (unl-139-219) | unmatched-functional-clause | Choose a battlefield. / An opponent reveals their hand. / You may choose a unit from it. / They play that unit to that battlefield, ignoring any and all costs. · packages/card-data/data/deck-catalog.json:23013 |
| Zed, Without a Sound (ven-112-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28776 |
| Leona, Determined (ogn-238-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:5924 |
| Blind Fury (ogn-025-298) | unmatched-functional-clause | Each opponent reveals the top card of their Main Deck. · packages/card-data/data/deck-catalog.json:563 |
| Dragon's Rage, Lee Sin (ogn-258-298) | unmatched-functional-clause | Then choose another enemy unit at its destination. · packages/card-data/data/deck-catalog.json:6509 |
| Teemo, Strategist (ogn-121-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:3039 |
| Kai'Sa, Survivor (ogn-039-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:949 |
| Alpha Strike (unl-192-219) | unmatched-functional-clause | Choose a friendly unit. · packages/card-data/data/deck-catalog.json:24489 |
| Gold (sfd-t03) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:19411 |
| Highlander, Yi (ogs-020-024) | unmatched-functional-clause | Choose a friendly unit. · packages/card-data/data/deck-catalog.json:8407 |
| Karma, Channeler (ogn-235-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:5851 |
| Jayce, Brilliant Inventor (ven-068-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:27649 |
| Smoke and Mirrors (unl-083-219) | unmatched-functional-clause | Choose a unit you control and another unit you control at a different location. · packages/card-data/data/deck-catalog.json:21569 |
| Morgana, Vindictive (ven-017-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:26332 |
| Unforgiven (ogn-259-298) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:6532 |
| Twisted Fate, Gambler (ogn-200-298) | unmatched-functional-clause | Do one of the following based on its domain: · packages/card-data/data/deck-catalog.json:5012 |
| Kennen, Keeper of Balance (ven-135-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:29346 |
| Convergent Mutation (ogn-108-298) | unmatched-functional-clause | Choose a friendly unit. / This turn, increase its Might to the Might of another friendly unit. · packages/card-data/data/deck-catalog.json:2646 |
| Riposte (sfd-206-221) | unmatched-functional-clause | Choose a friendly unit and a spell. · packages/card-data/data/deck-catalog.json:18087 |
| Tactical Retreat (unl-175-219) | unmatched-functional-clause | Choose a friendly unit. · packages/card-data/data/deck-catalog.json:23984 |
| Lux, Crownguard (ogs-014-024) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:8260 |
| Miss Fortune, Buccaneer (ogn-193-298) | unmatched-functional-clause | Friendly units may be played to open battlefields. · packages/card-data/data/deck-catalog.json:4792 |
| Mesmerize (ven-052-166) | unmatched-functional-clause | Choose one — · packages/card-data/data/deck-catalog.json:27268 |
| Marching Orders (sfd-114-221) | unmatched-functional-clause | Choose a friendly unit anywhere and an enemy unit at a battlefield. · packages/card-data/data/deck-catalog.json:15720 |
| Rengar, Trophy Hunter (unl-120-219) | unmatched-functional-clause, non-reminder-printing-difference | I can be played to a battlefield where there are enemy units                                     . · packages/card-data/data/deck-catalog.json:22583 |
| Akali, Deadly Weapon (ven-021-166) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:26451 |
| Bushwhack Trap (rad-108-167) | unmatched-functional-clause | While you or an ally control this battlefield, that player may hide an additional card here. · packages/card-data/data/deck-catalog.json:10683 |
| Sett, Brawler (ogn-164-298) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:4116 |
| Renekton, Brute (ven-092-166) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28282 |
| Mel, Newly Awakened (ven-069-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:27700 |
| Black Market (rad-158-167) | unmatched-functional-clause | Each player may use this ability once on their turn                                              . · packages/card-data/data/deck-catalog.json:11837 |
| For Demacia! (rad-117-167) | unmatched-functional-clause | Choose a battlefield. · packages/card-data/data/deck-catalog.json:10946 |
| Seat of Power (sfd-217-221) | unmatched-functional-clause | . · packages/card-data/data/deck-catalog.json:18307 |
| Neeko, Blending In (rad-167-167) | unmatched-functional-clause | If Neeko is in your deck, choose 3 different legends in addition to your starting legend. · packages/card-data/data/deck-catalog.json:12023 |
| Aphelios, Exalted (rad-179-167) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:12260 |
| Herald of Scales (ogn-140-298) | unmatched-functional-clause | Your Dragons' Energy costs are reduced by :rb_energy_2:, to a minimum of :rb_energy_1:. · packages/card-data/data/deck-catalog.json:3493 |
| Curator of the Sands (ven-145-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:29661 |
| Lacerate (ven-127-166) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:29162 |
| Riven, Broken Blade (rad-043-167) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:9362 |
| Sky Splitter (ogn-014-298) | unmatched-functional-clause | This spell's Energy cost is reduced by the highest Might among units you control. · packages/card-data/data/deck-catalog.json:328 |
| Hextech Gauntlets (unl-188-219) | unmatched-functional-clause | This ability's Energy cost is reduced by the Might of the unit you choose. · packages/card-data/data/deck-catalog.json:24395 |
| Emperor of the Sands (sfd-197-221) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:17875 |
| Dominus (ven-142-166) | unmatched-functional-clause | " · packages/card-data/data/deck-catalog.json:29591 |
| Rampage (ven-083-166) | unmatched-functional-clause | Choose a friendly unit and an enemy unit. · packages/card-data/data/deck-catalog.json:28025 |
| Kai'Sa, Rebel (rad-063-167) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:9799 |
| Call to Glory (ogn-207-298) | unmatched-functional-clause | If you do, ignore this spell's cost. · packages/card-data/data/deck-catalog.json:5216 |
| Clash of Giants (unl-110-219) | unmatched-functional-clause | Choose two units. · packages/card-data/data/deck-catalog.json:22230 |
| Decree of Strength (ven-085-166) | unmatched-functional-clause | Choose an opponent. · packages/card-data/data/deck-catalog.json:28096 |
| Illaoi, Prophet of the Great Kraken (ven-109-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28677 |
| Mel, Defiant Soul (ven-110-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28703 |
| Dragon Form (ven-116-166) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:28920 |
| Boy Who Shattered Time (rad-139-167) | unmatched-functional-clause | " · packages/card-data/data/deck-catalog.json:11416 |
| Divine Judgment (ogn-244-298) | unmatched-functional-clause | Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their hands. · packages/card-data/data/deck-catalog.json:6144 |
| Disposal Order (unl-103-219) | unmatched-functional-clause | Choose one — / Choose up to 3 cards from opponents' trashes. · packages/card-data/data/deck-catalog.json:22083 |
| Vayne, Hunter (ogn-035-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:852 |
| Flurry of Feathers (unl-044-219) | unmatched-functional-clause | Choose one — · packages/card-data/data/deck-catalog.json:20509 |
| Stare Down (unl-107-219) | unmatched-functional-clause | Choose a friendly unit and a battlefield. · packages/card-data/data/deck-catalog.json:22168 |
| Scrutinizing Scope (rad-064-167) | unmatched-functional-clause | They guess a card type. · packages/card-data/data/deck-catalog.json:9819 |
| Rocket Barrage (sfd-077-221) | unmatched-functional-clause | Choose one — · packages/card-data/data/deck-catalog.json:14721 |
| King's Edict (ogn-237-298) | unmatched-functional-clause | Starting with the next player, each other player chooses a unit you don't control that hasn't been chosen for this spell. · packages/card-data/data/deck-catalog.json:5898 |
| Gangplank, Naval (ven-086-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28122 |
| Heartening Soul (rad-040-167) | unmatched-functional-clause | " · packages/card-data/data/deck-catalog.json:9319 |
| Shakedown (ogn-033-298) | unmatched-functional-clause | Choose an enemy unit. · packages/card-data/data/deck-catalog.json:800 |
| Shen, Scourge of Shadows (ven-042-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:26997 |
| Kayle, Justified (ven-134-166) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:29319 |
| Switcheroo (sfd-145-221) | unmatched-functional-clause | Swap the Might of two units at the same battlefield this turn. · packages/card-data/data/deck-catalog.json:16521 |
| Vi, Destructive (ogn-036-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:878 |
| XP Tracker (unl-t08) | unmatched-functional-clause | Track gained XP here. / Some cards can spend XP for powerful effects. · packages/card-data/data/deck-catalog.json:25961 |
| Public Execution (ven-154-166) | unmatched-functional-clause | Choose a friendly unit. · packages/card-data/data/deck-catalog.json:29873 |
| Demon Shade (rad-102-167) | unmatched-functional-clause | Choose a friendly unit, then choose one — · packages/card-data/data/deck-catalog.json:10599 |
| Counter Strike (sfd-194-221) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:17805 |
| Ahri, Inquisitive (ogn-119-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:2966 |
| Ki Barrier (ven-126-166) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:29142 |
| Noxian Guillotine, Darius (ogn-254-298) | unmatched-functional-clause | Choose a unit. · packages/card-data/data/deck-catalog.json:6411 |
| Insightful Investigator (unl-135-219) | unmatched-functional-clause | You may pay 2 XP to choose a card from their hand. · packages/card-data/data/deck-catalog.json:22930 |
| Jayce, Hammer in Hand (ven-088-166) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28168 |
| Akali, Silent (ven-038-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:26880 |
| Sanction (ven-035-166) | unmatched-functional-clause | Choose one — · packages/card-data/data/deck-catalog.json:26810 |
| Red Brambleback (unl-029-219) | unmatched-functional-clause, printing-stat-type-or-tag-difference | Your conquer effects for conquering here trigger an additional time. · packages/card-data/data/deck-catalog.json:20135 |
| Blue Sentinel (unl-087-219) | unmatched-functional-clause, printing-stat-type-or-tag-difference | Your hold effects for holding here trigger an additional time. · packages/card-data/data/deck-catalog.json:21660 |
| Relentless Pursuit (sfd-184-221) | unmatched-functional-clause | " · packages/card-data/data/deck-catalog.json:17565 |
| Wallop (ogn-146-298) | unmatched-functional-clause | If you do, ignore this spell's cost. · packages/card-data/data/deck-catalog.json:3617 |
| Siphon Power, Viktor (ogn-266-298) | unmatched-functional-clause | Choose a battlefield. · packages/card-data/data/deck-catalog.json:6705 |
| Zed, From the Shadows (ven-023-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:26522 |
| Promising Future (ogn-115-298) | unmatched-functional-clause | Each player looks at the top 5 cards of their Main Deck, chooses one, then recycles the rest. / Starting with the next player, each player plays those cards, ignoring Energy costs. · packages/card-data/data/deck-catalog.json:2843 |
| Chem-Baroness (sfd-201-221) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:17969 |
| Sona, Harmonious (ogn-073-298) | non-reminder-printing-difference, printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:1786 |
| Rousing Display (rad-127-167) | unmatched-functional-clause, corrupt-source-tail | disa · packages/card-data/data/deck-catalog.json:11108 |
| Moonfall (unl-198-219) | unmatched-functional-clause | Choose a battlefield where you have units. · packages/card-data/data/deck-catalog.json:24632 |
| Eager Apprentice (ogn-084-298) | unmatched-functional-clause | While I'm at a battlefield, the Energy costs for spells you play is reduced by :rb_energy_1:, to a minimum of :rb_energy_1:. · packages/card-data/data/deck-catalog.json:2116 |
| Decree of Focus (ven-040-166) | unmatched-functional-clause | Choose a friendly unit that's in combat with an enemy Fury                  unit or that's being chosen by an enemy Fury spell. · packages/card-data/data/deck-catalog.json:26945 |
| Darius, Executioner (ogn-243-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:6097 |
| Ambessa, The Wolf (ven-084-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28051 |
| Ambessa, Respected and Feared (ven-136-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:29398 |
| Gardens of Becoming (unl-213-219) | unmatched-functional-clause | " · packages/card-data/data/deck-catalog.json:24953 |
| Mystic Reversal (ogn-080-298) | unmatched-functional-clause | You may make new choices for it. · packages/card-data/data/deck-catalog.json:2031 |
| Lonely Poro (sfd-036-221) | non-reminder-printing-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:13695 |
| Jinx, Demolitionist (ogn-030-298) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:711 |
| Lost to the Sands (rad-013-167) | unmatched-functional-clause | Choose one — · packages/card-data/data/deck-catalog.json:8729 |
| Sabotage (ogn-156-298) | unmatched-functional-clause | Choose an opponent. · packages/card-data/data/deck-catalog.json:3869 |
| Last Caress (rad-154-167) | unmatched-functional-clause | The next unit you play this turn                       can be played to any battlefield. · packages/card-data/data/deck-catalog.json:11749 |
| Baron Nashor (unl-147-219) | unmatched-functional-clause | If you do, I enter there. · packages/card-data/data/deck-catalog.json:23253 |
| Elder Dragon (unl-118-219) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:22482 |
| Crescent Strike (unl-072-219) | unmatched-functional-clause | Choose a battlefield and an enemy unit there. · packages/card-data/data/deck-catalog.json:21267 |
| Kennen, Storm of Shuriken (ven-113-166) | printing-stat-type-or-tag-difference | 见 printingDifferences 或畸形尾部 · packages/card-data/data/deck-catalog.json:28827 |
| Keeper's Verdict (unl-204-219) | unmatched-functional-clause | Choose an enemy unit at a battlefield. / Its owner places it on the top or bottom of their Main Deck. · packages/card-data/data/deck-catalog.json:24773 |
| Resonating Strike (ven-034-166) | unmatched-functional-clause | Choose a battlefield you control and a unit you control at a different location. · packages/card-data/data/deck-catalog.json:26790 |

规则 / 契约变更请求（建议，未修改任何契约）：

- EffectIR v2 需要序列与结果变量、值表达式和 null、费用记录、对象 / 地点绑定、触发与延迟触发、持续层与替代处理、隐藏选择 / 模式 / 排序；由父任务与规则负责人冻结字段。
- Token / 复制 / grant 的被引用能力必须有依赖闭包或显式运行时能力边界，不能只看本卡出现的词。
- v1.5 新关键词（目录确有 Empower / Empowered / Burn / Deploy / Disarm / Show Off 等）的正式规则与全部印刷差异须核对官方规则 / 勘误；本报告不推测数值默认、作用域或冲突优先级。
- 单 runtime / journal 与旧回放政策按父任务的已批准方案实施；本任务没有变更历史 profile / schema。

## 8. JSON 消费、校验与证据


JSON 是调研 schema `riftbound.ability-template-survey.v1`，不是 EffectIR v2 合约。cards 是 canonicalCardId → 记录；templates 是匹配 ID 列表；directPrimitives / requiredPrimitives 分开；clauses / unmatchedClauses / evidence 给出片段与偏移；printingDifferences 不替代官方勘误。executionStatus 保留现状，classification 仅用于任务分片，不能作为执行白名单。

读取示例（仓库根）：

```bash
node --input-type=module - <<'JS'
import fs from "node:fs";
import assert from "node:assert/strict";
const survey = JSON.parse(fs.readFileSync("docs/plans/survey/ability-templates.json", "utf8"));
assert.equal(survey.schema, "riftbound.ability-template-survey.v1");
assert.equal(Object.keys(survey.cards).length, 1080);
for (const [canonicalCardId, card] of Object.entries(survey.cards)) {
  assert(card.templates.length > 0);
  assert(card.requiredPrimitives.every(id => survey.primitives.some(item => item.id === id)));
  if (card.classification === "unclassified") console.log(canonicalCardId, card.primaryPrintingId, card.blockers);
}
console.log(JSON.stringify(survey.stats));
JS
```

生成器关键输出（同输入确定性重跑）：

```json
{
  "printingCount": 1381,
  "identityCount": 1080,
  "catalogDataVersion": "2026-10-12-official-gallery",
  "catalogDigest": "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
  "currentExecutablePrintings": 0,
  "currentJudgeRequiredPrintings": 1348,
  "currentNoAbilityPrintings": 33,
  "identityExecutionStatus": {
    "judge-required": 1071,
    "no-ability": 9
  },
  "identityClassification": {
    "lexical-candidate": 917,
    "no-ability-text": 16,
    "unclassified": 147
  },
  "cardTypes": {
    "Battlefield": 76,
    "Gear": 126,
    "Legend": 57,
    "Rune": 6,
    "Spell": 268,
    "Token": 2,
    "Unit": 545
  },
  "emptyPrimaryAbilityCount": 16,
  "unclassifiedCount": 147,
  "primaryNullEnergyCount": 149,
  "primaryNullPowerCount": 648,
  "rawAbilityDifferenceCount": 108,
  "nonReminderDifferenceCount": 21,
  "nonAbilityDifferenceCount": 43,
  "candidateCeiling": 933,
  "primitiveCount": 78,
  "templateCount": 108,
  "descriptorIdentityUnion": 43,
  "milestones": [
    {
      "targetPercent": 30,
      "reachable": true,
      "primitiveCount": 32,
      "cumulativeCards": 325
    },
    {
      "targetPercent": 70,
      "reachable": true,
      "primitiveCount": 53,
      "cumulativeCards": 756
    },
    {
      "targetPercent": 95,
      "reachable": false,
      "primitiveCount": null,
      "cumulativeCards": 933
    }
  ]
}
```

验证包含：输入成员 / 去重 / coverage 对齐、1080 个身份均有模板、每个原语存在、依赖无环和闭包幂等、曲线单调及候选天花板一致、未识别括号词 fail-closed、九个 description 逐印刷实测、两个文件同输入重跑逐字节一致。未修改包，不运行全仓 / 包测试或服务；此处不借用历史测试数量作为当前通过证据。运行日志在 `/tmp/RIFT-9-survey-ability-templates/analysis.log` 和 `validation.log`，临时文件不提交。

## 附录：完整可复现分析脚本


保存为 `/tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs`，保持 UTF-8 和末尾换行。脚本源码 SHA-256 见 JSON algorithm.scriptSha256。

````javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = path.resolve(option('--root', process.cwd()));
const output = path.resolve(option('--out-dir', path.join(root, 'docs/plans/survey')));
const scratch = '/tmp/RIFT-9-survey-ability-templates';
const catalogPath = 'packages/card-data/data/deck-catalog.json';
const coveragePath = 'packages/card-data/data/effect-coverage.json';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const sort = values => [...new Set(values)].sort();
const percent = count => Number((count / 1080 * 100).toFixed(2));
const catalogText = read(catalogPath);
const coverageText = read(coveragePath);
const catalog = JSON.parse(catalogText);
const coverage = JSON.parse(coverageText);
const byPrinting = new Map(catalog.cards.map(card => [card.id, card]));
assert.equal(byPrinting.size, catalog.cards.length);
const groups = new Map();
for (const card of catalog.cards) {
  assert.equal(typeof card.canonicalCardId, 'string');
  const group = groups.get(card.canonicalCardId) ?? [];
  group.push(card);
  groups.set(card.canonicalCardId, group);
}
assert.equal(catalog.cards.length, 1381);
assert.equal(groups.size, 1080);
assert.equal(catalog.groups.length, groups.size);
assert.equal(coverage.entries.length, catalog.cards.length);
assert.equal(coverage.executableCount, 0);
const primary = new Map();
for (const group of catalog.groups) {
  assert(!primary.has(group.canonicalCardId));
  const card = byPrinting.get(group.primaryPrintingId);
  assert.equal(card?.canonicalCardId, group.canonicalCardId);
  assert.deepEqual(sort(group.printings), sort(groups.get(group.canonicalCardId).map(item => item.id)));
  primary.set(group.canonicalCardId, card);
}
const coverageByPrinting = new Map(coverage.entries.map(entry => [entry.printingId, entry]));
assert.equal(coverageByPrinting.size, catalog.cards.length);
for (const card of catalog.cards) assert.equal(coverageByPrinting.get(card.id)?.canonicalCardId, card.canonicalCardId);
const sourceLines = new Map();
let printingId;
catalogText.split('\n').forEach((line, index) => {
  const match = line.match(/^\s*"id": "([^"]+)"/);
  if (match && byPrinting.has(match[1])) printingId = match[1];
  if (printingId && /^\s*"ability":/.test(line)) sourceLines.set(printingId, index + 1);
});
assert.equal(sourceLines.size, catalog.cards.length);
const reference = card => `${catalogPath}:${sourceLines.get(card.id)}`;
const lineOf = (file, needle) => {
  const index = read(file).split('\n').findIndex(line => line.includes(needle));
  assert(index >= 0, `${file}: ${needle}`);
  return `${file}:${index + 1}`;
};

const definitions = [];
const define = (id, category, title, difficulty, dependencies, caution) => {
  definitions.push({ id, category, title, difficulty, dependencies, caution });
};
define('cost.printed', 'cost', '印刷费用；null 保留为无印刷值', '中', [], '空费用、0 与符文 Power 不得互换');
define('cost.pay', 'cost', '支付能量 / 指定域或通用 Power', '中', [], '资源池、符文回收与支付原子性');
define('cost.activated', 'cost', '激活费用与效果的边界', '中', [], '符号内部冒号不属于费用分隔符');
define('cost.additional', 'cost', '可选 / 强制附加费用及支付记录', '中', ['cost.printed'], '费用承诺与后续 if-paid 关联');
define('cost.modify', 'cost', '费用增减与忽略 / 替代支付', '高', ['cost.printed', 'condition.value'], '减费顺序、最低值和忽略 Energy 与全部费用的区别');
define('cost.exhaust', 'cost', '横置自身或其他对象作为费用', '中', ['target.query'], '费用横置与效果横置分开');
define('cost.discard', 'cost', '弃牌费用', '中', ['effect.zone'], '费用不可退与隐藏牌选择');
define('cost.sacrifice', 'cost', '消灭友方 / 自身作为费用', '高', ['effect.kill'], '明确是费用还是效果，不能由 kill 单词决定');
define('cost.recycle', 'cost', '回收对象作为费用', '中', ['effect.recycle'], '回收区域与对象类型');
define('cost.xp', 'cost', '支付 XP', '中', [], 'XP 是玩家状态，区别于能量');
define('cost.reveal', 'cost', '展示 / Show Off 的承诺', '高', ['effect.reveal', 'choice.mode'], '从手牌展示与选友方对象两分支');
define('cost.hidden', 'cost', 'Hidden 隐藏与解禁成本', '高', ['cost.pay', 'effect.zone', 'continuous.timing'], '秘密区域、拥有权和合法使用时机');
define('target.query', 'target', '对象查询 / 选择与重验', '中', [], '自指、外部目标和不以目标为前提的集合查询须区分');
define('target.filter', 'target', '类型 / 控制者 / 标签 / 数值筛选', '中', ['target.query'], '所有权不等于控制权');
define('target.location', 'target', 'here / there / base / battlefield 引用', '高', ['target.query'], '触发源离场后的地点与指代绑定');
define('target.many', 'target', '数量范围与集合分配', '高', ['target.query'], 'up to、each、all、分摊和同时性');
define('target.player', 'target', '玩家 / 对手选择', '中', ['target.query'], 'each player 与 choose opponent 不等价');
define('target.tax', 'target', 'Deflect 目标附加支付', '高', ['target.query', 'cost.pay'], '合法性与选择目标时支付顺序');
define('effect.draw', 'effect', '抽牌', '低', ['effect.zone'], '空牌库及隐藏投影归内核');
define('effect.discard', 'effect', '弃牌', '低', ['effect.zone', 'target.query'], '效果弃牌和费用弃牌分开');
define('effect.damage', 'effect', '造成 / 分配伤害', '中', ['target.query'], '动态数额、同时伤害、Bonus Damage');
define('effect.heal', 'effect', '清除伤害 / heal', '中', ['target.query'], '不引入实验性玩家生命语义');
define('effect.kill', 'effect', 'kill / 死亡处理', '中', ['effect.zone', 'target.query'], '消灭与被替代的死亡分开');
define('effect.zone', 'effect', '跨区域移动与对象身份', '高', ['target.query'], '隐藏信息、离场、归属和最后已知信息');
define('effect.move', 'effect', '场上移动 / recall', '高', ['target.location'], '移动路径、占领和战斗建立');
define('effect.ready', 'effect', '重置', '低', ['target.query'], 'enter ready 使用入场替代而非事后重置');
define('effect.exhaust', 'effect', '横置', '低', ['target.query'], '作为效果执行');
define('effect.resources', 'effect', '增加 Energy / Power', '中', [], '资源能力的时机与是否入链');
define('effect.channel', 'effect', 'channel 符文', '中', ['effect.zone'], '从符文库、exhausted 入场与资源池不同');
define('effect.token', 'effect', '创建 / 打出 token', '高', ['effect.zone', 'target.location'], '需 Token 定义及被引用的 Token 能力依赖');
define('effect.attach', 'effect', '装备附着 / 重附着', '高', ['target.filter', 'target.location'], '附着目标、控制权、脱离与持续效果');
define('effect.detach', 'effect', '脱离装备', '中', ['effect.attach'], '独立于杀死装备');
define('effect.play', 'effect', '从区域打出卡 / 获得打出许可', '高', ['effect.zone', 'cost.printed', 'continuous.timing'], '嵌套打出与忽略费用的边界');
define('effect.recycle', 'effect', 'recycle 回收', '中', ['effect.zone'], '区域、顺序和卡库底部');
define('effect.banish', 'effect', 'banish 放逐', '中', ['effect.zone'], '后续指向被放逐对象的链接');
define('effect.reveal', 'effect', '展示信息', '中', ['target.query'], '谁可见与展示有效期');
define('effect.inspect', 'effect', '查看 / 搜索卡库', '中', ['target.query'], '私有选项、范围和失败查询');
define('effect.order', 'effect', '排序 / 放回牌库', '中', ['effect.zone', 'choice.order'], '顶部 / 底部顺序');
define('effect.shuffle', 'effect', '洗牌', '中', ['effect.zone'], '由内核确定性随机源驱动');
define('effect.mill', 'effect', 'Burn / 卡库到弃牌区', '中', ['effect.zone'], '烧牌及后续 that-card 绑定');
define('effect.buff', 'effect', 'Buff 标记的添加 / 消耗', '中', ['continuous.might', 'condition.predicate'], '与临时 Might 修改分开');
define('effect.xp', 'effect', '获得 XP', '低', [], '玩家 XP 资源');
define('effect.empower', 'effect', 'Empower / Disempower 状态', '高', ['condition.predicate'], '新关键字须核验 v1.5');
define('effect.score', 'effect', '得分', '高', ['target.player'], '最后一分、计分窗口与替代');
define('effect.win', 'effect', '直接胜负条件', '高', ['condition.predicate'], '与得分胜利分开');
define('effect.control', 'effect', '改变控制权', '高', ['target.query', 'continuous.duration'], '拥有者、结束条件与回归');
define('effect.counter', 'effect', '反制链上 spell / ability', '高', ['target.query'], '反制合法性与费用不退');
define('effect.copy', 'effect', '复制对象 / 效果', '高', ['target.query', 'continuous.duration'], '复制层、例外与原对象引用');
define('effect.repeat', 'effect', '重复 spell 效果', '高', ['choice.mode'], '重选目标与重复不是重打卡');
define('effect.stun', 'effect', 'Stun 状态', '中', ['continuous.combat', 'continuous.duration'], '伤害限制与状态有效期');
define('trigger.play', 'trigger', '打出自身 / 其他卡触发', '高', [], 'play、enter 和源对象身份分开');
define('trigger.leave', 'trigger', '死亡 / 离场 / Deathknell', '高', [], '最后已知信息与同时事件');
define('trigger.combat', 'trigger', '攻击 / 防守 / 战斗胜负触发', '高', [], '参与战斗和取得 attacker designation 的差别');
define('trigger.score', 'trigger', 'Hold / Conquer / 计分触发', '高', [], 'Hold 是触发事件，此目录不是 [Hold] 关键字');
define('trigger.phase', 'trigger', '阶段开始 / 回合结束触发', '高', [], 'before scoring、next 与控制者');
define('trigger.move', 'trigger', '移动触发', '高', [], '移动成功、次数与不同来源');
define('trigger.state', 'trigger', '状态改变 / 其余事件触发', '高', [], '事件过滤、同时触发和观察窗口');
define('trigger.delayed', 'trigger', '延迟触发注册', '高', ['trigger.phase', 'continuous.duration'], '触发源离场后是否仍存在');
define('replacement.enter', 'replacement', '入场 ready / exhausted', '高', [], '加速成本与入场替代绑定');
define('replacement.event', 'replacement', 'would / instead 事件替代', '高', ['condition.predicate'], '句法 instead 可能仅为条件分支，需人工判断');
define('replacement.prevent', 'replacement', '防伤 / 防死亡', '高', ['condition.predicate'], '与禁止分配战斗伤害分开');
define('continuous.might', 'continuous', 'Might 加减 / 设值 / 倍增', '中', ['target.query', 'continuous.duration'], 'Assault / Shield、层次及动态取值');
define('continuous.keyword', 'continuous', '授予 / 移除能力或标签', '高', ['target.query', 'continuous.duration'], '引用关键词不等于拥有该关键词');
define('continuous.duration', 'continuous', '效果持续时间 / 清理', '高', [], '本回合、持续直到和源对象存续');
define('continuous.timing', 'continuous', 'Action / Reaction / Ambush 时机', '高', [], '整卡时机与授予的激活能力时机不同');
define('continuous.movement', 'continuous', 'Ganking / 移动许可和限制', '高', ['target.location'], '战场到战场和基地权限');
define('continuous.combat', 'continuous', '战斗伤害限制 / Tank / Backline', '高', ['target.query'], '指派顺序、must 与 cannot');
define('continuous.restrict', 'continuous', '一般许可 / 禁止 / 数量限制', '高', ['condition.predicate'], '禁止优先级、每回合上限和例外');
define('continuous.suppress', 'continuous', '抑制触发 / 能力失去', '高', ['target.query'], '特定 Temporary 抑制或泛用失去能力');
define('continuous.location', 'continuous', 'Deploy 等入场地点许可', '高', ['target.location'], 'Gear 入场地点与移动许可分开');
define('continuous.deck', 'continuous', 'Unique / 同名构筑限制', '中', [], '构筑期语义也属于整卡覆盖');
define('condition.predicate', 'condition', '条件 / 布尔 / 逻辑分支', '中', [], '谓词求值时间与 if-do 记录分开');
define('condition.value', 'condition', '动态数值 / 阈值 / X / 指代', '高', ['target.query'], '取值时机、null、Last Known Information');
define('condition.history', 'condition', '本回合 / 次数 / Flow / Legion 历史', '高', [], '事件历史范围和 once / first / third');
define('condition.result', 'condition', 'if-do / paid / this-way 结果绑定', '高', ['condition.predicate'], '费用凭证和效果结果可追踪');
define('choice.optional', 'choice', 'may 可选执行', '中', [], '谁选择、拒绝路径与信息可见性');
define('choice.mode', 'choice', '模式 / or / 分支选择', '中', [], 'one / two / different 和复合费用 or');
define('choice.order', 'choice', '牌序 / 多事件排序', '高', [], '顺序由玩家选择与规则决定的区别');
const primitiveById = new Map(definitions.map(item => [item.id, item]));
const closure = ids => {
  const result = new Set();
  const active = new Set();
  const visit = id => {
    assert(primitiveById.has(id), `Unknown primitive ${id}`);
    assert(!active.has(id), `Dependency cycle ${id}`);
    if (result.has(id)) return;
    active.add(id);
    for (const dependency of primitiveById.get(id).dependencies) visit(dependency);
    active.delete(id);
    result.add(id);
  };
  for (const id of ids) visit(id);
  return sort(result);
};
closure(definitions.map(item => item.id));

const keywordRules = [
  ['Assault', ['continuous.might', 'condition.predicate']],
  ['Shield', ['continuous.might', 'condition.predicate']],
  ['Deflect', ['target.tax']],
  ['Accelerate', ['cost.additional', 'cost.pay', 'choice.optional', 'replacement.enter']],
  ['Equip', ['cost.activated', 'cost.pay', 'effect.attach']],
  ['Hidden', ['cost.hidden']],
  ['Ganking', ['continuous.movement']],
  ['Tank', ['continuous.combat']],
  ['Backline', ['continuous.combat']],
  ['Deathknell', ['trigger.leave']],
  ['Temporary', ['trigger.phase', 'effect.kill']],
  ['Reaction', ['continuous.timing']],
  ['Action', ['continuous.timing']],
  ['Ambush', ['continuous.timing', 'target.location']],
  ['Repeat', ['cost.additional', 'cost.pay', 'choice.optional', 'effect.repeat']],
  ['Empower', ['cost.activated', 'cost.pay', 'effect.empower', 'condition.predicate']],
  ['Empowered', ['condition.predicate']],
  ['Flow', ['condition.history', 'condition.predicate']],
  ['Legion', ['condition.history', 'condition.predicate']],
  ['Mighty', ['condition.value']],
  ['Vision', ['trigger.play', 'effect.inspect', 'effect.recycle', 'choice.optional']],
  ['Predict', ['effect.inspect', 'effect.recycle', 'effect.order', 'choice.optional']],
  ['Hunt', ['trigger.score', 'effect.xp']],
  ['Level', ['condition.value', 'condition.predicate']],
  ['Burn', ['effect.mill']],
  ['Deploy', ['continuous.location']],
  ['Quick-Draw', ['continuous.timing', 'trigger.play', 'effect.attach']],
  ['Weaponmaster', ['trigger.play', 'cost.modify', 'effect.attach', 'choice.optional']],
  ['Unique', ['continuous.deck']],
  ['Show Off', ['cost.reveal', 'condition.result']],
  ['Disarm', ['trigger.combat', 'continuous.might', 'continuous.duration']],
  ['Stun', ['effect.stun']],
  ['Buff', ['effect.buff']],
  ['Add', ['effect.resources']],
];
const rules = [];
const rule = (id, name, expression, primitives, difficulty = '中') => rules.push({ id, name, expression, primitives, difficulty });
rule('trigger-play', 'When 打出', /\bwhen(?:ever)?\b[^.!?\n]*?\b(?:play|plays|played|enter|enters)\b/i, ['trigger.play'], '高');
rule('trigger-leave', '死亡 / 离场触发', /\bwhen(?:ever)?\b[^.!?\n]*?\b(?:die|dies|leave|leaves|killed)\b/i, ['trigger.leave'], '高');
rule('trigger-combat', '攻击 / 防守 / 战斗事件', /\bwhen(?:ever)?\b[^.!?\n]*?\b(?:attack|attacks|defend|defends|win|wins|combat)\b/i, ['trigger.combat'], '高');
rule('trigger-score', 'Hold / Conquer 事件', /\bwhen(?:ever)?\b[^.!?\n]*?\b(?:hold|holds|conquer|conquers|score|scores)\b/i, ['trigger.score'], '高');
rule('trigger-phase', 'At the start / end 阶段', /\b(?:at (?:the )?(?:start|end)|beginning of|end of (?:the |your |each )?turn)\b/i, ['trigger.phase'], '高');
rule('trigger-move', '移动事件', /\bwhen(?:ever)?\b[^.!?\n]*?\b(?:move|moves)\b/i, ['trigger.move'], '高');
rule('trigger-state', 'When / Whenever 一般事件', /\bwhen(?:ever)?\b/i, ['trigger.state'], '高');
rule('delayed', 'next 阶段延迟执行', /\b(?:next (?:Main|Beginning|End) Phase|at the (?:start|end) of (?:your |its controller's )?next)\b/i, ['trigger.delayed'], '高');
rule('activated', '费用 : 效果', /(?:\[>\]\s*)?(?:(?::rb_[a-z0-9_]+:\s*)+|\b(?:spend|discard|kill|recycle|exhaust)\b[^.!?\n]{0,90}):\s*\S/i, ['cost.activated'], '高');
rule('cost-resources', '支付资源', /\b(?:pay|pays|paid)\b[^.!?\n]*?:rb_(?:energy|rune)_[a-z0-9_]+:/i, ['cost.pay']);
rule('additional-cost', 'as an additional cost', /\badditional cost\b/i, ['cost.additional']);
rule('cost-modify', '减费 / 忽略费用 / 替代费用', /\b(?:costs?[^.!?\n]*(?:less|more)|(?:reduce|increase|ignoring)[^.!?\n]*cost|play (?:me|this|it) for|instead of :rb_)\b/i, ['cost.modify'], '高');
rule('cost-exhaust', '横置费用', /:rb_exhaust:|\bexhaust\b[^.!?\n]{0,70}(?:,\s*|as an additional cost)/i, ['cost.exhaust']);
rule('cost-discard', '弃牌费用', /\bdiscard[^.!?\n]*?(?:additional cost|:)|additional cost[^.!?\n]*?discard/i, ['cost.discard']);
rule('cost-sacrifice', 'kill 费用候选', /\bkill[^.!?\n]*?(?:,\s*:rb_exhaust:|:|as an additional cost| to (?:draw|score|play|give|deal|ready))|additional cost[^.!?\n]*?kill/i, ['cost.sacrifice'], '高');
rule('cost-recycle', 'recycle 费用候选', /\brecycle[^.!?\n]*?(?:additional cost|,\s*:rb_exhaust:|:)/i, ['cost.recycle']);
rule('cost-xp', 'Spend XP', /\bspend \d+ XP\b/i, ['cost.xp']);
rule('draw', 'Draw N', /\bdraw(?:s)?\b/i, ['effect.draw'], '低');
rule('discard', 'Discard N', /\bdiscard(?:s)?\b/i, ['effect.discard'], '低');
rule('damage', 'Deal N / Might damage', /\bdeal(?:s)?\b|\bbonus damage\b/i, ['effect.damage']);
rule('heal', 'Heal', /\bheal(?:s)?\b/i, ['effect.heal']);
rule('kill', 'Kill', /\bkill(?:s)?\b/i, ['effect.kill']);
rule('move', 'Move / Recall', /\b(?:move|moves|moved|recall|recalls)\b/i, ['effect.move'], '高');
rule('zone', 'Return / Put 区域迁移', /\b(?:return|put)\b[^.!?\n]*(?:hand|deck|trash|base|board|zone|bottom|top)/i, ['effect.zone'], '高');
rule('ready', 'Ready', /\bready\b/i, ['effect.ready'], '低');
rule('exhaust', 'Exhaust / Exhausted', /\bexhaust(?:ed|s)?\b/i, ['effect.exhaust'], '低');
rule('resources', 'Add 资源', /\[Add\]|\badd\b[^.!?\n]*?:rb_(?:energy|rune)_[a-z0-9_]+:/i, ['effect.resources']);
rule('channel', 'Channel rune', /\bchannel(?:s)?\b/i, ['effect.channel']);
rule('token', 'Play / Create token', /\b(?:play|create)[^.!?\n]*\btokens?\b/i, ['effect.token'], '高');
rule('attach', 'Attach Equipment', /\battach(?:ed)?\b|\bequipped\b/i, ['effect.attach'], '高');
rule('detach', 'Detach Equipment', /\bdetach\b/i, ['effect.detach']);
rule('special-play', '非通常区域 / 额外打出', /\b(?:you may play|then play|and play|to play|play it|play the|play a[^.!?\n]*from (?:your |the )?(?:hand|trash|deck|top|champion))\b/i, ['effect.play'], '高');
rule('recycle', 'Recycle', /\brecycle\b/i, ['effect.recycle']);
rule('banish', 'Banish', /\bbanish(?:ed)?\b/i, ['effect.banish']);
rule('reveal', 'Reveal', /\breveal\b/i, ['effect.reveal']);
rule('inspect', 'Look at / Search', /\b(?:look at|search|look through)\b/i, ['effect.inspect']);
rule('order', 'Put back / 顶底排序', /\b(?:put[^.!?\n]*(?:back|top|bottom)|any order)\b/i, ['effect.order']);
rule('shuffle', 'Shuffle', /\bshuffle\b/i, ['effect.shuffle']);
rule('buff', 'Buff / Spend buff', /\bbuff(?:s|ed)?\b/i, ['effect.buff']);
rule('xp', 'Gain XP', /\bgain(?:s)? \d+ XP\b/i, ['effect.xp'], '低');
rule('empower', 'Empower / Disempower', /\b(?:empower|disempower)\b/i, ['effect.empower'], '高');
rule('score', 'Score / Gain point', /\b(?:score(?:s)?[^.!?\n]*?points?|gain(?:s)? \d+ points?)\b/i, ['effect.score'], '高');
rule('win', 'Win the game', /\b(?:win|lose) the game\b/i, ['effect.win'], '高');
rule('control', 'Take control', /\b(?:take control|you control (?:it|them) until|gain control)\b/i, ['effect.control'], '高');
rule('counter', 'Counter spell / ability', /\bcounter(?:ed)?\b/i, ['effect.counter'], '高');
rule('copy', 'Copy', /\b(?:copy|copies)\b/i, ['effect.copy'], '高');
rule('repeat', 'Repeat effect', /\brepeat\b/i, ['effect.repeat'], '高');
rule('stun', 'Stun', /\bstun(?:ned)?\b/i, ['effect.stun']);
rule('might', '修改 Might', /(?:[+−-]\s*(?:\d+|X|:rb_might:)|\b(?:double|set|base|becomes?)[^.!?\n]{0,40}Might|\bMight is\b)/i, ['continuous.might']);
rule('grant', '授予能力 / 标签', /\b(?:give[^.!?\n]*\[|(?:have|has|gain|gains|lose|loses) (?:\[|"|that tag)|(?:have|has) [^.!?\n]*? tag) /i, ['continuous.keyword'], '高');
rule('duration', 'This turn / Until', /\b(?:this turn|until|as long as|while (?:this|i am|i'm))\b/i, ['continuous.duration'], '高');
rule('timing', '时机许可', /\b(?:as a \[Reaction\]|any time|in showdowns|opponent's turn)\b/i, ['continuous.timing'], '高');
rule('movement', '移动许可 / 限制', /\b(?:can|can't|cannot|may|must)[^.!?\n]{0,25}\bmove\b/i, ['continuous.movement'], '高');
rule('combat', '战斗伤害修改 / 指派', /\b(?:combat damage|assigned[^.!?\n]*damage|damage[^.!?\n]*assigned)\b/i, ['continuous.combat'], '高');
rule('restrict', '不能 / 必须 / 仅可', /\b(?:can't|cannot|must|only|no more than|no fewer than)\b/i, ['continuous.restrict'], '高');
rule('suppress', '不触发 / 失去能力', /\b(?:don't trigger|doesn't trigger|can't trigger|lose[^.!?\n]*abilities)\b/i, ['continuous.suppress'], '高');
rule('deck-limit', '构筑数量例外', /\byour deck can have\b/i, ['continuous.deck']);
rule('enter', 'Enter Ready / Exhausted', /\benter(?:s)? (?:ready|exhausted)\b/i, ['replacement.enter'], '高');
rule('replacement', 'Would / Instead 候选', /\b(?:would|instead)\b/i, ['replacement.event'], '高');
rule('prevention', '防伤 / 防死亡候选', /\b(?:don't|doesn't|can't|cannot) (?:take damage|die|be killed)|\bprevent\b/i, ['replacement.prevent'], '高');
rule('condition', 'If / While / Otherwise', /\b(?:if|while|otherwise|unless)\b/i, ['condition.predicate']);
rule('value', '动态数值 / 比较 / X', /\bequal\b|\bfor each\b|\b(?:more|less|most|least|highest|lowest|base)\b|\bX\b|\d\+|\b(?:that unit|that card|its|my|their) (?:Might|Energy|Power|cost)\b/i, ['condition.value'], '高');
rule('history', 'Once / First / Nth / Played 历史', /\b(?:first|second|third|once|twice|times|you've|have played|has played|have moved|has moved|spent)\b/i, ['condition.history'], '高');
rule('result', 'If you do / Paid / This way', /\b(?:if (?:you|they) (?:do|did|paid)|paid the additional|this way|showed off)\b/i, ['condition.result'], '高');
rule('optional', 'You may', /\bmay\b/i, ['choice.optional']);
rule('mode', 'Choose one / two / Or', /\b(?:choose (?:one|two|up to|a mode)|or)\b/i, ['choice.mode']);
rule('choice-order', 'Any order', /\bany order\b/i, ['choice.order'], '高');
rule('target', '对象引用 / Choose / Pick', /\b(?:choose|pick|a unit|an enemy|a friendly|another|each unit|all units|target)\b/i, ['target.query']);
rule('filter', '友敌 / 类型 / 控制者筛选', /\b(?:friendly|enemy|control|non-token|equipment|gear|units?|spells?|legends?|tokens?)\b/i, ['target.filter']);
rule('location', '地点引用', /\b(?:here|there|battlefields?|base|location)\b/i, ['target.location'], '高');
rule('many', 'Each / All / Up to / 多选', /\b(?:each|all|up to|two|three|four|five|six|divide|split|any number)\b/i, ['target.many'], '高');
rule('player', '玩家引用 / 选择', /\b(?:opponent|player)\b/i, ['target.player']);

function splitClauses(raw) {
  const result = [];
  let depth = 0;
  let start = 0;
  const reminders = [];
  let reminderStart = 0;
  const masked = [...raw];
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '(') { if (depth === 0) reminderStart = index; depth++; }
    if (depth > 0) masked[index] = raw[index] === '\n' ? '\n' : ' ';
    if (raw[index] === ')') {
      depth--;
      if (depth === 0) reminders.push({ start: reminderStart, end: index + 1, text: raw.slice(reminderStart, index + 1) });
    }
  }
  const functional = masked.join('');
  const append = end => {
    const original = functional.slice(start, end);
    const left = original.search(/\S/);
    if (left >= 0) result.push({ start: start + left, end: start + original.trimEnd().length, text: original.trim() });
    start = end;
  };
  for (let index = 0; index < functional.length; index++) {
    if (/[.!?\n]/.test(functional[index])) append(index + 1);
  }
  append(functional.length);
  return { clauses: result, functional, reminders, balanced: depth === 0 };
}
const keywordByName = new Map(keywordRules.map(([name, primitives]) => [name.toLowerCase(), primitives]));
const keywordName = literal => literal.replace(/\s+\d+$/, '').toLowerCase();
const sourceFields = ['ability', 'cardType', 'energy', 'power', 'might', 'domains', 'tags'];
const cardResults = {};
const unrecognizedBrackets = new Map();
for (const [canonicalId, card] of [...primary].sort(([left], [right]) => left.localeCompare(right))) {
  const parsed = splitClauses(card.ability);
  const direct = new Set();
  const templates = new Set();
  const cues = [];
  const emit = (template, primitives, start, end, text, evidenceKind = 'literal-cue') => {
    templates.add(template);
    for (const primitive of primitives) direct.add(primitive);
    cues.push({ template, primitives, start, end, text, evidenceKind });
  };
  if (['Unit', 'Gear', 'Spell'].includes(card.cardType)) emit('implicit-printed-cost', ['cost.printed'], null, null, card.cardType, 'inferred-from-card-type');
  if (card.cardType === 'Rune') emit('inherent-rune', ['effect.resources', 'cost.exhaust', 'cost.recycle'], null, null, card.cardType, 'rule-review-required');
  const keywords = [];
  for (const match of card.ability.matchAll(/\[([^\]]+)\]/g)) {
    const literal = match[1];
    const name = keywordName(literal);
    if (/^>+$/.test(literal) || literal === 'NO TEXT') continue;
    const reminder = parsed.reminders.some(item => match.index >= item.start && match.index < item.end);
    keywords.push({ literal, name, start: match.index, scope: reminder ? 'reminder' : 'functional-reference' });
    if (!keywordByName.has(name)) { unrecognizedBrackets.set(literal, (unrecognizedBrackets.get(literal) ?? 0) + 1); continue; }
    emit(`kw-${name.replaceAll(' ', '-')}`, keywordByName.get(name), match.index, match.index + match[0].length, match[0], reminder ? 'reminder-reference' : 'keyword-reference');
  }
  for (const [name, primitives] of keywordRules) {
    const expression = new RegExp(`\\b${name.replace('-', '\\-')}\\b`, 'i');
    if (!keywords.some(item => item.name === name.toLowerCase()) && expression.test(parsed.functional)) {
      const match = expression.exec(parsed.functional);
      keywords.push({ literal: match[0], name: name.toLowerCase(), start: match.index, scope: 'unbracketed-reference' });
      emit(`kw-${name.toLowerCase().replaceAll(' ', '-')}`, primitives, match.index, match.index + match[0].length, match[0], 'unbracketed-reference');
    }
  }
  const unmatched = [];
  for (const clause of parsed.clauses) {
    const clauseRules = [];
    for (const item of rules) {
      const match = item.expression.exec(clause.text);
      if (!match) continue;
      clauseRules.push(item.id);
      emit(item.id, item.primitives, clause.start + match.index, clause.start + match.index + match[0].length, match[0]);
    }
    const keywordCue = cues.some(cue => cue.start !== null && cue.start >= clause.start && cue.start < clause.end && cue.template.startsWith('kw-'));
    const substantive = clauseRules.some(id => !['target', 'filter', 'location', 'many', 'player', 'condition', 'value', 'history', 'result', 'optional', 'mode', 'choice-order', 'duration', 'trigger-state'].includes(id));
    if (!substantive && !keywordCue) unmatched.push(clause);
  }
  const variants = groups.get(canonicalId);
  const changedFields = sourceFields.filter(field => new Set(variants.map(item => JSON.stringify(item[field]))).size > 1);
  const strippedVariants = new Set(variants.map(item => splitClauses(item.ability).functional.replaceAll('[NO TEXT]', '').replace(/\s+/g, ' ').trim()));
  const blockers = [];
  if (!parsed.balanced) blockers.push('unbalanced-parentheses');
  if (unmatched.length) blockers.push('unmatched-functional-clause');
  if (/instead\.disa\b/i.test(card.ability)) blockers.push('corrupt-source-tail');
  if (strippedVariants.size > 1) blockers.push('non-reminder-printing-difference');
  if (changedFields.some(field => field !== 'ability')) blockers.push('printing-stat-type-or-tag-difference');
  const blank = parsed.functional.trim() === '' || parsed.functional.trim() === '[NO TEXT]';
  if (blank) templates.add('no-ability-text');
  if (blockers.length) templates.add('unclassified');
  if (!blank && !templates.size) { templates.add('unclassified'); blockers.push('no-template'); }
  const statuses = sort(variants.map(item => coverageByPrinting.get(item.id).status));
  cardResults[canonicalId] = {
    name: card.fullName, cardType: card.cardType, primaryPrintingId: card.id, printingIds: variants.map(item => item.id),
    printed: { energy: card.energy, power: card.power, might: card.might },
    source: reference(card), abilitySha256: hash(card.ability),
    currentCoverageStatuses: statuses, executionStatus: statuses.includes('judge-required') ? 'judge-required' : 'no-ability',
    classification: blockers.length ? 'unclassified' : blank ? 'no-ability-text' : 'lexical-candidate',
    requiresV15RuleReview: true, blockers, templates: sort(templates), directPrimitives: sort(direct), requiredPrimitives: closure(direct),
    keywords, clauses: parsed.clauses, unmatchedClauses: unmatched,
    evidence: cues,
    printingDifferences: changedFields.length ? {
      fields: changedFields, nonReminderTextDifference: strippedVariants.size > 1,
      variants: variants.map(item => ({ printingId: item.id, source: reference(item), abilitySha256: hash(item.ability),
        ...Object.fromEntries(changedFields.filter(field => field !== 'ability').map(field => [field, item[field]])) })),
    } : null,
  };
}

const entries = Object.entries(cardResults);
const records = entries.map(([id, card]) => ({ id, ...card }));
const count = predicate => records.filter(predicate).length;
const primitiveResults = definitions.map(item => ({
  ...item,
  directCardCount: count(card => card.directPrimitives.includes(item.id)),
  requiredCardCount: count(card => card.requiredPrimitives.includes(item.id)),
  examples: records.filter(card => card.directPrimitives.includes(item.id)).slice(0, 2).map(card => ({ canonicalCardId: card.id, printingId: card.primaryPrintingId, source: card.source })),
}));
const templateDefinitions = [
  ...keywordRules.map(([name, primitives]) => ({ id: `kw-${name.toLowerCase().replaceAll(' ', '-')}`, name: `关键词 / 引用 ${name}`, primitives, difficulty: '高' })),
  ...rules.map(({ expression, ...item }) => item),
  { id: 'implicit-printed-cost', name: '卡类隐含正常支付', primitives: ['cost.printed'], difficulty: '中' },
  { id: 'inherent-rune', name: 'Rune 固有能力待核验', primitives: ['effect.resources', 'cost.exhaust', 'cost.recycle'], difficulty: '高' },
  { id: 'no-ability-text', name: '无印刷能力文本', primitives: [], difficulty: '低' },
  { id: 'unclassified', name: '未归类 / 资料冲突桶', primitives: [], difficulty: '高' },
];
const templates = templateDefinitions.map(item => {
  const matched = records.filter(card => card.templates.includes(item.id));
  const exemplar = matched[0];
  const cue = exemplar?.evidence.find(evidence => evidence.template === item.id);
  return { ...item, cardCount: matched.length, requiresV15RuleReview: true,
    blockerCardCount: matched.filter(card => card.blockers.length).length,
    example: exemplar ? { printingId: exemplar.primaryPrintingId, source: exemplar.source, text: cue?.text ?? exemplar.clauses[0]?.text ?? '(无印刷能力文本)' } : null };
}).filter(item => item.cardCount > 0);
for (const card of records) {
  assert(card.templates.length);
  for (const template of card.templates) assert(templates.some(item => item.id === template));
  assert.deepEqual(closure(card.requiredPrimitives), card.requiredPrimitives);
}
assert.equal(unrecognizedBrackets.size, 0, JSON.stringify([...unrecognizedBrackets]));

const candidates = records.filter(card => !card.blockers.length);
const implemented = new Set();
const curve = [];
const eligible = (card, available) => card.requiredPrimitives.every(id => available.has(id));
const totalEligible = available => candidates.filter(card => eligible(card, available)).length;
curve.push({ step: 0, primitiveCount: 0, addedPrimitive: null, newlyCovered: totalEligible(implemented), cumulativeCards: totalEligible(implemented), coveragePercent: percent(totalEligible(implemented)) });
const bundles = [];
while (candidates.some(card => !eligible(card, implemented))) {
  const missingBundles = new Map();
  for (const card of candidates) {
    if (eligible(card, implemented)) continue;
    const missing = card.requiredPrimitives.filter(id => !implemented.has(id));
    missingBundles.set(missing.join('|'), missing);
  }
  const before = totalEligible(implemented);
  const options = [...missingBundles].map(([key, missing]) => {
    const after = new Set([...implemented, ...missing]);
    const gain = totalEligible(after) - before;
    const difficultyWeight = missing.reduce((sum, id) => sum + ({ 低: 1, 中: 2, 高: 3 }[primitiveById.get(id).difficulty]), 0);
    return { key, missing, gain, score: gain / missing.length, difficultyWeight };
  }).sort((left, right) => right.score - left.score || right.gain - left.gain || left.difficultyWeight - right.difficultyWeight || left.key.localeCompare(right.key));
  const chosen = options[0];
  assert(chosen?.gain > 0);
  const added = [];
  const add = id => {
    if (implemented.has(id)) return;
    for (const dependency of primitiveById.get(id).dependencies) add(dependency);
    const beforeCount = totalEligible(implemented);
    implemented.add(id);
    added.push(id);
    const cumulativeCards = totalEligible(implemented);
    curve.push({ step: curve.length, primitiveCount: implemented.size, addedPrimitive: id, newlyCovered: cumulativeCards - beforeCount, cumulativeCards, coveragePercent: percent(cumulativeCards) });
  };
  for (const id of chosen.missing) add(id);
  bundles.push({ bundle: bundles.length + 1, added, newlyCovered: totalEligible(implemented) - before, cumulativeCards: totalEligible(implemented), primitiveCount: implemented.size });
}
const thresholds = [30, 70, 95].map(target => {
  const requiredCards = Math.ceil(1080 * target / 100);
  const point = curve.find(item => item.cumulativeCards >= requiredCards);
  return { targetPercent: target, requiredCards, reachable: Boolean(point), primitiveCount: point?.primitiveCount ?? null,
    cumulativeCards: point?.cumulativeCards ?? candidates.length,
    primitives: point ? curve.slice(1, point.step + 1).map(item => item.addedPrimitive) : curve.slice(1).map(item => item.addedPrimitive),
    residualBlockerCount: records.length - candidates.length };
});
const allPrimitiveCeiling = count(card => !card.blockers.length);
assert.equal(curve.at(-1).cumulativeCards, allPrimitiveCeiling);
for (let index = 1; index < curve.length; index++) assert(curve[index].cumulativeCards >= curve[index - 1].cumulativeCards);

fs.mkdirSync(scratch, { recursive: true });
const descriptorOut = path.join(scratch, 'descriptor-dist');
const compilation = spawnSync('pnpm', ['--filter', '@riftbound/card-dsl', 'exec', 'tsc', '--project', 'tsconfig.json', '--outDir', descriptorOut, '--tsBuildInfoFile', path.join(scratch, 'descriptor.tsbuildinfo')], { cwd: root, encoding: 'utf8' });
assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
fs.writeFileSync(path.join(descriptorOut, 'package.json'), '{"type":"module"}\n');
const descriptorSpecs = [
  ['assault', 'assault-description-v1', 'describeDuelAssaultV1', ['continuous.might', 'condition.predicate']],
  ['shield', 'shield-description-v1', 'describeDuelShieldV1', ['continuous.might', 'condition.predicate']],
  ['accelerate', 'optional-play-cost-v1', 'describeDuelOptionalPlayCostV1', ['cost.additional', 'cost.pay', 'replacement.enter']],
  ['temporary', 'temporary-description-v1', 'describeDuelTemporaryV1', ['trigger.phase', 'effect.kill']],
  ['hold-score', 'hold-score-description-v1', 'describeDuelHoldScoreV1', ['trigger.score', 'effect.score']],
  ['attack-might-damage', 'attack-might-damage-description-v1', 'describeDuelAttackMightDamageV1', ['trigger.combat', 'condition.value', 'effect.damage']],
  ['beginning-draw', 'beginning-draw-description-v1', 'describeDuelBeginningDrawV1', ['trigger.phase', 'effect.draw']],
  ['equip', 'equip-description-v1', 'describeDuelEquipV1', ['cost.activated', 'effect.attach']],
  ['point-damage', 'point-damage-description-v1', 'describeDuelPointDamageV1', ['effect.damage', 'target.query']],
];
const descriptorResults = [];
for (const [id, moduleName, functionName, primitives] of descriptorSpecs) {
  const module = await import(pathToFileURL(path.join(descriptorOut, 'duel', `${moduleName}.js`)));
  const known = [];
  const reasons = {};
  for (const card of catalog.cards) {
    const envelope = { dataVersion: catalog.dataVersion, sourceCatalogDigest: catalog.digest };
    const result = id === 'temporary'
      ? module[functionName]({ ...envelope, card })
      : id === 'beginning-draw'
        ? module[functionName](card, envelope)
        : id === 'equip'
          ? module[functionName](card, { dataVersion: catalog.dataVersion, catalogDigest: catalog.digest })
          : module[functionName](card);
    if (result.status === 'known') known.push(card);
    else reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
  }
  const sourcePath = `packages/card-dsl/src/duel/${moduleName}.ts`;
  descriptorResults.push({ id, source: lineOf(sourcePath, `export function ${functionName}`), sourceSha256: hash(read(sourcePath)),
    primitives, knownPrintingCount: known.length, knownIdentityCount: new Set(known.map(card => card.canonicalCardId)).size,
    primaryIdentityCount: known.filter(card => primary.get(card.canonicalCardId).id === card.id).length,
    printingIds: known.map(card => card.id), canonicalCardIds: sort(known.map(card => card.canonicalCardId)), unknownReasons: reasons });
}
for (const card of records) card.existingWholeDescriptions = descriptorResults.filter(item => item.canonicalCardIds.includes(card.id)).map(item => item.id);
const existingOpcodes = [
  { opcode: 'draw.cards', primitive: 'effect.draw', boundary: '固定整数 count；不含条件、触发、牌库选择' },
  { opcode: 'damage.target', primitive: 'effect.damage', boundary: '固定整数 amount / targetId；不含动态 Might、分摊、防伤' },
  { opcode: 'gain.energy', primitive: 'effect.resources', boundary: '整数 Energy + player；不含 Power 域 / 符文 channel' },
  { opcode: 'summon.self', primitive: 'effect.play', boundary: 'synthetic-demo 的 summon.self；官方 Unit 打出与 token 创建不能直接等同' },
].map(item => ({ ...item, source: lineOf('packages/card-dsl/src/index.ts', `| "${item.opcode}"`), lexicalRelatedCardCount: count(card => card.requiredPrimitives.includes(item.primitive)) }));

const bucket = key => Object.fromEntries(sort(records.map(card => card[key])).map(value => [value, count(card => card[key] === value)]));
const stats = {
  printingCount: catalog.cards.length, identityCount: records.length, catalogDataVersion: catalog.dataVersion,
  catalogDigest: catalog.digest, currentExecutablePrintings: coverage.executableCount,
  currentJudgeRequiredPrintings: coverage.judgeRequiredCount, currentNoAbilityPrintings: coverage.noAbilityCount,
  identityExecutionStatus: bucket('executionStatus'), identityClassification: bucket('classification'), cardTypes: bucket('cardType'),
  emptyPrimaryAbilityCount: count(card => ['no-ability-text'].includes(card.classification) || card.templates.includes('no-ability-text')),
  unclassifiedCount: count(card => card.classification === 'unclassified'),
  primaryNullEnergyCount: count(card => card.printed.energy === null), primaryNullPowerCount: count(card => card.printed.power === null),
  rawAbilityDifferenceCount: count(card => card.printingDifferences?.fields.includes('ability')),
  nonReminderDifferenceCount: count(card => card.printingDifferences?.nonReminderTextDifference),
  nonAbilityDifferenceCount: count(card => card.printingDifferences?.fields.some(field => field !== 'ability')),
  candidateCeiling: allPrimitiveCeiling, primitiveCount: definitions.length, templateCount: templates.length,
  descriptorIdentityUnion: new Set(descriptorResults.flatMap(item => item.canonicalCardIds)).size,
};
const sources = [catalogPath, coveragePath, 'docs/sources.md', 'docs/rules-audit-current.md', 'packages/card-dsl/src/index.ts',
  ...descriptorSpecs.map(([, moduleName]) => `packages/card-dsl/src/duel/${moduleName}.ts`), 'packages/card-dsl/src/duel/ability-bindings.ts',
].map(file => ({ file, sha256: hash(read(file)) }));
const data = {
  schema: 'riftbound.ability-template-survey.v1', surveyDate: '2026-10-15', analysisBaseCommit: 'e2cbcdf45ae6f98764951f20a6b67b9dfc4bb95a0',
  targetRuleset: 'Core Rules v1.5', authority: 'local-catalog lexical observations and explicitly inferred dependencies; not EffectIR or execution authority',
  algorithm: { version: 1, scriptSha256: hash(fs.readFileSync(process.argv[1])), offsetUnit: 'UTF-16 code units, half-open [start,end)',
    normalization: 'primaryPrintingId; parentheses masked only for functional cues; bracket references in reminders retained as referenced keyword requirements',
    curve: 'greedy completion bundles: maximum newly-completed non-blocked identities / newly-required primitives; ties by gain, difficulty weight, primitive IDs; dependency-topological per-primitive steps',
    curveAssumptions: ['rules kernel / catalog / deterministic events / privacy / command validation already available', 'every mapped cue and rule macro manually reviewed and fully implemented, all card IR golden cases pass', 'no data blockers; lexical coverage is an optimistic planning bound, not a proof of semantic completeness', 'all current official effect execution statuses remain unchanged'],
  }, sources, stats, templates, primitives: primitiveResults, implementationPlan: { thresholds, bundles, curve, unusedByCandidateCurve: definitions.filter(item => !implemented.has(item.id)).map(item => item.id) },
  existing: { opcodes: existingOpcodes, descriptions: descriptorResults }, cards: cardResults,
};
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', "'");
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.map(escape).join(' | ')} |`).join('\n');
const md = [];
const add = text => md.push(text);
add('# RIFT-9：1080 个卡牌身份的能力模板与原语调研\n');
add('日期：2026-10-15；任务分支 `task/RIFT-9-survey-ability-templates`；分析基线 `e2cbcdf45ae6f98764951f20a6b67b9dfc4bb95a`。范围仅本报告及同目录 JSON；未修改源码、测试、契约或生成卡牌数据。');
add(`本地实测 **${stats.printingCount} 个印刷 → ${stats.identityCount} 个身份**，全部进入 JSON；目录 schema / dataVersion 见 \`packages/card-data/data/deck-catalog.json:2\`、\`:3\`，唯一身份组从 groups 数组（\`packages/card-data/data/deck-catalog.json:31406\`）严格校验。**${stats.unclassifiedCount} 个身份进入未归类 / 资料冲突桶**（仍保留已识别线索）。现状 coverage 的原始计数直接来自 \`packages/card-data/data/effect-coverage.json:3\`（1381）、\`:4\`（1080）、\`:5\`（可执行 0）、\`:6\`（judge-required ${stats.currentJudgeRequiredPrintings}）、\`:7\`（no-ability ${stats.currentNoAbilityPrintings}）。**以下覆盖曲线是有前提的文本需求覆盖上界，不是已可执行卡数或可上线承诺。**`);
add('## 1. 依据、边界与复现\n');
add('任务卡明确采用已批准重设计：v1.5、一个当前引擎、EffectIR 数据 + 通用解释器、单 runtime / journal。本机 `/root/swarm-rift/shared/redesign.md:60` 描述效果原语方案，`:70` 给出原语族，`:72` 要求歧义 / 未实现卡保持 judge-required，`:75` 描述单 runtime。该材料 `:4` 仍标“待评审”，本任务按任务卡的批准说明作为调研方向；没有以此修改旧契约或回放。');
add('规则版本依据：`docs/sources.md:10`、`docs/sources.md:29`、`docs/rules-audit-current.md:7`。这些是仓库在 2026-10-12 的来源核对记录：v1.4 当时生效，目标 v1.5 生效日为 **2026-10-16**；2026-10-15 不能把它写成已生效。此轮只读本地材料，未重新联网核验公告，也未把说明文档当完整 v1.5 规则正文。`docs/rules-audit-current.md:45` 的来源权威边界、`:60` 的 judge-required 约束仍适用。');
add('目录以 `canonicalCardId` 分组，代表文本取 `groups[].primaryPrintingId`，不按名字二次合并。脚本严格检查 1381、1080、group 的完整成员和 coverage 一一对应。每张卡的证据含 catalog 的 `文件:行号`、原文 SHA-256、UTF-16 半开区间；JSON 顶层 `sources` 记录全部输入摘要。未将 `energy:null` / `power:null` 改成 0。');
add(`印刷差异：${stats.rawAbilityDifferenceCount} 个身份存在原文差异；去括号、压空白、去 [NO TEXT] 后仍有 ${stats.nonReminderDifferenceCount} 个身份不同；${stats.nonAbilityDifferenceCount} 个身份有卡类 / 属性 / 标签差异。**这只是机械差异，不等同语义冲突或勘误结论。** 这些身份保守移出曲线候选，待官方勘误核对；提醒文字差异单独记录而不自动判冲突。空主文本 ${stats.emptyPrimaryAbilityCount} 个身份，其中 Rune 的固有能力按推断列需求，绝不因空文本当无规则效果。`);
add('在仓库根执行（Node 22.22.2 / pnpm 11.9.0；依赖使用现有 frozen-lockfile 安装结果）：\n\n```bash\nmkdir -p /tmp/RIFT-9-survey-ability-templates\n# 将附录完整代码保存为 /tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs\nnode /tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs --root "$PWD" --out-dir "$PWD/docs/plans/survey"\n# 复现到临时目录并逐字节比对两个产物\nnode /tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs --root "$PWD" --out-dir /tmp/RIFT-9-survey-ability-templates/reproduced\ncmp docs/plans/survey/ability-templates.json /tmp/RIFT-9-survey-ability-templates/reproduced/ability-templates.json\ncmp docs/plans/survey/ability-templates.md /tmp/RIFT-9-survey-ability-templates/reproduced/ability-templates.md\n```');
add('脚本只写两个指定输出和 `/tmp/RIFT-9-survey-ability-templates/`。它将现有 card-dsl 编译到该临时目录，再实际调用九个 description 函数；不会改 `packages/*/dist`。附录本身是完整脚本，不依赖未提交的分析辅助文件。');
add('## 2. 方法与计数口径\n');
add('1. 用句号 / 问号 / 感叹号 / 换行拆句；括号按嵌套深度遮蔽，避免 reminder 重复计数；原文和偏移保留。目录中的连写 `battlefield.Look` 也可切开。此步骤是文本切分，不是规则语法解析。\n2. 方括号按实际词表识别，数值参数去尾部数字；[>] / [>>] 是布局符号，不算关键字。关键词引用分 functional-reference、reminder、unbracketed-reference，**不代表卡天然拥有该能力**。授予、条件查询和 Token 提醒中的引用都进入需求上界，可能高估。\n3. 对功能句扫描触发、费用、目标、效果动词、持续 / 替代 / 条件 / 选择线索。每个命中留匹配片段及原文偏移；依赖和宏展开是明确的工程推断。否定句、费用与效果、真实目标与集合引用需要后续人工消歧；命中 damage / instead 不足以证明会执行伤害 / 替代效果。\n4. 无实质操作或关键词的句子、畸形尾部、非提醒差异、属性 / 标签差异进入未归类桶。未归类是保守阻断；其余 lexical-candidate 也仅是命中线索，不能当完整编译或无歧义证明。所有卡 `requiresV15RuleReview:true`。\n5. 模板表和原语表是**可重叠身份数**：同卡在同一行最多计一次；不按出现次数，不按印刷数，不可直接把各行相加。direct 是字面 / 宏 / 卡类推断需求，required 是依赖闭包。');
add(table(['互斥主分类', '身份数'], Object.entries(stats.identityClassification)));
add(table(['卡类', '身份数'], Object.entries(stats.cardTypes)));
add(`主印刷 Energy 为 null：${stats.primaryNullEnergyCount}；Power 为 null：${stats.primaryNullPowerCount}。identityExecutionStatus（任一印刷 judge-required 即保守保留）为 ${JSON.stringify(stats.identityExecutionStatus)}。`);
add('## 3. 模板表\n');
add('模板是可组合的句式 / 关键词族，而非完整卡程序；`primitives` 为该模板局部依赖，不代表整卡需求。低 / 中 / 高是实现复杂度估计。每行都需 v1.5 规则复核；“阻断 N”表示该行匹配身份中另有未归类问题，不是已由裁判判定的数量。完整片段、卡源和逐卡组合见 JSON。');
add(table(['模板 / ID', '示例与出处', '覆盖身份', '涉及原语（直接）', '难度', '规则裁定 / 复核'], templates.map(item => [
  `${item.name} (${item.id})`, `${item.example.printingId}: ${item.example.text.slice(0, 150)} · ${item.example.source}`,
  item.cardCount, item.primitives.join(', ') || '无 / 见逐卡保留需求', item.difficulty, `v1.5 复核；阻断 ${item.blockerCardCount}`,
])));
add('Hold / Conquer 实际作为触发句出现；Recruit 是 Token 名称，既不是 [Recruit] 关键词，也不是单独的效果 opcode。Equip 同时存在带方括号和普通单词形式。Assault / Shield 的数字、Show Off 的对象、Empowered 条件块、[>] 布局、Rune 符号均保留在逐卡 evidence，不据词频补默认语义。');
add('## 4. 建议的 EffectIR v2 原语清单（工程推断）\n');
add('分类固定为 cost / target / effect / trigger / replacement / continuous（持续）/ condition（条件）/ choice（选择）。依赖是本报告用于估算的模块关系；它们不是已批准类型定义，也不是已实现声明。effect.zone、事件、对象引用、选择收据的具体契约由父任务制定。每个名称有稳定 ID；需要某关键词而未明确实施时，整卡继续 judge-required。');
add(table(['类别 / 原语', '直接 / 含依赖身份数', '依赖', '难度', '语义边界 / 待核验'], primitiveResults.map(item => [
  `${item.category} / ${item.id}: ${item.title}`, `${item.directCardCount} / ${item.requiredCardCount}`, item.dependencies.join(', ') || '无', item.difficulty, item.caution,
])));
add('Token 能力、复制目标的能力、授予任意引用能力等动态依赖不能由这些静态边完全证明；上述 effect.token / effect.copy / continuous.keyword 只是静态规划族。批量编卡时必须对引用到的 Token 定义、被授予宏、动态闭包继续做验证，未闭合时阻断。');
add('## 5. 按覆盖收益的实现路线与累积曲线\n');
add('规划公式：C(S) = 当前无资料阻断且 requiredPrimitives ⊆ S 的身份数。分母固定 1080；无能力卡也要求基础内核和正常费用。先实现基础内核（官方开局 / 回合 / 战斗 / 计分、状态和事件、HOT FEPR、隐藏投影、确定性随机和 command journal），这些不作为免费已实现效果；曲线仅估算其后的卡效工作。**所有步骤均假设完整语义复核、IR 编写与每卡 golden 通过；没有这些前提，实际新增可执行数仍是 0。**');
add('排序用“完成整卡所需原语包”的贪心：枚举尚未闭合卡的缺失依赖包，最大化 `新闭合身份数 / 新增原语数`；同分按新增身份、估计难度（低 1 / 中 2 / 高 3）、ID 破同分，再按依赖拓扑逐原语落点。这避免只有最后一块原语才有收益的互补问题，但**不是全局最优，也不是工期估算**。每个原语权重 1 的曲线会偏向通用模块，难度只用于同分。');
add(table(['目标', '需要身份', '达到时原语数', '规划闭合身份', '说明'], thresholds.map(item => [
  `${item.targetPercent}%`, item.requiredCards, item.primitiveCount ?? '不可达', `${item.cumulativeCards} (${percent(item.cumulativeCards)}%)`, item.reachable ? '仅静态需求上界' : `当前资料 / 未识别阻断限制；先处理剩余 ${item.residualBlockerCount} 个身份`,
])));
for (const item of thresholds) add(`**${item.targetPercent}% 的累计原语集合**${item.reachable ? `（前 ${item.primitiveCount} 项）` : '（现有候选全部实现仍未达到）'}：\n\n${item.primitives.map(id => `\`${id}\``).join('、')}。`);
add(table(['N', '新增原语', '新增闭合身份', '累计身份', '占 1080'], curve.map(item => [item.primitiveCount, item.addedPrimitive ?? '(基础内核前提下的空需求)', item.newlyCovered, item.cumulativeCards, `${item.coveragePercent}%`])));
add(`候选曲线天花板：${allPrimitiveCeiling}/1080 = ${percent(allPrimitiveCeiling)}%。未进入候选路线的原语：${data.implementationPlan.unusedByCandidateCurve.join(', ') || '无'}。完整按包收益及逐原语曲线在 JSON 的 implementationPlan；不得把粗略“出现过这个动词”统计直接解释为可执行整卡。`);
add('建议父任务顺序：先冻结目标 / 值表达式 / 费用承诺 / 事件 / 持续时间 / 隐藏选择的公共表示，再按上表原语包实施及编卡；30% / 70% 阶段都以整卡 golden 闭合验收；95% 若被资料问题阻挡，先核对下节差异与残句，再新增经过规则证据证明的原语。禁止为了达到比例把未识别句忽略或当 no-op。');
add('## 6. 现有 opcode 与 description 可复用部分\n');
add('`packages/card-dsl/src/index.ts:860` 的 EffectOpcode 只有四项，参数表在 `:885`；它们来自 synthetic-demo IR，存在类型不代表当前官方卡通过编译。下表关联卡数是本报告需求的重叠线索数，绝不是四个 opcode 已覆盖的卡数。');
add(table(['已有 opcode', '对应规划原语', '需求关联身份', '可复用 / 缺口'], existingOpcodes.map(item => [item.opcode, item.primitive, item.lexicalRelatedCardCount, `${item.boundary} · ${item.source}`])));
add('九个 description 以**当前源码临时编译后逐印刷调用**统计，只有返回 status=known 才计；不把关键词子串当 whole-ability known。身份列按任意印刷 known 去重，主印刷列更严格；没有修改 registry，也没有授予执行权。其规则依据多为 CR v1.4，复用前仍须核验 v1.5。');
add(table(['description / 源码', 'known 印刷 / 身份 / 主印刷身份', '对应原语'], descriptorResults.map(item => [
  `${item.id} · ${item.source}`, `${item.knownPrintingCount} / ${item.knownIdentityCount} / ${item.primaryIdentityCount}`, item.primitives.join(', '),
])));
add(`description known 身份并集为 ${stats.descriptorIdentityUnion}（行间有重叠可能，不相加）。` + ' `packages/card-dsl/src/duel/ability-bindings.ts:53` 另有 Ganking 字面绑定；它也不是完整卡程序覆盖。JSON existing.descriptions 给出全部 known 印刷 / 身份及 unknown 原因直方图，便于后续按原文复用。');
add('## 7. 未归类、数据问题与规则待决\n');
add('以下列表是所有未归类身份的显式阻断原因。未列出的 lexical-candidate 也有句法误判风险；尤其 Trigger 作用域、grant 与 query、费用 / 效果、instead 条件分支 / 替代、同名 / Token 动态能力不可自动定论。`requiresV15RuleReview` 不参与乐观曲线过滤，否则所有官方卡都应继续阻断；真实运行必须核验它。');
add(table(['身份 / 主印刷', '阻断原因', '残句（若有） / 出处'], records.filter(card => card.blockers.length).map(card => [
  `${card.name} (${card.primaryPrintingId})`, card.blockers.join(', '), `${card.unmatchedClauses.map(clause => clause.text).join(' / ') || '见 printingDifferences 或畸形尾部'} · ${card.source}`,
])));
add('规则 / 契约变更请求（建议，未修改任何契约）：\n\n- EffectIR v2 需要序列与结果变量、值表达式和 null、费用记录、对象 / 地点绑定、触发与延迟触发、持续层与替代处理、隐藏选择 / 模式 / 排序；由父任务与规则负责人冻结字段。\n- Token / 复制 / grant 的被引用能力必须有依赖闭包或显式运行时能力边界，不能只看本卡出现的词。\n- v1.5 新关键词（目录确有 Empower / Empowered / Burn / Deploy / Disarm / Show Off 等）的正式规则与全部印刷差异须核对官方规则 / 勘误；本报告不推测数值默认、作用域或冲突优先级。\n- 单 runtime / journal 与旧回放政策按父任务的已批准方案实施；本任务没有变更历史 profile / schema。');
add('## 8. JSON 消费、校验与证据\n');
add('JSON 是调研 schema `riftbound.ability-template-survey.v1`，不是 EffectIR v2 合约。cards 是 canonicalCardId → 记录；templates 是匹配 ID 列表；directPrimitives / requiredPrimitives 分开；clauses / unmatchedClauses / evidence 给出片段与偏移；printingDifferences 不替代官方勘误。executionStatus 保留现状，classification 仅用于任务分片，不能作为执行白名单。');
add('读取示例（仓库根）：\n\n```bash\nnode --input-type=module - <<\'JS\'\nimport fs from "node:fs";\nimport assert from "node:assert/strict";\nconst survey = JSON.parse(fs.readFileSync("docs/plans/survey/ability-templates.json", "utf8"));\nassert.equal(survey.schema, "riftbound.ability-template-survey.v1");\nassert.equal(Object.keys(survey.cards).length, 1080);\nfor (const [canonicalCardId, card] of Object.entries(survey.cards)) {\n  assert(card.templates.length > 0);\n  assert(card.requiredPrimitives.every(id => survey.primitives.some(item => item.id === id)));\n  if (card.classification === "unclassified") console.log(canonicalCardId, card.primaryPrintingId, card.blockers);\n}\nconsole.log(JSON.stringify(survey.stats));\nJS\n```');
add('生成器关键输出（同输入确定性重跑）：\n\n```json\n' + JSON.stringify({ ...stats, milestones: thresholds.map(({ targetPercent, reachable, primitiveCount, cumulativeCards }) => ({ targetPercent, reachable, primitiveCount, cumulativeCards })) }, null, 2) + '\n```');
add('验证包含：输入成员 / 去重 / coverage 对齐、1080 个身份均有模板、每个原语存在、依赖无环和闭包幂等、曲线单调及候选天花板一致、未识别括号词 fail-closed、九个 description 逐印刷实测、两个文件同输入重跑逐字节一致。未修改包，不运行全仓 / 包测试或服务；此处不借用历史测试数量作为当前通过证据。运行日志在 `/tmp/RIFT-9-survey-ability-templates/analysis.log` 和 `validation.log`，临时文件不提交。');
add('## 附录：完整可复现分析脚本\n');
add('保存为 `/tmp/RIFT-9-survey-ability-templates/analyze-abilities.mjs`，保持 UTF-8 和末尾换行。脚本源码 SHA-256 见 JSON algorithm.scriptSha256。');
add('````javascript\n' + fs.readFileSync(process.argv[1], 'utf8').trimEnd() + '\n````');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'ability-templates.json'), JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'ability-templates.md'), md.join('\n\n') + '\n');
console.log(JSON.stringify({ ...stats, milestones: thresholds.map(({ targetPercent, reachable, primitiveCount, cumulativeCards }) => ({ targetPercent, reachable, primitiveCount, cumulativeCards })) }, null, 2));
````
