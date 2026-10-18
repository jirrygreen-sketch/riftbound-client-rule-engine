# RIFT-781：全量 judge-required 卡的引擎缺口与派发清单

快照日期：2026-10-18；integration **`06bf1171c46e`**。工作分支起点 `9d6fba27`；读取 integration 的 12 个差异文件时使用 `git show`，未改卡牌、引擎或契约。数字只代表这个不可变快照，后续合并应重新核对。

**覆盖 922/922 张 judge-required 卡；归并为 56 个引擎任务；7 张另有规则/文本裁定阻塞，10 张另有源数据问题，1 张为提醒文本分类审核（无引擎依赖）。** 全部逐卡理由、IR 摘要、1,653 个 `test.todo` 标题、映射证据、源/测试哈希与反向索引保存在 [engine-gaps.json](engine-gaps.json)。

## 计数、证据与派发约定

按唯一 canonical 身份计卡，不按印刷数计。1,080 个程序 = 141 `executable` + 17 `no-ability` + 922 `judge-required`。`executable` 标签、独立原语成功或 TODO 都不证明默认生产路径可玩。卡仍全部保留原状态，本报告不自动升级任何卡。

排名按每个任务直接关联的受阻卡数（去重潜在解锁覆盖）递减；同卡可有多个阻塞，**各行不可相加**。JSON 的 `closureUnlockCount` 另给出“完成该任务和全部 deps 后，全部已知阻塞被消除”的卡数；`marginalUnlockAfterDeps` 是相对只完成 deps 的增量。它们仍以之后补卡、真实执行测试通过为前提。

同一个共享源文件需要多种能力时合成一个文件 owner 任务，scope 明确列出子问题，避免几十个任务同时改 `chain/engine.ts` 或 `programs/statics.ts`。独立能力采用标记为“建议新建”的专用适配模块；接入由对应现有入口文件 owner 完成。`owns` 全局不重叠，因此同批也不重叠；不能越域改路由或契约。每任务另有唯一新测试文件。

`EG-CONTRACT` 只派协调者：所有 IR/动作/状态变更集中追加，先审接口再派依赖任务；**IR 扩展（只增不改）**，不修改既有语义、默认 profile/schema 或旧日志。生成索引用现有脚本，由协调者统一集成；不把生成输出、锁文件和官方卡牌数据列入写域。

证据顺序：固定 integration 的 IR/judgeReason/对应测试 TODO → 当前引擎源码闭集与入口 → 516 份最新任务总结 → 最新门禁真实非 TODO 错误；GPU 仅线索。922 份 GPU 文件中 917 可解析、5 含 error，它把 Acceptable Losses 的逐玩家执行误分为 rule；按 355.10.e/412.1 归引擎作用域，而非裁定。

最新读取门禁为 `/root/swarm-rift/logs/gate-51cd2b97.log`：card-dsl **12,004 tests / 9,893 pass / 88 fail / 2,021 TODO**；它早于本报告快照，未重新执行、不得冒充当前验证通过。硬编码 `expected 45 / actual 46` 是过时测试，不是新增原语需求；真实未注册 op 单独保留。规则只引用共享 `CR-v1.5.txt`，JSON 记录其独立文本哈希；PDF 来源哈希以 `docs/rule-source-manifest.json` 为准。

## 已剔除的过时理由

- **缺通用 TriggerRegistration/触发注册**：programs/triggers.ts 已注册程序；拆为事件词表、过滤、payload 与前导 may/费用/生命周期。
- **conquer/hold/score 完全没有生产者**：turn/flow.ts 已有 Score wave；缺 here/参与者绑定及个别计分消费者，不重复派通用事件生产任务。
- **continuous.might 或 this-turn 缺失**：指令及 arithmetic/end-of-turn 已存在；只派 base/特殊变换、动态表达式、层重算和注册身份缺口。
- **cost.pay/cost.modify/optionalAdditional 或 [A] 需求完全缺失**：费用计划与六域 allowedDomains 的任意域需求已存在；缺声明到 Finalize、对象/数量选择、收据及 Universal 资源来源。
- **Ganking permission.routes 归一化完全缺失**：continuous.movement 原语已归一化；静态声明/动态授予与 Standard Move 的消费仍未完整接通。
- **动态关键词展开引擎不存在**：KeywordGrantLayerEngine 已存在；默认 ChainEngine 仍用 LayerEngine，非静态展开 fail-closed。
- **player-property/turn-number/designation 等 IR 和读取器不存在**：expr-ext 已有实现；缺主 expr/condition 与默认 static 环境派发，不另造等价读取器。
- **LocationSelector/LocationRef/zoneSlice/linked 全部缺失**：候选器与有序来源已有；缺某些位置表达式跨 primitive 消费和 filter/linked 结算期选项，不能按旧理由整套重写。
- **MatchCard 不含印刷字段且所有 main-deck 一律 unit**：RIFT-760 已加入 cardType/types/tags/domains/energy/power/might 并规范化；headless README 此段是旧观察。剩余为端到端目录投影/Power 数值与生命周期，未重跑历史 100 局。
- **effect.token 与 token Play 完全没有接手**：基础五种 token 和 Chain create→play 接手已有；缺特殊定义、入场覆盖/地点与生产 Host 组装。
- **46 个 op 相对测试硬编码 45 的差异是引擎缺口**：最新门禁 LeBlanc/Siphoning 的 expected 45 actual 46 是测试陈旧计数；不派新增 op 解决计数错误，真正 trigger.leave/delayed 仍须实现。
- **Death from Below 的 may 范围必须再等官方裁定**：CR v1.5 388.4 直接以本卡说明反身项 Finalize 决定；归 EG-REFLEXIVE/EG-TRIGGERS，旧程序文本与 IR 的同步由后续写卡复核；保持 judge-required。
- **Virtuoso 的首个 may 因契约 optional 体而缺官方规则**：383.3.a/.a.3 已区分首段与后段；契约形状不能推翻规则。保留前导 may 和 linked/receipt 引擎缺口，待规则核验，不据此新增无依据官方裁定。

## 前 20 个缺口

| 排名 | 任务 | 具体缺口 | 受阻卡数 | 批次 | 规模 | 完成任务+deps 的候选解锁数 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | EG-STATIC | 静态声明的 appliesTo、费用与规则映射及动态宿主绑定 | 405 | B4 | XL | 32 |
| 2 | EG-CONTRACT | 协调者统一追加 IR/动作/状态契约与注册导出 | 231 | B0 | XL | 0 |
| 3 | EG-FILTER | CardProgram 对象与触发过滤器的符号适配 | 231 | B2 | L | 5 |
| 4 | EG-FINALIZE | 统一链 Finalize 接入费用、选择与合法性适配器 | 217 | B6 | XL | 213 |
| 5 | EG-KEYWORDS | 关键词印刷参数、费用与正文展开 | 210 | B1 | L | 0 |
| 6 | EG-EXPR | 主解释器接入玩家/回合/历史/战斗指定表达式 | 194 | B1 | L | 2 |
| 7 | EG-COSTBIND | 程序印刷/追加费用与支付收据适配 | 171 | B4 | L | 13 |
| 8 | EG-TRIGGERS | 触发条件、前导 may/费用及事件 it 的生产绑定 | 140 | B3 | L | 21 |
| 9 | EG-COMBAT | 战斗开启、角色指定和同时伤害原子事务 | 136 | B4 | XL | 24 |
| 10 | EG-RULES | 规则修改查询与实际动作消费者 | 126 | B2 | L | 5 |
| 11 | EG-DISCOUNTS | 生产折扣收集、追加费条件与一次性窗口 | 125 | B2 | L | 2 |
| 12 | EG-PAYLOAD | 动作事件的对象、责任归属、起终点与批次载荷 | 124 | B2 | L | 2 |
| 13 | EG-COSTCHOICE | 动态对象费用、任意数量支付与计划收据 | 121 | B3 | L | 4 |
| 14 | EG-FILTERS | 运行期集合过滤的关系、特征和位置值谓词 | 115 | B1 | L | 0 |
| 15 | EG-TARGETS | 非目标 PickSpec 查询与链接/嵌套选择生命周期 | 107 | B2 | L | 2 |
| 16 | EG-EVENTS | 触发事件闭集、时点别名与 once 词汇对齐 | 105 | B1 | L | 1 |
| 17 | EG-TURN | 回合清理、计分限制/阈值、Burn Out 与额外回合 | 92 | B5 | XL | 33 |
| 18 | EG-TOKEN | Token 定义、状态/落点与真实 Play 入口 | 80 | B5 | L | 13 |
| 19 | EG-REPLACEMENT | 替代体规划、入口选择器与未支持 opcode | 79 | B4 | L | 7 |
| 20 | EG-LIFECYCLE | 死亡前收集、离区 LKI 与跨区能力注册生命周期 | 78 | B5 | L | 76 |

## 并行批次与顺序

依赖已展开成 DAG；先 B0，再按 B1…逐批启动，同批可全部并行。排名表示覆盖收益，不替代依赖顺序。所有任务可一次入队，调度器按 deps 放行。规模为净工程日粗估：S 0.5–1，M 1–2，L 3–5，XL 6–10；含相关测试，不含等待/裁定/后续逐卡改写。

| 批次 | 可并行任务（缩写均加 EG-） | 完成该批累计消除全部已知阻塞 | 可用卡潜在数（含17无能力） |
| --- | --- | --- | --- |
| B0 | CONTRACT | 0 | 158 |
| B1 | KEYWORDS, EXPR, FILTERS, EVENTS, LOCATIONS, POWER, TAX, ADAPTER, LEAVE, HARNESS | 8 | 166 |
| B2 | FILTER, RULES, DISCOUNTS, PAYLOAD, TARGETS, LAYERS, GEAR, EMPOWER, RECALL, LEGEND, DAMAGE | 54 | 212 |
| B3 | TRIGGERS, COSTCHOICE, PERMISSIONS, CHOICEPLAN, HIDDEN, GRANTS, PIPELINE, MOVE, MULTIPLAYER, INSPECT, COMBATPRIORITY, ZONES, MIGHT, NAMED, BUFF, MODIFIERS, KILL, LINKED, TRAITS | 187 | 345 |
| B4 | STATIC, COSTBIND, COMBAT, REPLACEMENT, PLAY, REFLEXIVE | 473 | 631 |
| B5 | TURN, TOKEN, LIFECYCLE, ADD, DELAYED, COPY | 674 | 832 |
| B6 | FINALIZE | 883 | 1041 |
| B7 | MATCH | 894 | 1052 |
| B8 | RUNTIME | 904 | 1062 |

协调者保留契约/包导出/生成索引、跨模块接口与最终全工作区集成权；其他任务只写自己的模块。引擎任务验收先 `pnpm --filter @riftbound/engine-core typecheck`，再 `heavy pnpm --filter @riftbound/engine-core test` 和下游 `heavy pnpm --filter @riftbound/game-server test`；运行时任务验收 game-server 对应命令。最终全量回归与 headless 自然胜由调度者统一排队，不由本盘点触发。

## 全部可派发任务

下列“受阻卡”完整列出该任务关联的当前 judge-required 卡，键为 `set/slug`。全 canonical、源文件、TODO、每个映射的理由原文和全部依赖闭包见 JSON；不是只列代表卡。每项的源码/错误/规则证据可定位到文件行。

### 1. EG-STATIC — 静态声明的 appliesTo、费用与规则映射及动态宿主绑定

受阻 **405** 张；**B4 / XL**（6–10 工程日）；deps：EG-CONTRACT, EG-RULES, EG-GRANTS, EG-DISCOUNTS, EG-TAX, EG-PERMISSIONS。 优先复用现有 IR。

**实现与验收**：逐项支持有依据的 appliesTo；费用/时机/位置/目标税声明分派给其专用消费者；other/exclude、位置和控制者在查询时绑定；逐对象条件不得吞错成真。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/statics.ts`；`packages/engine-core/src/programs/static-adapters/**`（建议新建）；`packages/engine-core/test/engine-gaps/static.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/programs/statics.ts:134`：`throw new ProgramBindingError('judge-required', 'Unsupported static appliesTo ${JSON.stringify(appliesTo)}');`。
- `packages/engine-core/src/programs/statics.ts:62`：`throw new ProgramBindingError('judge-required', 'Static ability kind ${String(effect.kind ?? '<missing>')} has no layer mapping');`。
- `packages/engine-core/src/programs/statics.ts:110`：`throw new ProgramBindingError('judge-required', 'Static ${key} anchor needs a dynamic relative filter');`。
- CR v1.5：478.1, 479.1, 356.4；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：er + allowedDomains 表示，不是契约缺口。(2) 条件性 +2 Might 已可执行：执行侧 continuous.might 与 programs/statics.ts 的 bindStaticToLayers/attachProgramLifecycle 都已合入，golden 经图层求值实测得到 4 → 6，且 buffs 仍为 0（不写成 Buff）。(3) 条件性 [Ganking] 的产出侧已合入但生产未装配：continuous.grant-keyword 原语、abilit。
- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：1.1.c 的 Hide 自由行动、811.1.d 的面朝下打出（含战场限定）与 811.6 的下一回合 Reaction 许可仍无执行路径：展开出的静态半段在生产绑定上 fail-closed（attachProgramLifecycle 的默认 createEngineStaticBinder 抛 ProgramBindingError(judge-required, "Static ability kind cost.hidden has no layer mapping")），封闭 G。

**受阻卡（完整）**：`ogn/acceptable-losses`、`ogn/bandle-tree`、`ogn/blastcone-fae`、`ogn/blazing-scorcher`、`ogn/blind-fury`、`ogn/block`、`ogn/brazen-buccaneer`、`ogn/bullet-time-miss-fortune`、`ogn/call-to-glory`、`ogn/cannon-barrage`、`ogn/captain-farron`、`ogn/cleave`、`ogn/commander-ledros`、`ogn/confront`、`ogn/convergent-mutation`、`ogn/daring-poro`、`ogn/darius-executioner`、`ogn/dazzling-aurora`、`ogn/deadbloom-predator`、`ogn/defy`、`ogn/disintegrate`、`ogn/dr-mundo-expert`、`ogn/draven-showboat`、`ogn/eager-apprentice`、`ogn/ekko-recurrent`、`ogn/facebreaker`、`ogn/fight-or-flight`、`ogn/find-your-center`、`ogn/fiora-victorious`、`ogn/flurry-of-blades`、`ogn/fox-fire-ahri`、`ogn/gemcraft-seer`、`ogn/gust`、`ogn/heimerdinger-inventor`、`ogn/herald-of-scales`、`ogn/hidden-blade`、`ogn/imperial-decree`、`ogn/jeweled-colossus`、`ogn/karthus-eternal`、`ogn/kraken-hunter`、`ogn/last-stand`、`ogn/lee-sin-ascetic`、`ogn/lee-sin-centered`、`ogn/legion-rearguard`、`ogn/leona-determined`、`ogn/leona-zealot`、`ogn/mageseeker-warden`、`ogn/malzahar-fanatic`、`ogn/meditation`、`ogn/miss-fortune-buccaneer`、`ogn/miss-fortune-captain`、`ogn/mystic-reversal`、`ogn/noxian-guillotine-darius`、`ogn/noxus-hopeful`、`ogn/noxus-saboteur`、`ogn/overt-operation`、`ogn/pakaa-cub`、`ogn/petty-officer`、`ogn/portal-rescue`、`ogn/possession`、`ogn/pouty-poro`、`ogn/qiyana-victorious`、`ogn/rhasa-the-sunderer`、`ogn/ride-the-wind`、`ogn/sai-scout`、`ogn/sett-brawler`、`ogn/shakedown`、`ogn/shen-kinkou`、`ogn/sky-splitter`、`ogn/sneaky-deckhand`、`ogn/spirits-refuge`、`ogn/spoils-of-war`、`ogn/sprite-call`、`ogn/stand-united`、`ogn/taric-protector`、`ogn/tasty-faefolk`、`ogn/teemo-scout`、`ogn/teemo-strategist`、`ogn/thermo-beam`、`ogn/thousand-tailed-watcher`、`ogn/tideturner`、`ogn/trifarian-gloryseeker`、`ogn/trifarian-war-camp`、`ogn/unyielding-spirit`、`ogn/vayne-hunter`、`ogn/vi-destructive`、`ogn/void-gate`、`ogn/volibear-furious`、`ogn/volibear-imposing`、`ogn/wallop`、`ogn/wielder-of-water`、`ogn/windswept-hillock`、`ogn/zenith-blade-leona`、`ogn/zhonyas-hourglass`、`ogs/annie-fiery`、`ogs/garen-commander`、`ogs/garen-rugged`、`ogs/highlander-yi`、`ogs/master-yi-meditative`、`ogs/recruit-the-vanguard`、`ogs/wuju-bladesman-starter`、`ogs/zephyr-sage`、`rad/an-offer-you-cant-refuse`、`rad/banner-of-conquest`、`rad/bedeviling-stranger`、`rad/blossoming-dreamroot`、`rad/concert-poster`、`rad/consult-the-heavens`、`rad/demacian-standard`、`rad/demon-shade`、`rad/detonation-amplifier`、`rad/dockside-lock-up`、`rad/dune-devourer`、`rad/elnuk-herd`、`rad/ezreal-dashing`、`rad/for-demacia`、`rad/heartening-soul`、`rad/hexplosive-minefield`、`rad/hold-em`、`rad/hunker-down`、`rad/hunters-circle`、`rad/hunting-dog`、`rad/hush`、`rad/invigorating-bloom`、`rad/jarvan-iv-martial-paragon`、`rad/jarvan-iv-royal-heir`、`rad/kaisa-rebel`、`rad/ki-burst`、`rad/ksante-courageous`、`rad/last-caress`、`rad/life-from-stone`、`rad/lost-to-the-sands`、`rad/momentary-companion`、`rad/mordekaiser-twice-slain`、`rad/ntofo-strikes`、`rad/orianna-mechanical-marvel`、`rad/overloaded-traveler`、`rad/party-crasher`、`rad/pillaged-armory`、`rad/portable-portal`、`rad/primordial-roar`、`rad/reckless-innovator`、`rad/resource-extractor`、`rad/riven-broken-blade`、`rad/satchel-charge`、`rad/scorched-earth`、`rad/sirens-song`、`rad/skystrike-squadron`、`rad/starry-eyed-songstress`、`rad/storm-raptor`、`rad/the-ball`、`rad/the-empyrean`、`rad/the-waters-wage`、`rad/war-scout`、`rad/watchful-curator`、`rad/ziggs-explosive`、`rad/ziggs-short-fused`、`sfd/akshan-mischievous`、`sfd/ancient-warmonger`、`sfd/angle-shot`、`sfd/arcane-shift`、`sfd/armed-assailant`、`sfd/azir-sovereign`、`sfd/bard-mercurial`、`sfd/battering-ram`、`sfd/bellows-breath`、`sfd/blast-corps-cadet`、`sfd/blood-money`、`sfd/blood-rush`、`sfd/breakneck-mech`、`sfd/bushwhack`、`sfd/called-shot`、`sfd/chem-baroness`、`sfd/corinna-veraza`、`sfd/counter-strike`、`sfd/danger-zone`、`sfd/drag-under`、`sfd/draven-audacious`、`sfd/edge-of-night`、`sfd/emperors-divide`、`sfd/ezreal-prodigy`、`sfd/feral-strength`、`sfd/forge-of-the-fluft`、`sfd/forgotten-monument`、`sfd/frigid-touch`、`sfd/frostcoat-cub`、`sfd/gearhead`、`sfd/guards`、`sfd/hard-bargain`、`sfd/here-to-help`、`sfd/hextech-anomaly`、`sfd/hostile-takeover`、`sfd/irelia-fervent`、`sfd/irelia-graceful`、`sfd/janna-savior`、`sfd/jaull-fish`、`sfd/jax-unmatched`、`sfd/kato-the-arm`、`sfd/laurent-duelist`、`sfd/legion-quartermaster`、`sfd/marai-spire`、`sfd/marching-orders`、`sfd/minotaur-reckoner`、`sfd/navori-scout`、`sfd/needlessly-large-yordle`、`sfd/not-so-fast`、`sfd/ornn-forge-god`、`sfd/ornns-forge`、`sfd/purifier`、`sfd/rabadons-deathcrown`、`sfd/rally-the-troops`、`sfd/reksai-breacher`、`sfd/relentless-pursuit`、`sfd/rell-magnetic`、`sfd/renata-glasc-industrialist`、`sfd/rengar-pouncing`、`sfd/rocket-barrage`、`sfd/sea-monkey`、`sfd/show-of-strength`、`sfd/shurelyas-requiem`、`sfd/sivir-ambitious`、`sfd/sivir-mercenary`、`sfd/soraka-wanderer`、`sfd/steraks-gage`、`sfd/sudden-storm`、`sfd/switcheroo`、`sfd/thwonk`、`sfd/tianna-crownguard`、`sfd/vex-cheerless`、`sfd/void-drone`、`sfd/wages-of-pain`、`sfd/windsinger`、`sfd/zaun-punk`、`unl/abandon`、`unl/allay-eager-admirer`、`unl/alpha-strike`、`unl/alpha-wildclaw`、`unl/arachnoid-horror`、`unl/atakhan`、`unl/back-off`、`unl/bandle-soldier`、`unl/baron-nashor`、`unl/baron-pit`、`unl/bird`、`unl/black-flame-altar`、`unl/black-rose-dignitary`、`unl/blue-sentinel`、`unl/bone-skewer`、`unl/brush`、`unl/combat-experience`、`unl/concentrate`、`unl/conscription`、`unl/crescent-guardian`、`unl/crescent-strike`、`unl/crimson-pigeons`、`unl/curtain-call`、`unl/daisy`、`unl/determined-sentry`、`unl/diana-no-longer-human`、`unl/disposal-order`、`unl/double-trouble`、`unl/downstage-dramatics`、`unl/elder-dragon`、`unl/evelynn-entrancing`、`unl/existential-dread`、`unl/flurry-of-feathers`、`unl/galio-indefatigable`、`unl/gardens-of-becoming`、`unl/gemhand-hunter`、`unl/grim-apothecary`、`unl/grim-resolve`、`unl/gustwalker`、`unl/heedless-resurrection`、`unl/heroic-charge`、`unl/honeyfruit`、`unl/inferna`、`unl/jhin-meticulous-killer`、`unl/jhin-murderous-artist`、`unl/keeper-of-masks`、`unl/keepers-verdict`、`unl/leblanc-everywhere-at-once`、`unl/leblanc-fragmented`、`unl/lillia-fae-fawn`、`unl/lilting-lullaby`、`unl/lord-broadmane`、`unl/lotus-trap`、`unl/mageseeker-investigator`、`unl/master-yi-tempered`、`unl/master-yi-unstoppable`、`unl/mischievous-marai`、`unl/mister-root`、`unl/monch`、`unl/monster-harpoon`、`unl/moonfall`、`unl/mosstomper`、`unl/mutated-mouser`、`unl/nami-headstrong`、`unl/nidalee-cat-form`、`unl/nilah-joyful-ascetic`、`unl/petal-pixie`、`unl/poppy-defender-of-the-meek`、`unl/poppy-paragon`、`unl/prepared-neophyte`、`unl/pyke-dockside-butcher`、`unl/pyke-returned`、`unl/red-brambleback`、`unl/rengar-trophy-hunter`、`unl/rengar-unseen`、`unl/repulse`、`unl/sacrifice`、`unl/safety-inspector`、`unl/scorchclaw`、`unl/scorn-of-the-moon`、`unl/shadow`、`unl/sharkling`、`unl/smite`、`unl/smoke-and-mirrors`、`unl/soul-shepherd`、`unl/square-up`、`unl/stalking-wolf`、`unl/sumpworks-map`、`unl/syndra-transcendent`、`unl/tactical-retreat`、`unl/targonian-visionary`、`unl/thrill-of-the-hunt`、`unl/towering-combatant`、`unl/towering-pairofant`、`unl/trevor-snoozebottom`、`unl/undying-loyalty`、`unl/vault-breaker`、`unl/vex-apathetic`、`unl/vex-mocking`、`unl/vi-hotheaded`、`unl/vi-peacekeeper`、`unl/vilemaw`、`unl/walking-roost`、`unl/wily-newtfish`、`ven/akali-silent`、`ven/applied-researchers`、`ven/aurok-general`、`ven/baccai-sandspinner`、`ven/brittle-steel`、`ven/crumbling-sands`、`ven/decree-of-focus`、`ven/decree-of-insight`、`ven/decree-of-rage`、`ven/disciple-of-shen`、`ven/dominus`、`ven/dragon-form`、`ven/dragon-roost`、`ven/dredge-up`、`ven/dune-surfer`、`ven/eclipse-dragon`、`ven/endless-riches`、`ven/escaped-grayback`、`ven/fallen-feline`、`ven/frostcoat-mother`、`ven/grumpy-rockbear`、`ven/gust-monk`、`ven/guttural-roar`、`ven/heisho-shell-of-the-world`、`ven/helm-of-suppression`、`ven/iterative-design`、`ven/kayle-justified`、`ven/keeper-of-law`、`ven/kennen-keeper-of-balance`、`ven/kennen-storm-of-shuriken`、`ven/ki-barrier`、`ven/kinkou-temple`、`ven/lacerate`、`ven/lightning-rush`、`ven/masa-crashing-thunder`、`ven/mel-newly-awakened`、`ven/mesmerize`、`ven/mournful-witness`、`ven/mystic-vortex`、`ven/nasus-ascended`、`ven/nasus-guardian-of-knowledge`、`ven/ocean-drake`、`ven/ol-poro`、`ven/onslaught`、`ven/perfect-execution`、`ven/piltovan-forge`、`ven/plaza-guardian`、`ven/rebuttal`、`ven/renekton-brute`、`ven/renekton-rage-fueled`、`ven/resonating-strike`、`ven/risen-altar`、`ven/ruthless-strike`、`ven/sacred-protector`、`ven/sanction`、`ven/sandstone-chimera`、`ven/sandswept-tomb`、`ven/serene-ascetic`、`ven/shadow-fiend`、`ven/shadowblade-lurker`、`ven/shock-blast`、`ven/spiderling`、`ven/stargazer`、`ven/steel-paws`、`ven/temporal-breach`、`ven/tornado-warrior`、`ven/wind-and-ghosts`、`ven/zed-from-the-shadows`。

### 2. EG-CONTRACT — 协调者统一追加 IR/动作/状态契约与注册导出

受阻 **231** 张；**B0 / XL**（6–10 工程日）；deps：无。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：只追加且集中评审：事件 it/条件与关系筛选、费用参数/收据、Universal 来源、Hide/Recall/批事务等；默认 profile/schema、旧日志及既有语义保持，导出/生成注册由协调者集成。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/card-dsl/src/ir/types.ts`；`packages/card-dsl/src/ir/validation.ts`；`packages/card-dsl/src/ir/REVISIONS.md`；`packages/engine-core/src/effects/contract.ts`；`packages/engine-core/src/effects/keyword-contract.ts`；`packages/engine-core/src/core/contracts.ts`；`docs/plans/2026-10-15-p0-contract.md`；`packages/engine-core/src/programs/index.ts`；`packages/engine-core/src/index.ts`；`packages/card-dsl/package.json`；`packages/engine-core/test/engine-gaps/contract.test.mjs`（建议新建）；`packages/engine-core/src/effects/interpreter/predicates/index.ts`。

**证据**：

- `packages/card-dsl/src/ir/types.ts:481`：`export interface KeywordAbility {`。
- `packages/card-dsl/src/ir/types.ts:488`：`export interface TriggeredAbility {`。
- `packages/engine-core/src/effects/contract.ts:16`：`export type ZoneId = "hand" | "deck" | "rune-deck" | "trash" | "banishment" | "board" | "rune-zone" | "chain";`。
- CR v1.5：355.7, 163.2.b, 107.3；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：udge-required, "Static ability kind cost.hidden has no layer mapping")），封闭 GameAction 集合没有 hide，ZoneId/ObjectSnapshot 没有 Facedown Zone，turn/flow.ts 的清理对 faceDown 对象抛 TurnCombatBlockedError("hidden-cleanup-state")。(2) 740.4.a.2 要求「you may pay :rb_energy_2:。
- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：ost.modify 的 id 字面量化（chain/interpreter-adapter.ts，实测抛 TypeError），且契约 3.1 的 TriggeredAbility 没有费用字段、programs/triggers.ts 也不从正文提取（TriggerRegistration.cost/mayAtFinalize 恒为 undefined），因此该费用到不了 Finalize，与 383.3.b.1「未支付就不能进链定稿」不符；同时 CR 108.3 的 Legend Zone 不在 ZoneId 联合。

**受阻卡（完整）**：`ogn/back-alley-bar`、`ogn/cithria-of-cloudfield`、`ogn/daughter-of-the-void`、`ogn/defy`、`ogn/ekko-recurrent`、`ogn/flame-chompers`、`ogn/hallowed-tomb`、`ogn/malzahar-fanatic`、`ogn/mistfall`、`ogn/monastery-of-hirana`、`ogn/mushroom-pouch`、`ogn/nine-tailed-fox`、`ogn/pack-of-wonders`、`ogn/pakaa-cub`、`ogn/pirates-haven`、`ogn/raging-firebrand`、`ogn/reckoners-arena`、`ogn/relentless-storm`、`ogn/sai-scout`、`ogn/sett-brawler`、`ogn/spectral-matron`、`ogn/spoils-of-war`、`ogn/stealthy-pursuer`、`ogn/super-mega-death-rocket-jinx`、`ogn/swift-scout`、`ogn/tasty-faefolk`、`ogn/the-arenas-greatest`、`ogn/the-boss`、`ogn/the-dreaming-tree`、`ogn/the-grand-plaza`、`ogn/tideturner`、`ogn/wildclaw-shaman`、`ogs/dark-child-starter`、`ogs/highlander-yi`、`ogs/lady-of-luminosity-starter`、`ogs/master-yi-meditative`、`ogs/might-of-demacia-starter`、`ogs/recruit-the-vanguard`、`ogs/tibbers-annie`、`ogs/wuju-bladesman-starter`、`rad/agonys-embrace`、`rad/akali-brash`、`rad/an-offer-you-cant-refuse`、`rad/battlefield-armorer`、`rad/boy-who-shattered-time`、`rad/bushwhack-trap`、`rad/detonation-amplifier`、`rad/evelynn-in-control`、`rad/exemplar-of-demacia`、`rad/firelights-hideout`、`rad/graves-blasting-through`、`rad/heartening-soul`、`rad/hexplosive-minefield`、`rad/iron-revenant`、`rad/momentary-companion`、`rad/mordekaiser-dominating`、`rad/neeko-blending-in`、`rad/piltovan-guidebot`、`rad/pride-of-nazumah`、`rad/riven-deserter`、`rad/sneaky-zeebles`、`rad/starry-eyed-songstress`、`rad/suave-negotiator`、`rad/the-ball`、`rad/the-empyrean`、`rad/the-waters-wage`、`rad/titanic-shrine`、`sfd/altar-of-memories`、`sfd/bard-mercurial`、`sfd/battle-mistress`、`sfd/black-market-broker`、`sfd/blade-dancer`、`sfd/blast-corps-cadet`、`sfd/boneshiver`、`sfd/boots-of-swiftness`、`sfd/called-shot`、`sfd/chem-baroness`、`sfd/chemtech-cask`、`sfd/cloth-armor`、`sfd/danger-zone`、`sfd/emperor-of-the-sands`、`sfd/emperors-divide`、`sfd/experimental-hexplate`、`sfd/eye-of-the-herald`、`sfd/fire-below-the-mountain`、`sfd/fizz-trickster`、`sfd/glasc-mixologist`、`sfd/glorious-executioner`、`sfd/gold`、`sfd/grandmaster-at-arms`、`sfd/guardian-angel`、`sfd/hostile-takeover`、`sfd/jax-unrelenting`、`sfd/last-rites`、`sfd/pickpocket`、`sfd/prodigal-explorer`、`sfd/royal-entourage`、`sfd/skyfall-of-areion`、`sfd/soraka-wanderer`、`sfd/spirit-wheel`、`sfd/steraks-gage`、`sfd/trinity-force`、`sfd/windsinger`、`unl/altar-of-blood`、`unl/angler-beast`、`unl/bandle-soldier`、`unl/bashful-bloom`、`unl/blast-cone`、`unl/blood-rose`、`unl/blue-sentinel`、`unl/bone-skewer`、`unl/brush`、`unl/daisy`、`unl/death-from-below`、`unl/diana-lunari`、`unl/double-trouble`、`unl/forgotten-library`、`unl/forgotten-signpost`、`unl/fresh-beans`、`unl/frisky-hunter`、`unl/green-father`、`unl/heedless-resurrection`、`unl/hextech-gauntlets`、`unl/icevale-archer`、`unl/isolate`、`unl/jhin-murderous-artist`、`unl/katarina-reckless`、`unl/keeper-of-the-hammer`、`unl/lillia-fae-fawn`、`unl/lotus-trap`、`unl/mischievous-marai`、`unl/monster-harpoon`、`unl/moonfall`、`unl/piltover-enforcer`、`unl/pridestalker`、`unl/repulse`、`unl/revna-the-lorekeeper`、`unl/rippers-bay`、`unl/scuttle-crab`、`unl/shard-of-undoing`、`unl/shepherds-heirloom`、`unl/sinister-poro`、`unl/soul-harvest`、`unl/soul-sword`、`unl/square-up`、`unl/star-spring`、`unl/stare-down`、`unl/tactical-retreat`、`unl/the-academy`、`unl/the-list`、`unl/towering-pairofant`、`unl/undying-legion`、`unl/undying-loyalty`、`unl/upstage-comedy`、`unl/valley-of-idols`、`unl/vex-apathetic`、`unl/vex-mocking`、`unl/vilemaw`、`unl/virtuoso`、`unl/voidreaver`、`ven/akali-deadly-weapon`、`ven/ambessa-respected-and-feared`、`ven/ambessa-the-wolf`、`ven/applied-researchers`、`ven/apprentice-mage`、`ven/aurok-general`、`ven/baccai-sandspinner`、`ven/baccai-witherclaw`、`ven/brittle-steel`、`ven/brutal-hunter`、`ven/butcher-of-the-sands`、`ven/covert-informant`、`ven/curator-of-the-sands`、`ven/dame-the-despoiler`、`ven/death-mark`、`ven/defender-of-tomorrow`、`ven/dragon-form`、`ven/dredge-up`、`ven/escaped-grayback`、`ven/frostcoat-mother`、`ven/gangplank-naval`、`ven/glowstone`、`ven/grumpy-rockbear`、`ven/heart-of-the-tempest`、`ven/helm-of-suppression`、`ven/hextech-disc`、`ven/hextech-formula`、`ven/hungry-wolf`、`ven/iterative-design`、`ven/jagged-cutlass`、`ven/kayle-justified`、`ven/keeper-of-law`、`ven/kennen-keeper-of-balance`、`ven/kharox`、`ven/kinkou-lifeblade`、`ven/lacerate`、`ven/legion-marauder`、`ven/lightning-rush`、`ven/mel-defiant-soul`、`ven/mel-newly-awakened`、`ven/noxian-emissary`、`ven/onslaught`、`ven/pendulum-blade`、`ven/perfect-execution`、`ven/piltovan-forge`、`ven/platewyrm-egg`、`ven/profiteer`、`ven/protective-sands`、`ven/public-execution`、`ven/punching-poro`、`ven/questionable-tome`、`ven/rage-amplifier`、`ven/ravenbloom-prefect`、`ven/reluctant-leader`、`ven/risen-altar`、`ven/rogue-assassin`、`ven/ruthless-strike`、`ven/serene-ascetic`、`ven/shadow-dash`、`ven/shadow-fiend`、`ven/shuriken-flip`、`ven/solari-sunhawk`、`ven/souls-reflection`、`ven/stargazer`、`ven/steel-paws`、`ven/tail-cloaked-matriarch`、`ven/threshold-of-the-gray`、`ven/tomb-raider-barbara`、`ven/tools-of-empire`、`ven/twilight-step`、`ven/up-from-the-deep`。

### 3. EG-FILTER — CardProgram 对象与触发过滤器的符号适配

受阻 **231** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-FILTERS, EG-LOCATIONS。 优先复用现有 IR。

**实现与验收**：区分 ObjectFilter 与 EventPattern，支持 source/self/other/exclude/sameLocationAs、here 的当前宿主/事件战场关系，保留 zoneEntryId 与 LKI；翻译到统一过滤器，不伪造目标。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/filters.ts`；`packages/engine-core/test/engine-gaps/filter.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/programs/filters.ts:19`：`const allowed = new Set(['objectId', 'cardId', 'canonicalCardId', 'type', 'types', 'controller', 'owner', 'zone', 'location', 'locationType', 'states', 'state', 'tags', 'tag', 'characteristics']);`。
- `packages/engine-core/src/programs/filters.ts:21`：`if (!allowed.has(key)) throw new ProgramBindingError('judge-required', 'Unsupported filter field ${key}');`。
- `/root/swarm-rift/logs/gate-51cd2b97.log:43516`：`error: 'Unsupported filter field object.id'`。
- CR v1.5：355.7, 383.4.c.1, 383.4.d.2.a；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/seat-of-power`（`packages/card-dsl/src/cards/sfd/seat-of-power.ts:61`）：ected both by the merged trigger-spec validator as an unknown field and by programs/filters.ts translateTriggerFilter ("Unsupported filter field here"), and although EventPattern.details can compare details.battlefieldId in principle, a static card program。
- `unl/trevor-snoozebottom`（`packages/card-dsl/src/cards/unl/trevor-snoozebottom.ts:102`）：TTERN_TYPES 内，注册被 invalid-event-type 拒绝，token 生命周期绑定与默认房间注入本卡程序仍缺。(4) hold 触发缺少「本卡是在固守的战场上在场的那个单位」的载荷绑定（383.4.d.2/.2.a；hold 现由 turn/flow.ts 的 Score wave 发出，programs/filters.ts 也能把本卡的 held filter 翻成 objectId 绑定并通过 TriggerSpec 校验，但 hold 事件载荷只带 battlefield/。

**受阻卡（完整）**：`ogn/adaptatron`、`ogn/ahri-alluring`、`ogn/ahri-inquisitive`、`ogn/altar-to-unity`、`ogn/cithria-of-cloudfield`、`ogn/convergent-mutation`、`ogn/crackshot-corsair`、`ogn/dazzling-aurora`、`ogn/defy`、`ogn/dragons-rage-lee-sin`、`ogn/dune-drake`、`ogn/ember-monk`、`ogn/facebreaker`、`ogn/fading-memories`、`ogn/first-mate`、`ogn/flame-chompers`、`ogn/fortified-position`、`ogn/guerilla-warfare-teemo`、`ogn/gust`、`ogn/hallowed-tomb`、`ogn/jeweled-colossus`、`ogn/kaisa-evolutionary`、`ogn/karma-channeler`、`ogn/kinkou-monk`、`ogn/kogmaw-caustic`、`ogn/leona-determined`、`ogn/machine-evangel`、`ogn/monastery-of-hirana`、`ogn/mushroom-pouch`、`ogn/mystic-poro`、`ogn/navori-fighting-pit`、`ogn/nine-tailed-fox`、`ogn/nocturne-horrifying`、`ogn/noxian-drummer`、`ogn/pack-of-wonders`、`ogn/peak-guardian`、`ogn/qiyana-victorious`、`ogn/reavers-row`、`ogn/reckoners-arena`、`ogn/sett-brawler`、`ogn/sigil-of-the-storm`、`ogn/spectral-matron`、`ogn/sprite-mother`、`ogn/startipped-peak`、`ogn/targons-peak`、`ogn/teemo-strategist`、`ogn/the-arenas-greatest`、`ogn/the-candlelit-sanctum`、`ogn/the-dreaming-tree`、`ogn/the-grand-plaza`、`ogn/trifarian-gloryseeker`、`ogn/trifarian-war-camp`、`ogn/tryndamere-barbarian`、`ogn/twisted-fate-gambler`、`ogn/vanguard-helm`、`ogn/vayne-hunter`、`ogn/viktor-leader`、`ogn/volibear-furious`、`ogn/volibear-imposing`、`ogn/yasuo-remorseful`、`ogn/zaun-warrens`、`ogs/might-of-demacia-starter`、`rad/ahri-confident`、`rad/aphelios-exalted`、`rad/bandle-scouts-academy`、`rad/banner-of-conquest`、`rad/black-rose-sanctum`、`rad/blossoming-dreamroot`、`rad/bushwhack-trap`、`rad/coalesced-energy`、`rad/command-attack`、`rad/concert-poster`、`rad/cosmic-vista`、`rad/demacian-standard`、`rad/detonation-amplifier`、`rad/disposal-expert`、`rad/dockside-lock-up`、`rad/durand-memorial`、`rad/elnuk-herd`、`rad/evelynn-consuming`、`rad/firelights-hideout`、`rad/gravity-field`、`rad/heartening-soul`、`rad/hunters-circle`、`rad/invigorating-bloom`、`rad/jarvan-iv-martial-paragon`、`rad/kaisa-rebel`、`rad/ksante-courageous`、`rad/ksante-dauntless`、`rad/lulu-whimsical`、`rad/mechanical-bandit`、`rad/mournful-spirit`、`rad/overloaded-traveler`、`rad/pillaged-armory`、`rad/portable-portal`、`rad/rakelstake`、`rad/resource-extractor`、`rad/riven-deserter`、`rad/ruined-monastery`、`rad/siren-of-the-shallows`、`rad/sirens-song`、`rad/stalwart-goatherd`、`rad/storm-raptor`、`rad/the-ball`、`rad/the-good-stuff`、`rad/ziggs-explosive`、`rad/ziggs-short-fused`、`sfd/angle-shot`、`sfd/apprentice-smith`、`sfd/corinna-veraza`、`sfd/corrupt-enforcer`、`sfd/draven-audacious`、`sfd/dunebreaker`、`sfd/edge-of-night`、`sfd/eminent-benefactor`、`sfd/emperors-dais`、`sfd/fae-porter`、`sfd/fizz-trickster`、`sfd/glasc-mixologist`、`sfd/glorious-executioner`、`sfd/hall-of-legends`、`sfd/janna-savior`、`sfd/jax-unrelenting`、`sfd/lucian-gunslinger`、`sfd/lucian-merciless`、`sfd/minefield`、`sfd/not-so-fast`、`sfd/pickpocket`、`sfd/piercing-light`、`sfd/power-nexus`、`sfd/ravenbloom-conservatory`、`sfd/relentless-pursuit`、`sfd/rell-magnetic`、`sfd/ribbon-dancer`、`sfd/rumble-hotheaded`、`sfd/sandshifter`、`sfd/sea-monkey`、`sfd/seat-of-power`、`sfd/show-of-strength`、`sfd/soraka-wanderer`、`sfd/stellacorn-herder`、`sfd/strike-down`、`sfd/sunken-temple`、`sfd/switcheroo`、`sfd/treasure-hoard`、`sfd/veiled-temple`、`sfd/windsinger`、`unl/abandoned-hall`、`unl/amateur-recital`、`unl/angler-beast`、`unl/bloodharbor-ripper`、`unl/blue-sentinel`、`unl/brush`、`unl/chakram-dancer`、`unl/conscription`、`unl/crescent-strike`、`unl/daisy`、`unl/death-from-below`、`unl/deceiver`、`unl/divining-shells`、`unl/elder-dragon`、`unl/enthusiastic-promoter`、`unl/evelynn-entrancing`、`unl/existential-dread`、`unl/forbidding-waste`、`unl/frozen-fortress`、`unl/green-father`、`unl/heedless-resurrection`、`unl/herald-of-spring`、`unl/heroic-charge`、`unl/iascylla`、`unl/icevale-archer`、`unl/imposing-challenger`、`unl/inviolus-vox`、`unl/irresistible-faefolk`、`unl/isolate`、`unl/jhin-meticulous-killer`、`unl/katarina-reckless`、`unl/khazix-evolving-hunter`、`unl/leblanc-everywhere-at-once`、`unl/mischievous-marai`、`unl/mosstomper`、`unl/nidalee-cat-form`、`unl/rippers-bay`、`unl/ruined-rex`、`unl/scuttle-crab`、`unl/shadow`、`unl/shadows-call`、`unl/shard-of-undoing`、`unl/sinister-poro`、`unl/spectral-centaur`、`unl/the-academy`、`unl/trapping-grounds`、`unl/trevor-snoozebottom`、`unl/valley-of-idols`、`unl/vaults-of-helia`、`unl/vi-peacekeeper`、`unl/vicious-snapjaws`、`unl/virtuoso`、`unl/voidreaver`、`unl/yuumi-magical-cat`、`ven/ambessa-respected-and-feared`、`ven/baccai-witherclaw`、`ven/corrupted-dragon`、`ven/curator-of-the-sands`、`ven/dame-the-despoiler`、`ven/decree-of-focus`、`ven/decree-of-insight`、`ven/hextech-formula`、`ven/illaoi-prophet-of-the-great-kraken`、`ven/jayce-brilliant-inventor`、`ven/masa-crashing-thunder`、`ven/mel-defiant-soul`、`ven/minah-swiftfoot`、`ven/nasus-guardian-of-knowledge`、`ven/noxian-demolitionist`、`ven/ocean-drake`、`ven/protective-sands`、`ven/public-execution`、`ven/rebuttal`、`ven/reluctant-leader`、`ven/resonating-strike`、`ven/riven-shattered`、`ven/rogue-assassin`、`ven/shadow-temple`、`ven/shen-leader-of-the-kinkou-order`、`ven/shen-scourge-of-shadows`、`ven/swain-visionary`、`ven/tail-cloaked-matriarch`、`ven/threshold-of-the-gray`、`ven/twilight-reveler`。

### 4. EG-FINALIZE — 统一链 Finalize 接入费用、选择与合法性适配器

受阻 **217** 张；**B6 / XL**（6–10 工程日）；deps：EG-CONTRACT, EG-COSTBIND, EG-COSTCHOICE, EG-DISCOUNTS, EG-CHOICEPLAN, EG-TARGETS, EG-TAX, EG-PLAY, EG-RULES, EG-ADD, EG-STATIC, EG-TRIGGERS, EG-ADAPTER, EG-GRANTS, EG-REFLEXIVE。 优先复用现有 IR。

**实现与验收**：唯一整合者接入下列专用模块；原子支付/回滚、Finalize 模式目标/费用与再验证、Reaction Add 窗口、嵌套 Play；不把别的任务写域借给并行任务。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/chain/engine.ts`；`packages/engine-core/src/chain/finalize/index.ts`（建议新建）；`packages/engine-core/test/engine-gaps/finalize.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/chain/engine.ts:348`：`item.costPlan = buildCostPlan(paymentContext, { ...(input ?? { id: 'cost:${item.id}', cost: { energy: { kind: 'constant', value: 0 } } }), mandatoryAdditional: [...(input?.mandatoryAdditional ?? []), ...taxes.map((tax, index) => ({ id: 'target-tax:${index}', cost: { energy: { kind: 'constant' as const, value: tax.amount } } }))] });`。
- `packages/engine-core/src/chain/engine.ts:506`：`if (nested && instruction.targets?.length) throw new ChainContractBlockedError('Nested/repeated targets require an interpreter target-selection lifecycle adapter');`。
- `packages/engine-core/src/chain/engine.ts:507`：`if (instruction.op === 'choice.mode') throw new ChainContractBlockedError('Mode choices require a Finalize/Resolve choice-plan adapter');`。
- CR v1.5：355.3, 355.15, 357.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：ef 的 accelerate.cost 声明与 805.6 入场就绪替代、cost/cost-plan.ts 的 accelerate 可选费用组、chain/engine.ts resolve() 的 selectedAdditional 消费都已合入，但 programs/play.ts translateCost 对展开的 cost 抛 Unsupported play cost field optional，programs/statics.ts layerFor 没有 accelerat。
- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：istration.cost/mayAtFinalize；两条触发的 TargetSpec 又嵌在 choice.optional 的 body 内，chain/engine.ts 的 assertFinalizationSurface 以 "Nested/repeated targets require an interpreter target-selection lifecycle adapter" 阻断 Finalize（golden 用真实 ChainEngine 复现该拒绝），触发连入链。

**受阻卡（完整）**：`ogn/adaptatron`、`ogn/blind-fury`、`ogn/brazen-buccaneer`、`ogn/call-to-glory`、`ogn/commander-ledros`、`ogn/darius-executioner`、`ogn/dragons-rage-lee-sin`、`ogn/eager-apprentice`、`ogn/ember-monk`、`ogn/find-your-center`、`ogn/herald-of-scales`、`ogn/kadregrin-the-infernal`、`ogn/kraken-hunter`、`ogn/mageseeker-warden`、`ogn/miss-fortune-buccaneer`、`ogn/miss-fortune-captain`、`ogn/mistfall`、`ogn/mushroom-pouch`、`ogn/mystic-reversal`、`ogn/overt-operation`、`ogn/pouty-poro`、`ogn/qiyana-victorious`、`ogn/raging-firebrand`、`ogn/ravenborn-tome`、`ogn/relentless-storm`、`ogn/shakedown`、`ogn/sky-splitter`、`ogn/sneaky-deckhand`、`ogn/soulgorger`、`ogn/spectral-matron`、`ogn/spirits-refuge`、`ogn/the-harrowing`、`ogn/tideturner`、`ogn/twisted-fate-gambler`、`ogn/udyr-wildman`、`ogn/unchecked-power`、`ogn/vayne-hunter`、`ogn/vi-destructive`、`ogn/volibear-furious`、`ogn/wallop`、`ogn/zenith-blade-leona`、`rad/amateur-demolitionist`、`rad/an-offer-you-cant-refuse`、`rad/aphelios-exalted`、`rad/avalanche`、`rad/command-attack`、`rad/consult-the-heavens`、`rad/demon-shade`、`rad/dune-devourer`、`rad/ekko-revolutionary`、`rad/encore`、`rad/evelynn-consuming`、`rad/fanfare`、`rad/gravity-field`、`rad/hold-em`、`rad/hunters-circle`、`rad/invigorating-bloom`、`rad/iron-revenant`、`rad/ki-burst`、`rad/last-caress`、`rad/lost-to-the-sands`、`rad/meticulous-restorationist`、`rad/mordekaiser-dominating`、`rad/orianna-mechanical-marvel`、`rad/pillaged-armory`、`rad/portable-portal`、`rad/primordial-roar`、`rad/reckless-innovator`、`rad/riven-broken-blade`、`rad/rousing-display`、`rad/shimmering-swimmer`、`rad/skystrike-squadron`、`rad/sneaky-zeebles`、`rad/starry-eyed-songstress`、`rad/storm-raptor`、`rad/suave-negotiator`、`rad/the-ball`、`rad/the-good-stuff`、`rad/the-waters-wage`、`rad/titanic-shrine`、`rad/war-scout`、`rad/watchful-curator`、`sfd/altar-of-memories`、`sfd/ancient-henge`、`sfd/armed-assailant`、`sfd/azir-sovereign`、`sfd/battering-ram`、`sfd/bellows-breath`、`sfd/blade-dancer`、`sfd/buhru-captain`、`sfd/drag-under`、`sfd/draven-audacious`、`sfd/dunebreaker`、`sfd/ezreal-prodigy`、`sfd/fae-porter`、`sfd/fire-below-the-mountain`、`sfd/fizz-trickster`、`sfd/glasc-mixologist`、`sfd/gold`、`sfd/guardian-angel`、`sfd/hard-bargain`、`sfd/hextech-anomaly`、`sfd/irelia-fervent`、`sfd/irelia-graceful`、`sfd/jaull-fish`、`sfd/navori-scout`、`sfd/needlessly-large-yordle`、`sfd/not-so-fast`、`sfd/ornns-forge`、`sfd/overzealous-fan`、`sfd/perched-grimwyrm`、`sfd/petricite-monument`、`sfd/prize-of-progress`、`sfd/prodigal-explorer`、`sfd/rally-the-troops`、`sfd/rell-magnetic`、`sfd/rengar-pouncing`、`sfd/rocket-barrage`、`sfd/rockfall-path`、`sfd/royal-entourage`、`sfd/ruin-runner`、`sfd/sandshifter`、`sfd/sentinel-adept`、`sfd/sivir-ambitious`、`sfd/sivir-mercenary`、`sfd/spirit-wheel`、`sfd/strike-down`、`sfd/tianna-crownguard`、`sfd/veteran-poro`、`sfd/vex-cheerless`、`sfd/void-drone`、`sfd/void-rush`、`sfd/windsinger`、`sfd/zaun-punk`、`unl/allay-eager-admirer`、`unl/arachnoid-horror`、`unl/back-off`、`unl/bird`、`unl/blood-rose`、`unl/carrion-dredger`、`unl/chakram-dancer`、`unl/concentrate`、`unl/curtain-call`、`unl/daisy`、`unl/diana-lunari`、`unl/diana-no-longer-human`、`unl/disposal-order`、`unl/dusk-rose-lab`、`unl/flurry-of-feathers`、`unl/forgotten-library`、`unl/inferna`、`unl/ivern-friend-to-all`、`unl/katarina-reckless`、`unl/keepers-verdict`、`unl/lillia-fae-fawn`、`unl/lilting-lullaby`、`unl/lord-broadmane`、`unl/master-yi-tempered`、`unl/master-yi-unstoppable`、`unl/monch`、`unl/mosstomper`、`unl/nidalee-cat-form`、`unl/nilah-joyful-ascetic`、`unl/piltover-enforcer`、`unl/poppy-paragon`、`unl/pridestalker`、`unl/rengar-trophy-hunter`、`unl/rengar-unseen`、`unl/right-of-conquest`、`unl/scorn-of-the-moon`、`unl/sharkling`、`unl/stalking-wolf`、`unl/thrill-of-the-hunt`、`unl/upstage-comedy`、`unl/valley-of-idols`、`unl/vi-hotheaded`、`unl/virtuoso`、`unl/yuumi-magical-cat`、`ven/baccai-sandspinner`、`ven/dragon-roost`、`ven/dredge-up`、`ven/forgotten-relic`、`ven/forsaken-baccai`、`ven/glowstone`、`ven/hand-hammer`、`ven/heart-of-the-tempest`、`ven/heisho-shell-of-the-world`、`ven/helm-of-suppression`、`ven/hungry-wolf`、`ven/iterative-design`、`ven/jayce-brilliant-inventor`、`ven/jayce-hammer-in-hand`、`ven/kennen-keeper-of-balance`、`ven/kharox`、`ven/mel-newly-awakened`、`ven/mesmerize`、`ven/minah-swiftfoot`、`ven/mystic-vortex`、`ven/nasus-ascended`、`ven/noxian-demolitionist`、`ven/oasis-raider`、`ven/ocean-drake`、`ven/onslaught`、`ven/plaza-guardian`、`ven/protective-sands`、`ven/rebuttal`、`ven/renekton-brute`、`ven/renekton-rage-fueled`、`ven/ruthless-strike`、`ven/sanction`、`ven/sandswept-tomb`、`ven/shady-spectacles`、`ven/shen-scourge-of-shadows`、`ven/siphoning-strike`、`ven/solari-sunhawk`、`ven/wild-claw`、`ven/zed-from-the-shadows`。

### 5. EG-KEYWORDS — 关键词印刷参数、费用与正文展开

受阻 **210** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：转发只增的 params.cost 与正文/宿主能力 id；修复 Equip/Empower 费用占位、Legion 排除身份、Deploy/Weaponmaster/Hunt/Vision 等展开；新关键词按规则注册，不用虚构效果替代。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/keywords.ts`；`packages/engine-core/src/effects/keywords/Equip.ts`；`packages/engine-core/src/effects/keywords/Empower.ts`；`packages/engine-core/src/effects/keywords/Legion.ts`；`packages/engine-core/src/effects/keywords/Deploy.ts`；`packages/engine-core/src/effects/keywords/Hunt.ts`；`packages/engine-core/src/effects/keywords/Vision.ts`；`packages/engine-core/src/effects/keywords/Weaponmaster.ts`；`packages/engine-core/src/effects/keywords/Quick-Draw.ts`；`packages/engine-core/src/effects/keywords/ShowOff.ts`；`packages/engine-core/src/effects/keywords/Ambush.ts`；`packages/engine-core/src/effects/keywords/Flow.ts`；`packages/engine-core/src/effects/keywords/Level.ts`；`packages/engine-core/src/effects/keywords/Temporary.ts`；`packages/engine-core/src/effects/keywords/Repeat.ts`；`packages/engine-core/src/effects/keywords/Predict.ts`（建议新建）；`packages/engine-core/src/effects/keywords/Unique.ts`（建议新建）；`packages/engine-core/test/engine-gaps/keywords.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/programs/keywords.ts:37`：`expanded.push(...def.expand({ value: def.valued ? value : undefined, host: { canonicalCardId: source.cardId ?? program.canonicalCardId } }));`。
- `packages/card-dsl/src/ir/types.ts:481`：`export interface KeywordAbility {`。
- `/root/swarm-rift/logs/gate-51cd2b97.log:44870`：`error: 'Unsupported static appliesTo "empower-activation-cost"'`。
- CR v1.5：818.1.c, 827.1.c；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：rams/keyword-grants.ts（expandEffectiveKeywords/KeywordGrantLayerEngine）把已授予关键词 展开成 continuous.movement 并产出 permission.routes 都已合入，实测授予后 movement().canGank 为 true 且 Standard Move 成功；但没有任何生产装配安装该引擎：ChainEngine 默认用普通 LayerEngine、TurnFlow 用同样非授权的 Tur。
- `unl/rengar-unseen`（`packages/card-dsl/src/cards/unl/rengar-unseen.ts:44`）：四条关键词的展开都能通过 validateCardProgram，但都还没有可执行的生产消费路径，均不近似实现：(1) [Accelerate]（805.1.b/805.2.b/805.6）：费用计划（cost/cost-plan.ts 的 optionalAdditional kind "accelerate"）与链的就绪入场消费（chain。

**受阻卡（完整）**：`ogn/captain-farron`、`ogn/chemtech-enforcer`、`ogn/cleave`、`ogn/darius-executioner`、`ogn/ekko-recurrent`、`ogn/fiora-victorious`、`ogn/gemcraft-seer`、`ogn/jeweled-colossus`、`ogn/karma-channeler`、`ogn/kraken-hunter`、`ogn/lecturing-yordle`、`ogn/machine-evangel`、`ogn/mystic-poro`、`ogn/noxian-guillotine-darius`、`ogn/noxus-hopeful`、`ogn/sai-scout`、`ogn/scrapyard-champion`、`ogn/sett-kingpin`、`ogn/soaring-scout`、`ogn/spirits-refuge`、`ogn/sprite`、`ogn/sprite-call`、`ogn/stormclaw-ursine`、`ogn/taric-protector`、`ogn/tasty-faefolk`、`ogn/thousand-tailed-watcher`、`ogn/tideturner`、`ogn/trifarian-gloryseeker`、`ogn/undercover-agent`、`ogn/vanguard-captain`、`ogn/zhonyas-hourglass`、`rad/banner-of-conquest`、`rad/blade-of-the-exile`、`rad/blossoming-dreamroot`、`rad/boy-who-shattered-time`、`rad/bushwhack-trap`、`rad/clocktower-guardian`、`rad/concert-poster`、`rad/demacian-standard`、`rad/detonation-amplifier`、`rad/dockside-lock-up`、`rad/gravity-field`、`rad/momentary-companion`、`rad/mournful-spirit`、`rad/nazuman-ntofo`、`rad/ntofo-strikes`、`rad/pillaged-armory`、`rad/portable-portal`、`rad/primordial-roar`、`rad/resource-extractor`、`rad/rousing-display`、`rad/siren-of-the-shallows`、`rad/stalwart-goatherd`、`rad/staunch-survivor`、`rad/the-ball`、`rad/the-empyrean`、`rad/the-good-stuff`、`rad/watchful-curator`、`rad/ziggs-explosive`、`sfd/akshan-mischievous`、`sfd/ancient-warmonger`、`sfd/armed-assailant`、`sfd/azir-sovereign`、`sfd/blade-of-the-ruined-king`、`sfd/boneshiver`、`sfd/boots-of-swiftness`、`sfd/brutalizer`、`sfd/called-shot`、`sfd/cloth-armor`、`sfd/combat-chef`、`sfd/cull`、`sfd/danger-zone`、`sfd/dorans-ring`、`sfd/dorans-shield`、`sfd/edge-of-night`、`sfd/experimental-hexplate`、`sfd/eye-of-the-herald`、`sfd/feral-strength`、`sfd/ferrous-forerunner`、`sfd/forgefire-cape`、`sfd/frigid-touch`、`sfd/gearhead`、`sfd/guardian-angel`、`sfd/hexdrinker`、`sfd/jax-unrelenting`、`sfd/kato-the-arm`、`sfd/last-rites`、`sfd/laurent-bladekeeper`、`sfd/lucian-merciless`、`sfd/marching-orders`、`sfd/master-bingwen`、`sfd/ornn-forge-god`、`sfd/rabadons-deathcrown`、`sfd/recurve-bow`、`sfd/rocket-barrage`、`sfd/sentinel-adept`、`sfd/serrated-dirk`、`sfd/shurelyas-requiem`、`sfd/sivir-mercenary`、`sfd/skyfall-of-areion`、`sfd/spinning-axe`、`sfd/steraks-gage`、`sfd/sudden-storm`、`sfd/svellsongur`、`sfd/the-zero-drive`、`sfd/thwonk`、`sfd/trinity-force`、`sfd/veteran-poro`、`sfd/wages-of-pain`、`sfd/world-atlas`、`unl/abandon`、`unl/arachnoid-horror`、`unl/blighted-battleaxe`、`unl/carrion-dredger`、`unl/crowd-favorite`、`unl/divining-shells`、`unl/double-trouble`、`unl/dramatic-visionary`、`unl/gemhand-hunter`、`unl/gustwalker`、`unl/herald-of-spring`、`unl/hextech-gauntlets`、`unl/honeyfruit`、`unl/hunters-machete`、`unl/jhin-meticulous-killer`、`unl/keeper-of-masks`、`unl/khazix-evolving-hunter`、`unl/lillia-fae-fawn`、`unl/master-yi-tempered`、`unl/mosstomper`、`unl/rengar-unseen`、`unl/ruined-rex`、`unl/scorchclaw`、`unl/shadows-call`、`unl/sharkling`、`unl/shepherds-heirloom`、`unl/soul-sword`、`unl/sprite-burst`、`unl/square-up`、`unl/syndra-transcendent`、`unl/the-academy`、`unl/towering-combatant`、`unl/trapping-grounds`、`unl/turn-to-dust`、`unl/undying-legion`、`unl/upstage-comedy`、`unl/voracious-gromp`、`unl/walking-roost`、`unl/wuju-apprentice`、`ven/akali-deadly-weapon`、`ven/ambessa-respected-and-feared`、`ven/ambessa-the-wolf`、`ven/applied-researchers`、`ven/apprentice-mage`、`ven/aurok-general`、`ven/baccai-sandspinner`、`ven/baccai-witherclaw`、`ven/brittle-steel`、`ven/brutal-hunter`、`ven/covert-informant`、`ven/dame-the-despoiler`、`ven/death-mark`、`ven/defender-of-tomorrow`、`ven/dragon-form`、`ven/dredge-up`、`ven/escaped-grayback`、`ven/frostcoat-mother`、`ven/gangplank-naval`、`ven/glowstone`、`ven/grumpy-rockbear`、`ven/hand-hammer`、`ven/helm-of-suppression`、`ven/hextech-disc`、`ven/iterative-design`、`ven/jagged-cutlass`、`ven/kayle-justified`、`ven/kharox`、`ven/kinkou-lifeblade`、`ven/lacerate`、`ven/legion-marauder`、`ven/lightning-rush`、`ven/mel-defiant-soul`、`ven/mel-newly-awakened`、`ven/nasus-ascended`、`ven/noxian-emissary`、`ven/onslaught`、`ven/pendulum-blade`、`ven/perfect-execution`、`ven/platewyrm-egg`、`ven/public-execution`、`ven/punching-poro`、`ven/questionable-tome`、`ven/rage-amplifier`、`ven/renekton-brute`、`ven/risen-altar`、`ven/riven-shattered`、`ven/rogue-assassin`、`ven/serene-ascetic`、`ven/shadow-dash`、`ven/shadow-fiend`、`ven/shady-spectacles`、`ven/shuriken-flip`、`ven/solari-sunhawk`、`ven/steel-paws`、`ven/swain-visionary`、`ven/tail-cloaked-matriarch`、`ven/tools-of-empire`、`ven/twilight-shroud`、`ven/twilight-step`、`ven/up-from-the-deep`。

### 6. EG-EXPR — 主解释器接入玩家/回合/历史/战斗指定表达式

受阻 **194** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 优先复用现有 IR。

**实现与验收**：主分派使用已实现扩展；历史条件读真实事件而非现存集合，能力控制者保持入链快照；designation 读 combatRole，未知条件 fail-closed；绑定当前 source 与层快照。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/interpreter/expr.ts`；`packages/engine-core/src/effects/interpreter/condition.ts`；`packages/engine-core/src/effects/interpreter/history.ts`；`packages/engine-core/src/effects/interpreter/expr-ext/**`；`packages/engine-core/test/engine-gaps/expr.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/interpreter/condition.ts:27`：`default: throw new Error('Unsupported condition: ${String((condition as { kind: unknown }).kind)}');`。
- `packages/engine-core/src/effects/interpreter/expr-ext/README.md:49`：`dispatch these extensions yet. This is scoped implementation for coordinator`。
- CR v1.5：364.3, 807.1.d, 814.1.d；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：his turn」无可求值路径：合并 Expr 的取值面（object-property/count/arithmetic 与 RIFT-711 的 player-property/turn-number/player-turn-count/object-designation）没有本回合已支付 Power 金额，powerSpentThisTurn 不是 ObjectSnapshot 特征，evaluateExpression 抛 MissingInformation；ResolveContext.hi。
- `unl/rengar-unseen`（`packages/card-dsl/src/cards/unl/rengar-unseen.ts:44`）： 的 abilityEnvironment 用基础解释器求值 ability.condition，读到 object-property(self, "designation") 时抛 MissingInformation 并按 false 兜底，所以 +2 对任何角色都不生效（实测 attacker/defender/null 三种 combatRole 下 Might 均不变）；把 designation 映射到 combatRole 的扩展求值器（effects/interpreter/exp。

**受阻卡（完整）**：`ogn/baited-hook`、`ogn/block`、`ogn/cannon-barrage`、`ogn/captain-farron`、`ogn/chemtech-enforcer`、`ogn/cleave`、`ogn/crackshot-corsair`、`ogn/dangerous-duo`、`ogn/daring-poro`、`ogn/darius-executioner`、`ogn/darius-trifarian`、`ogn/disintegrate`、`ogn/draven-showboat`、`ogn/fiora-victorious`、`ogn/fortified-position`、`ogn/hand-of-noxus`、`ogn/immortal-phoenix`、`ogn/jeweled-colossus`、`ogn/kayn-unleashed`、`ogn/kraken-hunter`、`ogn/lee-sin-ascetic`、`ogn/leona-determined`、`ogn/leona-zealot`、`ogn/petty-officer`、`ogn/raging-soul`、`ogn/scrapyard-champion`、`ogn/shen-kinkou`、`ogn/spoils-of-war`、`ogn/stalwart-poro`、`ogn/sun-disc`、`ogn/sunlit-guardian`、`ogn/taric-protector`、`ogn/trifarian-gloryseeker`、`ogn/tryndamere-barbarian`、`ogn/twisted-fate-gambler`、`ogn/vanguard-captain`、`ogn/vayne-hunter`、`ogn/viktor-innovator`、`ogn/volibear-imposing`、`ogn/wallop`、`ogn/yasuo-remorseful`、`ogn/yasuo-windrider`、`ogs/garen-rugged`、`ogs/zephyr-sage`、`rad/agonys-embrace`、`rad/akali-brash`、`rad/banner-of-conquest`、`rad/consult-the-heavens`、`rad/cosmic-vista`、`rad/demon-shade`、`rad/ekko-revolutionary`、`rad/elnuk-herd`、`rad/entrenched-boar`、`rad/exemplar-of-demacia`、`rad/for-demacia`、`rad/hold-em`、`rad/jarvan-iv-royal-heir`、`rad/kaisa-rebel`、`rad/ksante-courageous`、`rad/ksante-dauntless`、`rad/lingering-animus`、`rad/mordekaiser-twice-slain`、`rad/ntofo-strikes`、`rad/overloaded-traveler`、`rad/piltovan-guidebot`、`rad/pride-of-nazumah`、`rad/resource-extractor`、`rad/sirens-song`、`rad/stalwart-goatherd`、`rad/staunch-survivor`、`rad/wrath-of-the-freljord`、`rad/zero-point-inflection`、`sfd/ancient-warmonger`、`sfd/blood-rush`、`sfd/breakneck-mech`、`sfd/dorans-shield`、`sfd/experimental-hexplate`、`sfd/feral-strength`、`sfd/forgefire-cape`、`sfd/forgotten-monument`、`sfd/frostcoat-cub`、`sfd/laurent-duelist`、`sfd/loyal-pup`、`sfd/lucian-gunslinger`、`sfd/needlessly-large-yordle`、`sfd/not-so-fast`、`sfd/perched-grimwyrm`、`sfd/piercing-light`、`sfd/prodigal-explorer`、`sfd/recurve-bow`、`sfd/reksai-breacher`、`sfd/rengar-pouncing`、`sfd/rocket-barrage`、`sfd/rumble-hotheaded`、`sfd/sandshifter`、`sfd/sea-monkey`、`sfd/show-of-strength`、`sfd/sivir-ambitious`、`sfd/sivir-mercenary`、`sfd/soraka-wanderer`、`sfd/sunken-temple`、`sfd/thwonk`、`sfd/tianna-crownguard`、`sfd/treasure-hunter`、`sfd/trove-golem`、`sfd/vex-cheerless`、`sfd/world-atlas`、`sfd/yordle-explorer`、`sfd/zaun-punk`、`unl/angler-beast`、`unl/back-off`、`unl/bandle-soldier`、`unl/black-rose-dignitary`、`unl/blue-sentinel`、`unl/chakram-dancer`、`unl/combat-experience`、`unl/concentrate`、`unl/crescent-guardian`、`unl/crimson-pigeons`、`unl/daisy`、`unl/dancing-grenade`、`unl/existential-dread`、`unl/forbidding-waste`、`unl/forgotten-library`、`unl/fresh-beans`、`unl/frigid-jewel`、`unl/gemhand-hunter`、`unl/gustwalker`、`unl/honeyfruit`、`unl/inferna`、`unl/khazix-mutating-horror`、`unl/kinkou-initiate`、`unl/leblanc-fragmented`、`unl/lord-broadmane`、`unl/master-yi-tempered`、`unl/master-yi-unstoppable`、`unl/monch`、`unl/mutated-mouser`、`unl/poppy-paragon`、`unl/prepared-neophyte`、`unl/rengar-unseen`、`unl/scorchclaw`、`unl/shadow-watcher`、`unl/sharkling`、`unl/soul-harvest`、`unl/square-up`、`unl/targonian-visionary`、`unl/towering-combatant`、`unl/towering-pairofant`、`unl/trevor-snoozebottom`、`unl/undying-legion`、`unl/vault-breaker`、`unl/vex-mocking`、`unl/virtuoso`、`unl/wily-newtfish`、`unl/wuju-apprentice`、`unl/wuju-master`、`unl/xerath-freed`、`unl/yeti-brawler`、`unl/zilean-time-mage`、`ven/affectionate-poro`、`ven/astral-heron`、`ven/baccai-reaper`、`ven/baccai-sandspinner`、`ven/corrupted-dragon`、`ven/crumbling-sands`、`ven/disciple-of-shen`、`ven/gust-monk`、`ven/hextech-disc`、`ven/hungry-wolf`、`ven/jagged-cutlass`、`ven/kayle-justified`、`ven/masa-crashing-thunder`、`ven/mournful-witness`、`ven/ol-poro`、`ven/otterpus`、`ven/perfect-execution`、`ven/renekton-brute`、`ven/repair-specialist`、`ven/sacred-protector`、`ven/serene-ascetic`、`ven/shadow-assassin`、`ven/shadow-fiend`、`ven/shen-leader-of-the-kinkou-order`、`ven/shen-scourge-of-shadows`、`ven/shock-blast`、`ven/solari-sunhawk`、`ven/steel-paws`、`ven/swain-visionary`、`ven/threshold-of-the-gray`、`ven/tomb-raider-barbara`、`ven/twilight-step`、`ven/wind-and-ghosts`、`ven/zed-without-a-sound`。

### 7. EG-COSTBIND — 程序印刷/追加费用与支付收据适配

受阻 **171** 张；**B4 / L**（3–5 工程日）；deps：EG-KEYWORDS, EG-COSTCHOICE, EG-DISCOUNTS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：把印刷费用、可选/强制追加费与 keyword 参数送入现有 CostPlan；保留 paid 即使折至零、实付数量与用途链接；启动前后场所/每回合限制明确。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/play.ts`；`packages/engine-core/src/programs/activate.ts`；`packages/engine-core/src/programs/cost-adapters/**`（建议新建）；`packages/engine-core/test/engine-gaps/costbind.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/programs/play.ts:10`：`export function translateCost(cost: CostSpec | undefined, id: string, mode: 'play' | 'activate'): CostPlanInput['cost'] | undefined {`。
- `packages/engine-core/src/programs/keywords.ts:37`：`expanded.push(...def.expand({ value: def.valued ? value : undefined, host: { canonicalCardId: source.cardId ?? program.canonicalCardId } }));`。
- `/root/swarm-rift/logs/gate-51cd2b97.log:43670`：`error: 'Static ability kind cost.additional has no layer mapping'`。
- CR v1.5：356.2.b.1, 356.4.f.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：的 accelerate 可选费用组、chain/engine.ts resolve() 的 selectedAdditional 消费都已合入，但 programs/play.ts translateCost 对展开的 cost 抛 Unsupported play cost field optional，programs/statics.ts layerFor 没有 accelerate.cost 映射（实测 ProgramBindingError Static ability kind acce。
- `unl/rengar-unseen`（`packages/card-dsl/src/cards/unl/rengar-unseen.ts:44`）：路径，均不近似实现：(1) [Accelerate]（805.1.b/805.2.b/805.6）：费用计划（cost/cost-plan.ts 的 optionalAdditional kind "accelerate"）与链的就绪入场消费（chain/engine.ts 读取 selectedAdditional 的 accelerate）都已合入，展开的 accelerate.cost 静态声明与入场替代也能绑定（实测 expandProgram(inspect) + createEngineStatic。

**受阻卡（完整）**：`ogn/blazing-scorcher`、`ogn/brazen-buccaneer`、`ogn/call-to-glory`、`ogn/clockwork-keeper`、`ogn/commander-ledros`、`ogn/cruel-patron`、`ogn/eager-apprentice`、`ogn/ekko-recurrent`、`ogn/find-your-center`、`ogn/kraken-hunter`、`ogn/lee-sin-centered`、`ogn/legion-rearguard`、`ogn/malzahar-fanatic`、`ogn/meditation`、`ogn/nocturne-horrifying`、`ogn/noxus-hopeful`、`ogn/pouty-poro`、`ogn/qiyana-victorious`、`ogn/rhasa-the-sunderer`、`ogn/sky-splitter`、`ogn/spirits-refuge`、`ogn/super-mega-death-rocket-jinx`、`ogn/tasty-faefolk`、`ogn/thousand-tailed-watcher`、`ogn/tideturner`、`ogn/unlicensed-armory`、`ogn/wallop`、`ogs/lux-crownguard`、`rad/demon-shade`、`rad/dune-devourer`、`rad/ekko-ingenious`、`rad/encore`、`rad/ezreal-dashing`、`rad/hush`、`rad/iron-revenant`、`rad/ki-burst`、`rad/ksante-courageous`、`rad/life-from-stone`、`rad/lost-to-the-sands`、`rad/momentary-companion`、`rad/mordekaiser-twice-slain`、`rad/parallel-convergence`、`rad/reckless-innovator`、`rad/riven-deserter`、`rad/shimmering-swimmer`、`rad/skystrike-squadron`、`rad/starry-eyed-songstress`、`rad/supernova`、`rad/the-ball`、`rad/war-scout`、`rad/watchful-curator`、`sfd/akshan-mischievous`、`sfd/ancient-henge`、`sfd/ancient-warmonger`、`sfd/angle-shot`、`sfd/arise`、`sfd/armed-assailant`、`sfd/azir-ascendant`、`sfd/azir-sovereign`、`sfd/bard-mercurial`、`sfd/battle-mistress`、`sfd/bellows-breath`、`sfd/blast-corps-cadet`、`sfd/blood-rush`、`sfd/called-shot`、`sfd/corinna-veraza`、`sfd/danger-zone`、`sfd/deserts-call`、`sfd/drag-under`、`sfd/ezreal-prodigy`、`sfd/feral-strength`、`sfd/fire-below-the-mountain`、`sfd/fizz-trickster`、`sfd/forge-of-the-fluft`、`sfd/frostcoat-cub`、`sfd/glasc-mixologist`、`sfd/grandmaster-at-arms`、`sfd/hard-bargain`、`sfd/irelia-fervent`、`sfd/irelia-graceful`、`sfd/jaull-fish`、`sfd/jayce-man-of-progress`、`sfd/legion-quartermaster`、`sfd/marai-spire`、`sfd/marching-orders`、`sfd/navori-scout`、`sfd/ornns-forge`、`sfd/petricite-monument`、`sfd/piercing-light`、`sfd/prize-of-progress`、`sfd/prodigal-explorer`、`sfd/reksai-breacher`、`sfd/rocket-barrage`、`sfd/sea-monkey`、`sfd/sivir-mercenary`、`sfd/steraks-gage`、`sfd/temporal-portal`、`sfd/thwonk`、`sfd/zaun-punk`、`unl/atakhan`、`unl/bashful-bloom`、`unl/conscription`、`unl/crescent-guardian`、`unl/curtain-call`、`unl/disposal-order`、`unl/double-trouble`、`unl/downstage-dramatics`、`unl/existential-dread`、`unl/gardens-of-becoming`、`unl/heedless-resurrection`、`unl/honeyfruit`、`unl/ivern-friend-to-all`、`unl/jhin-meticulous-killer`、`unl/lillia-fae-fawn`、`unl/mister-root`、`unl/nami-headstrong`、`unl/nilah-joyful-ascetic`、`unl/poppy-defender-of-the-meek`、`unl/pyke-dockside-butcher`、`unl/red-brambleback`、`unl/rengar-unseen`、`unl/sacrifice`、`unl/safety-inspector`、`unl/scorn-of-the-moon`、`unl/sharkling`、`unl/square-up`、`unl/stalking-wolf`、`unl/syndra-transcendent`、`unl/the-academy`、`unl/undying-legion`、`unl/undying-loyalty`、`unl/upstage-comedy`、`unl/vaults-of-helia`、`unl/vi-hotheaded`、`unl/vi-peacekeeper`、`unl/xerath-freed`、`ven/brutal-hunter`、`ven/crumbling-sands`、`ven/curator-of-the-sands`、`ven/death-mark`、`ven/decree-of-focus`、`ven/dragon-roost`、`ven/eclipse-dragon`、`ven/frostcoat-mother`、`ven/gangplank-naval`、`ven/glowstone`、`ven/grumpy-rockbear`、`ven/gust-monk`、`ven/helm-of-suppression`、`ven/keeper-of-law`、`ven/lacerate`、`ven/lightning-rush`、`ven/masa-crashing-thunder`、`ven/mystic-vortex`、`ven/noxian-emissary`、`ven/ol-poro`、`ven/onslaught`、`ven/platewyrm-egg`、`ven/plaza-guardian`、`ven/rage-amplifier`、`ven/rampage`、`ven/rebuttal`、`ven/renekton-brute`、`ven/renekton-rage-fueled`、`ven/ruthless-strike`、`ven/sanction`、`ven/sandswept-tomb`、`ven/shadowblade-lurker`、`ven/shady-spectacles`、`ven/shock-blast`、`ven/zed-from-the-shadows`。

### 8. EG-TRIGGERS — 触发条件、前导 may/费用及事件 it 的生产绑定

受阻 **140** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-EVENTS, EG-FILTER, EG-PAYLOAD, EG-EXPR。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：前导 may 和 cost 在 Finalize 处理；绑定触发快照到非目标 it；条件在正确触发时点求值并支持反身触发新 Pending 项。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/triggers.ts`；`packages/engine-core/src/programs/trigger-adapters/**`（建议新建）；`packages/engine-core/test/engine-gaps/triggers.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/programs/triggers.ts:27`：`optional: ability.optional,`。
- `packages/engine-core/src/events/pipeline-types.ts:36`：`readonly mayAtFinalize?: boolean;`。
- CR v1.5：383.3.a, 383.3.b.1, 383.2.c；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：Error("hidden-cleanup-state")。(2) 740.4.a.2 要求「you may pay :rb_energy_2:」作为触发前置费用在 Finalize 支付，但冻结的 TriggeredAbility 没有 cost 字段，programs/triggers.ts 也不把卡牌的指令内费用提取成 TriggerRegistration.cost/mayAtFinalize；两条触发的 TargetSpec 又嵌在 choice.optional 的 body。
- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：TypeError，事后补 effect.exhaust 不等价（会多产生一次「成为横置」事件并错过入场替代）；（3）费用式「exhaust me」（383.3.b/383.3.b.1/415.4/415.5）缺触发点的 Finalize 绑定与 legend-zone 表达：正文已按已合入的可支付形状声明该费用（cost.modify 锁定 { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }，cos。

**受阻卡（完整）**：`ogn/back-alley-bar`、`ogn/dragons-rage-lee-sin`、`ogn/ekko-recurrent`、`ogn/first-mate`、`ogn/flame-chompers`、`ogn/immortal-phoenix`、`ogn/imperial-decree`、`ogn/mistfall`、`ogn/monastery-of-hirana`、`ogn/obelisk-of-power`、`ogn/pirates-haven`、`ogn/poro-herder`、`ogn/qiyana-victorious`、`ogn/relentless-storm`、`ogn/scrapheap`、`ogn/sprite`、`ogn/super-mega-death-rocket-jinx`、`ogn/the-arenas-greatest`、`ogn/twisted-fate-gambler`、`ogn/undercover-agent`、`ogn/vanguard-captain`、`ogn/vanguard-helm`、`ogn/vayne-hunter`、`ogn/wildclaw-shaman`、`ogn/yasuo-windrider`、`ogn/zaun-warrens`、`ogs/dark-child-starter`、`ogs/highlander-yi`、`ogs/lady-of-luminosity-starter`、`rad/exemplar-of-demacia`、`rad/fanfare`、`rad/firelights-hideout`、`rad/lady-of-clockwork`、`rad/meticulous-restorationist`、`rad/mordekaiser-dominating`、`rad/piltovan-guidebot`、`rad/rakelstake`、`rad/raving-witness`、`rad/resource-extractor`、`rad/siren-of-the-shallows`、`rad/sneaky-zeebles`、`rad/stalwart-goatherd`、`rad/storm-raptor`、`rad/suave-negotiator`、`rad/the-ball`、`rad/titanic-shrine`、`rad/zero-point-inflection`、`sfd/altar-of-memories`、`sfd/apprentice-smith`、`sfd/battle-mistress`、`sfd/blade-dancer`、`sfd/buhru-captain`、`sfd/chem-baroness`、`sfd/corinna-veraza`、`sfd/emperors-dais`、`sfd/fae-porter`、`sfd/ferrous-forerunner`、`sfd/fiora-peerless`、`sfd/fizz-trickster`、`sfd/frostcoat-cub`、`sfd/glasc-mixologist`、`sfd/glorious-executioner`、`sfd/hall-of-legends`、`sfd/harpoon-squad`、`sfd/jax-unrelenting`、`sfd/loyal-pup`、`sfd/lucian-merciless`、`sfd/overzealous-fan`、`sfd/rally-the-troops`、`sfd/ribbon-dancer`、`sfd/sea-monkey`、`sfd/simian-ancestor`、`sfd/spirit-wheel`、`sfd/void-burrower`、`sfd/windsinger`、`unl/alpha-strike`、`unl/ashe-focused`、`unl/blast-cone`、`unl/blood-rose`、`unl/bone-skewer`、`unl/brush`、`unl/deadly-flourish`、`unl/death-from-below`、`unl/deceiver`、`unl/diana-lunari`、`unl/dramatic-visionary`、`unl/dusk-rose-lab`、`unl/elder-dragon`、`unl/forgotten-library`、`unl/fresh-beans`、`unl/frigid-jewel`、`unl/gloomist`、`unl/green-father`、`unl/grim-apothecary`、`unl/grim-resolve`、`unl/hwei-brooding-painter`、`unl/icevale-archer`、`unl/insightful-investigator`、`unl/jhin-meticulous-killer`、`unl/katarina-reckless`、`unl/khazix-mutating-horror`、`unl/lillia-fae-fawn`、`unl/mageseeker-investigator`、`unl/nami-headstrong`、`unl/pridestalker`、`unl/pyke-returned`、`unl/red-brambleback`、`unl/rippers-bay`、`unl/safety-inspector`、`unl/scorchclaw`、`unl/shard-of-undoing`、`unl/sinister-poro`、`unl/star-spring`、`unl/turn-to-dust`、`unl/valley-of-idols`、`unl/vaults-of-helia`、`unl/vex-apathetic`、`unl/vex-mocking`、`unl/virtuoso`、`unl/voracious-gromp`、`unl/wuju-apprentice`、`ven/bottled-constellation`、`ven/covert-informant`、`ven/curator-of-the-sands`、`ven/eclipse-dragon`、`ven/forgotten-relic`、`ven/forsaken-baccai`、`ven/glowstone`、`ven/jayce-brilliant-inventor`、`ven/kennen-keeper-of-balance`、`ven/kharox`、`ven/masa-crashing-thunder`、`ven/nasus-guardian-of-knowledge`、`ven/profiteer`、`ven/protective-sands`、`ven/ravenbloom-prefect`、`ven/shadow-order-disciple`、`ven/shen-leader-of-the-kinkou-order`、`ven/shen-scourge-of-shadows`、`ven/threshold-of-the-gray`。

### 9. EG-COMBAT — 战斗开启、角色指定和同时伤害原子事务

受阻 **136** 张；**B4 / XL**（6–10 工程日）；deps：EG-CONTRACT, EG-PAYLOAD, EG-COMBATPRIORITY, EG-MOVE。 优先复用现有 IR。

**实现与验收**：真实开启 Combat/Showdown，保留 Focus，指定/撤销 attacker/defender 并发射时点；接受合法伤害选择后原子同时 Deal，再清理/Conquer/Score。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/combat/flow.ts`；`packages/engine-core/src/combat/object-ref.ts`；`packages/engine-core/src/combat/transactions/**`（建议新建）；`packages/engine-core/test/engine-gaps/combat.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/combat/flow.ts:151`：`throw new TurnCombatBlockedError('combat-start-transaction', 'Combat start needs an atomic simultaneous timing wave + roles (CR 466.2)');`。
- `packages/engine-core/src/combat/flow.ts:158`：`throw new TurnCombatBlockedError('simultaneous-damage-transaction', 'Batch 4 needs commitBatch with deferred trigger scan and rollback across both sides (CR 467.2.c.1.a / 467.3)');`。
- CR v1.5：466.2, 467.2.c.1.a；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `unl/rengar-unseen`（`packages/card-dsl/src/cards/unl/rengar-unseen.ts:44`）：issingInformation 并按 false 兜底，所以 +2 对任何角色都不生效（实测 attacker/defender/null 三种 combatRole 下 Might 均不变）；把 designation 映射到 combatRole 的扩展求值器（effects/interpreter/expr-ext/）没有任何生产调用方（grep 全 src 无 importer），且 combat/flow.ts 的 startCombat 仍抛 "combat-start-tran。
- `ven/renekton-brute`（`packages/card-dsl/src/cards/ven/renekton-brute.ts:122`）：值器上仍不可读（实测 MissingInformation "Unavailable characteristic: designation"），且 combat/flow.ts 的 combat-start-transaction 仍抛 TurnCombatBlockedError，没有生产写入方发布 ObjectSnapshot.combatRole。continuous.might 与 effect.empower 已真实执行，保留 judge-required。。

**受阻卡（完整）**：`ogn/ahri-inquisitive`、`ogn/anivia-primal`、`ogn/ava-achiever`、`ogn/block`、`ogn/cannon-barrage`、`ogn/captain-farron`、`ogn/chemtech-enforcer`、`ogn/cleave`、`ogn/crackshot-corsair`、`ogn/daring-poro`、`ogn/dune-drake`、`ogn/fiora-victorious`、`ogn/fortified-position`、`ogn/immortal-phoenix`、`ogn/jeweled-colossus`、`ogn/kraken-hunter`、`ogn/lee-sin-ascetic`、`ogn/leona-determined`、`ogn/mask-of-foresight`、`ogn/nine-tailed-fox`、`ogn/petty-officer`、`ogn/raging-soul`、`ogn/reavers-row`、`ogn/shen-kinkou`、`ogn/stalwart-poro`、`ogn/sunlit-guardian`、`ogn/symbol-of-the-solari`、`ogn/taric-protector`、`ogn/teemo-strategist`、`ogn/twisted-fate-gambler`、`ogn/vayne-hunter`、`ogn/volibear-furious`、`ogn/volibear-imposing`、`ogn/warwick-hunter`、`ogn/wielder-of-water`、`ogn/yasuo-remorseful`、`ogn/zaun-warrens`、`ogs/garen-rugged`、`ogs/wuju-bladesman-starter`、`ogs/zephyr-sage`、`rad/ahri-confident`、`rad/blossoming-dreamroot`、`rad/clanging-sentry`、`rad/consult-the-heavens`、`rad/demacian-standard`、`rad/disposal-expert`、`rad/durand-memorial`、`rad/ekko-revolutionary`、`rad/evelynn-in-control`、`rad/ezreal-dashing`、`rad/for-demacia`、`rad/graves-blasting-through`、`rad/jarvan-iv-royal-heir`、`rad/kaisa-rebel`、`rad/ksante-courageous`、`rad/ksante-dauntless`、`rad/mordekaiser-twice-slain`、`rad/siren-of-the-shallows`、`rad/stalwart-goatherd`、`rad/staunch-survivor`、`rad/wrath-of-the-freljord`、`rad/ziggs-explosive`、`sfd/ancient-warmonger`、`sfd/azir-sovereign`、`sfd/blood-rush`、`sfd/corrupt-enforcer`、`sfd/draven-audacious`、`sfd/draven-vanquisher`、`sfd/fiora-peerless`、`sfd/glorious-executioner`、`sfd/laurent-duelist`、`sfd/loyal-pup`、`sfd/lucian-gunslinger`、`sfd/needlessly-large-yordle`、`sfd/overzealous-fan`、`sfd/ravenbloom-conservatory`、`sfd/reksai-breacher`、`sfd/reksai-swarm-queen`、`sfd/rell-magnetic`、`sfd/rengar-pouncing`、`sfd/rumble-hotheaded`、`sfd/sudden-storm`、`unl/atakhan`、`unl/black-rose-dignitary`、`unl/blue-sentinel`、`unl/crimson-pigeons`、`unl/daisy`、`unl/existential-dread`、`unl/forbidding-waste`、`unl/grim-resolve`、`unl/icevale-archer`、`unl/inferna`、`unl/khazix-evolving-hunter`、`unl/khazix-mutating-horror`、`unl/leblanc-fragmented`、`unl/lord-broadmane`、`unl/mutated-mouser`、`unl/nidalee-cat-form`、`unl/piltover-enforcer`、`unl/rengar-unseen`、`unl/shadow`、`unl/sharkling`、`unl/sinister-poro`、`unl/square-up`、`unl/towering-combatant`、`unl/towering-pairofant`、`unl/trevor-snoozebottom`、`unl/vault-breaker`、`unl/vex-mocking`、`unl/vi-peacekeeper`、`unl/vilemaw`、`unl/voidreaver`、`unl/yuumi-magical-cat`、`ven/affectionate-poro`、`ven/akali-silent`、`ven/ambessa-respected-and-feared`、`ven/ambessa-the-wolf`、`ven/baccai-reaper`、`ven/baccai-sandspinner`、`ven/corrupted-dragon`、`ven/dame-the-despoiler`、`ven/death-mark`、`ven/decree-of-focus`、`ven/grumpy-rockbear`、`ven/mournful-witness`、`ven/perfect-execution`、`ven/renekton-brute`、`ven/renekton-rage-fueled`、`ven/repair-specialist`、`ven/riven-shattered`、`ven/sacred-protector`、`ven/serene-ascetic`、`ven/shadow-fiend`、`ven/shen-leader-of-the-kinkou-order`、`ven/threshold-of-the-gray`、`ven/twilight-reveler`。

### 10. EG-RULES — 规则修改查询与实际动作消费者

受阻 **126** 张；**B2 / L**（3–5 工程日）；deps：EG-EXPR, EG-FILTERS。 优先复用现有 IR。

**实现与验收**：统一来源相对玩家/受影响对象及 permission 结构；查询区分 play/activate，接动作消费者；包括有来源的打出/目标/费用/资源/能力次数规则，未知规则失败关闭。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/layers/rules/**`；`packages/engine-core/src/effects/instructions/continuous.restrict.ts`；`packages/engine-core/src/effects/instructions/continuous.timing.ts`；`packages/engine-core/src/effects/instructions/continuous.movement.ts`；`packages/engine-core/src/effects/instructions/continuous.combat.ts`；`packages/engine-core/src/effects/instructions/continuous.deck.ts`；`packages/engine-core/test/engine-gaps/rules.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/layers/rules/query.ts:244`：`export function restrictions(`。
- CR v1.5：364.3, 420.4.a；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：word-grants.ts（expandEffectiveKeywords/KeywordGrantLayerEngine）把已授予关键词 展开成 continuous.movement 并产出 permission.routes 都已合入，实测授予后 movement().canGank 为 true 且 Standard Move 成功；但没有任何生产装配安装该引擎：ChainEngine 默认用普通 LayerEngine、TurnFlow 用同样非授权的 TurnPhaseLayers，只有 RIFT-。
- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：itional :rb_energy_1:」是改写 [Add] 产出的条件持续效果：programs/statics.ts 的 layerFor 对 modify-resource-ability 没有映射（实测抛 ProgramBindingError "Static ability kind modify-resource-ability has no layer mapping"），也没有资源产出加成的持续效果形状。复核记录：hold 时点的订阅词汇是 "held"（TriggerSpec 的 EVENT_PATT。

**受阻卡（完整）**：`ogn/bandle-tree`、`ogn/bilgewater-bully`、`ogn/blitzcrank-impassive`、`ogn/block`、`ogn/bounty-hunter`、`ogn/brynhir-thundersong`、`ogn/caitlyn-patrolling`、`ogn/commander-ledros`、`ogn/deadbloom-predator`、`ogn/kaisa-evolutionary`、`ogn/kayn-unleashed`、`ogn/last-stand`、`ogn/lecturing-yordle`、`ogn/lee-sin-ascetic`、`ogn/maddened-marauder`、`ogn/mageseeker-warden`、`ogn/miss-fortune-captain`、`ogn/noxus-saboteur`、`ogn/sai-scout`、`ogn/sett-kingpin`、`ogn/shen-kinkou`、`ogn/sneaky-deckhand`、`ogn/sprite-call`、`ogn/stormclaw-ursine`、`ogn/sunlit-guardian`、`ogn/taric-protector`、`ogn/vi-destructive`、`ogn/vilemaws-lair`、`ogn/volibear-imposing`、`ogs/lux-crownguard`、`ogs/master-yi-honed`、`rad/banner-of-conquest`、`rad/black-market`、`rad/concert-poster`、`rad/consult-the-heavens`、`rad/entrenched-boar`、`rad/evelynn-consuming`、`rad/ezreal-dashing`、`rad/firebrand-raider`、`rad/graves-blasting-through`、`rad/gravity-field`、`rad/hunker-down`、`rad/jarvan-iv-martial-paragon`、`rad/jarvan-iv-royal-heir`、`rad/party-crasher`、`rad/siren-of-the-shallows`、`rad/steadfast-outrider`、`rad/the-good-stuff`、`sfd/chem-baroness`、`sfd/cloth-armor`、`sfd/forgotten-monument`、`sfd/gem-jammer`、`sfd/janna-savior`、`sfd/jax-unmatched`、`sfd/laurent-bladekeeper`、`sfd/minotaur-reckoner`、`sfd/needlessly-large-yordle`、`sfd/prodigal-explorer`、`sfd/rabadons-deathcrown`、`sfd/rell-magnetic`、`sfd/ruin-runner`、`sfd/shurelyas-requiem`、`sfd/sivir-mercenary`、`sfd/soraka-wanderer`、`sfd/steraks-gage`、`sfd/sudden-storm`、`sfd/tianna-crownguard`、`sfd/xin-zhao-vigilant`、`unl/alpha-wildclaw`、`unl/atakhan`、`unl/baron-nashor`、`unl/baron-pit`、`unl/chakram-dancer`、`unl/determined-sentry`、`unl/diana-no-longer-human`、`unl/enthusiastic-promoter`、`unl/evelynn-entrancing`、`unl/galio-indefatigable`、`unl/grim-apothecary`、`unl/inferna`、`unl/jhin-murderous-artist`、`unl/keeper-of-masks`、`unl/leblanc-everywhere-at-once`、`unl/lillia-protector-of-dreams`、`unl/lilting-lullaby`、`unl/lord-broadmane`、`unl/lotus-trap`、`unl/mageseeker-investigator`、`unl/megatusk`、`unl/mutated-mouser`、`unl/nidalee-cat-form`、`unl/nilah-joyful-ascetic`、`unl/poppy-defender-of-the-meek`、`unl/pyke-dockside-butcher`、`unl/pyke-returned`、`unl/rengar-trophy-hunter`、`unl/rengar-unseen`、`unl/revna-the-lorekeeper`、`unl/sumpworks-map`、`unl/towering-combatant`、`unl/vault-breaker`、`unl/vex-apathetic`、`unl/vex-mocking`、`unl/vi-peacekeeper`、`unl/vilemaw`、`unl/wily-newtfish`、`unl/yuumi-magical-cat`、`ven/akali-silent`、`ven/brittle-steel`、`ven/butcher-of-the-sands`、`ven/decree-of-rage`、`ven/dune-surfer`、`ven/eye-of-twilight`、`ven/fallen-feline`、`ven/horns-of-the-dragon`、`ven/kayle-justified`、`ven/keeper-of-law`、`ven/kinkou-lifeblade`、`ven/mel-newly-awakened`、`ven/morgana-vindictive`、`ven/oasis-raider`、`ven/renekton-brute`、`ven/sacred-protector`、`ven/sandstone-chimera`、`ven/soulspinner`、`ven/twilight-shroud`。

### 11. EG-DISCOUNTS — 生产折扣收集、追加费条件与一次性窗口

受阻 **125** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-EXPR。 优先复用现有 IR。

**实现与验收**：复用已存在算术，补 selectedAdditional/grantedBy、实付数量、ignore-base 分量、下一张/首次窗口及消费/回滚；在真正 Finalize 采集。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/cost/discounts/**`；`packages/engine-core/src/effects/instructions/cost.modify.ts`；`packages/engine-core/src/effects/instructions/continuous.cost-modification.ts`；`packages/engine-core/test/engine-gaps/discounts.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/cost/discounts/collect.ts:30`：`const FIELDS = new Set(['kind', 'resource', 'amount', 'minimum', 'stage', 'appliesTo', 'filter', 'component', 'alternative', 'universal', 'domain', 'domains', 'fromZone', 'when', 'per', 'duration', 'value', 'reductions', 'history']);`。
- `packages/engine-core/src/chain/engine.ts:348`：`item.costPlan = buildCostPlan(paymentContext, { ...(input ?? { id: 'cost:${item.id}', cost: { energy: { kind: 'constant', value: 0 } } }), mandatoryAdditional: [...(input?.mandatoryAdditional ?? []), ...taxes.map((tax, index) => ({ id: 'target-tax:${index}', cost: { energy: { kind: 'constant' as const, value: tax.amount } } }))] });`。
- CR v1.5：356.4.c, 356.4.f.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：383.3.b.1/415.4/415.5）缺触发点的 Finalize 绑定与 legend-zone 表达：正文已按已合入的可支付形状声明该费用（cost.modify 锁定 { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }，cost.pay 经 linked-value 收取，golden 在解释器上真实执行并断言横置发生），但生产链路径不会把 cost.modify 的 id 字面量化（chain/。
- `rad/boy-who-shattered-time`（`packages/card-dsl/src/cards/rad/boy-who-shattered-time.ts:135`）：163.2.b）。仍缺「下一张打出的单位」的一次性费用窗口：cost/plan-values.ts 与 layers 的 duration 词汇没有 next-unit（isDurationAlias("next-unit") === false），原语对 "next-unit-played-this-turn" 抛 "Unknown continuous cost modification duration"，且 ChainEngine 的 Finalize 仍直接调用 buildCostP。

**受阻卡（完整）**：`ogn/ava-achiever`、`ogn/bandle-tree`、`ogn/blind-fury`、`ogn/brazen-buccaneer`、`ogn/call-to-glory`、`ogn/commander-ledros`、`ogn/dazzling-aurora`、`ogn/eager-apprentice`、`ogn/find-your-center`、`ogn/herald-of-scales`、`ogn/kaisa-evolutionary`、`ogn/kraken-hunter`、`ogn/nocturne-horrifying`、`ogn/noxus-hopeful`、`ogn/portal-rescue`、`ogn/promising-future`、`ogn/qiyana-victorious`、`ogn/raging-firebrand`、`ogn/ravenborn-tome`、`ogn/reinforce`、`ogn/rhasa-the-sunderer`、`ogn/sky-splitter`、`ogn/soulgorger`、`ogn/spectral-matron`、`ogn/spoils-of-war`、`ogn/sun-disc`、`ogn/teemo-scout`、`ogn/teemo-strategist`、`ogn/the-harrowing`、`ogn/wallop`、`ogn/zhonyas-hourglass`、`rad/bedeviling-stranger`、`rad/blade-of-the-exile`、`rad/boy-who-shattered-time`、`rad/chronobreak`、`rad/dockside-lock-up`、`rad/drakehound-packmaster`、`rad/dune-devourer`、`rad/ekko-revolutionary`、`rad/elnuk-herd`、`rad/firelights-hideout`、`rad/hold-em`、`rad/hunters-circle`、`rad/orianna-mechanical-marvel`、`rad/party-crasher`、`rad/runeblade-anvil`、`rad/starry-eyed-songstress`、`rad/the-waters-wage`、`rad/transpositionist`、`sfd/akshan-mischievous`、`sfd/altar-of-memories`、`sfd/arcane-shift`、`sfd/armed-assailant`、`sfd/battering-ram`、`sfd/blade-dancer`、`sfd/blast-corps-cadet`、`sfd/chem-baroness`、`sfd/combat-chef`、`sfd/drag-under`、`sfd/emperor-of-the-sands`、`sfd/ezreal-prodigy`、`sfd/fizz-trickster`、`sfd/glasc-mixologist`、`sfd/here-to-help`、`sfd/irelia-graceful`、`sfd/jaull-fish`、`sfd/jax-unrelenting`、`sfd/lucian-merciless`、`sfd/marai-spire`、`sfd/master-bingwen`、`sfd/needlessly-large-yordle`、`sfd/ornn-forge-god`、`sfd/ornns-forge`、`sfd/recurve-bow`、`sfd/reksai-breacher`、`sfd/rell-magnetic`、`sfd/renata-glasc-mastermind`、`sfd/rumble-hotheaded`、`sfd/sentinel-adept`、`sfd/spirit-wheel`、`sfd/veteran-poro`、`sfd/vex-cheerless`、`sfd/void-drone`、`sfd/void-rush`、`unl/atakhan`、`unl/back-off`、`unl/bashful-bloom`、`unl/blighted-battleaxe`、`unl/bone-skewer`、`unl/concentrate`、`unl/daisy`、`unl/forgotten-library`、`unl/forgotten-signpost`、`unl/heedless-resurrection`、`unl/hextech-gauntlets`、`unl/master-yi-unstoppable`、`unl/mischievous-marai`、`unl/monch`、`unl/poppy-defender-of-the-meek`、`unl/rift-herald`、`unl/the-academy`、`unl/thrill-of-the-hunt`、`unl/undying-loyalty`、`unl/vaults-of-helia`、`ven/applied-researchers`、`ven/astral-heron`、`ven/baccai-sandspinner`、`ven/frostcoat-mother`、`ven/grumpy-rockbear`、`ven/heart-of-the-tempest`、`ven/helm-of-suppression`、`ven/keeper-of-law`、`ven/masa-crashing-thunder`、`ven/mystic-vortex`、`ven/piltovan-forge`、`ven/plaza-guardian`、`ven/risen-altar`、`ven/riven-shattered`、`ven/ruthless-strike`、`ven/sandswept-tomb`、`ven/shadowblade-lurker`、`ven/shock-blast`、`ven/stargazer`、`ven/tail-cloaked-matriarch`、`ven/wild-claw`。

### 12. EG-PAYLOAD — 动作事件的对象、责任归属、起终点与批次载荷

受阻 **124** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-EVENTS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：从实际提交动作发射前后快照、look/reveal 对象集、Move 起终点/原因、effect controller、batchId 与 Might 变化；区分被行动者与行动责任人。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/events/action-adapter.ts`；`packages/engine-core/src/events/producers/**`；`packages/engine-core/test/engine-gaps/payload.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/events/action-adapter.ts:11`：`'move-location': 'object-moved', ready: 'object-readied', exhaust: 'object-exhausted', stun: 'unit-stunned', kill: 'object-killed',`。
- CR v1.5：423.1.b, 449.1, 449.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/renekton-brute`（`packages/card-dsl/src/cards/ven/renekton-brute.ts:122`）：只描述 current Might >= 10，会把 10→11 误当成新跨越；events/producers/might-change.ts 的 deriveMightChangedEmissions 仍没有图层重算后的生产调用方。(2) 828.1.b.1 的门控读取 self.empowered：参考内核可求值（golden 用真实 empower 动作使该门控开启并授予 Deflect/Ganking），但契约 ObjectSnapshot（engine-core/src/effects/contract.ts）不声明。
- `unl/red-brambleback`（`packages/card-dsl/src/cards/unl/red-brambleback.ts:96`）：flow.ts 发出的 conquer 只带 { battlefieldId }（timing-points.ts 的 conquer 条目没有声明 payloadFields），而 programs/triggers.ts 把 { source: "self" } 翻译成 { event: "conquered", object: { objectId: <本卡> } }；实测该过滤器对只带 player + battlefieldId 的 conquer 事件不匹配（事件里没有承载征服。

**受阻卡（完整）**：`ogn/back-alley-bar`、`ogn/eclipse-herald`、`ogn/jinx-rebel`、`ogn/karma-channeler`、`ogn/mask-of-foresight`、`ogn/monastery-of-hirana`、`ogn/nine-tailed-fox`、`ogn/nocturne-horrifying`、`ogn/noxian-drummer`、`ogn/qiyana-victorious`、`ogn/radiant-dawn`、`ogn/reavers-row`、`ogn/reckoners-arena`、`ogn/sigil-of-the-storm`、`ogn/solari-shrine`、`ogn/startipped-peak`、`ogn/stealthy-pursuer`、`ogn/sun-disc`、`ogn/tasty-faefolk`、`ogn/the-dreaming-tree`、`ogn/trifarian-gloryseeker`、`ogn/tryndamere-barbarian`、`ogn/undercover-agent`、`ogn/vanguard-captain`、`ogn/vanguard-helm`、`ogn/volibear-imposing`、`ogn/zaun-warrens`、`rad/ahri-confident`、`rad/akali-brash`、`rad/concert-poster`、`rad/demacian-standard`、`rad/evelynn-consuming`、`rad/ksante-courageous`、`rad/meticulous-restorationist`、`rad/pillaged-armory`、`rad/ruined-monastery`、`rad/the-good-stuff`、`rad/titanic-shrine`、`sfd/apprentice-smith`、`sfd/battle-mistress`、`sfd/chemtech-cask`、`sfd/corrupt-enforcer`、`sfd/draven-audacious`、`sfd/dunebreaker`、`sfd/edge-of-night`、`sfd/eminent-benefactor`、`sfd/glorious-executioner`、`sfd/guardian-of-the-passage`、`sfd/hall-of-legends`、`sfd/harpoon-squad`、`sfd/jax-unrelenting`、`sfd/kato-the-arm`、`sfd/loyal-pup`、`sfd/minefield`、`sfd/ornn-blacksmith`、`sfd/overzealous-fan`、`sfd/petricite-monument`、`sfd/plundering-poro`、`sfd/ravenbloom-conservatory`、`sfd/ribbon-dancer`、`sfd/simian-ancestor`、`sfd/sivir-ambitious`、`sfd/stellacorn-herder`、`sfd/sunken-temple`、`sfd/the-papertree`、`sfd/veiled-temple`、`sfd/zaun-punk`、`unl/abandoned-hall`、`unl/altar-of-blood`、`unl/amateur-recital`、`unl/back-off`、`unl/blast-cone`、`unl/blue-sentinel`、`unl/crowd-favorite`、`unl/enthusiastic-promoter`、`unl/evelynn-entrancing`、`unl/frigid-jewel`、`unl/green-father`、`unl/herald-of-spring`、`unl/imposing-challenger`、`unl/inviolus-vox`、`unl/irresistible-faefolk`、`unl/jhin-murderous-artist`、`unl/lillia-fae-fawn`、`unl/mister-root`、`unl/piltover-enforcer`、`unl/red-brambleback`、`unl/revna-the-lorekeeper`、`unl/rippers-bay`、`unl/shard-of-undoing`、`unl/star-spring`、`unl/the-academy`、`unl/towering-combatant`、`unl/trapping-grounds`、`unl/trevor-snoozebottom`、`unl/undying-legion`、`unl/valley-of-idols`、`unl/vaults-of-helia`、`unl/vex-mocking`、`unl/vilemaw`、`unl/voidreaver`、`unl/yeti-brawler`、`unl/yuumi-magical-cat`、`ven/affectionate-poro`、`ven/akali-silent`、`ven/apprentice-mage`、`ven/crumbling-sands`、`ven/eclipse-dragon`、`ven/fretful-feline`、`ven/heart-of-the-tempest`、`ven/kharox`、`ven/minah-swiftfoot`、`ven/nasus-guardian-of-knowledge`、`ven/otterpus`、`ven/protective-sands`、`ven/renekton-brute`、`ven/shadow-temple`、`ven/shen-leader-of-the-kinkou-order`、`ven/shen-scourge-of-shadows`、`ven/souls-reflection`、`ven/swain-visionary`、`ven/threshold-of-the-gray`、`ven/tornado-warrior`、`ven/zed-without-a-sound`。

### 13. EG-COSTCHOICE — 动态对象费用、任意数量支付与计划收据

受阻 **121** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-TARGETS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：Finalize 按当前控制者/区域生成真实非目标费用选项，锁定 0..N 数量，建立实付数量/选中对象收据；解析已支持费用而非 invent equip/empower 伪 kind。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/cost/plan-values.ts`；`packages/engine-core/src/cost/cost-plan.ts`；`packages/engine-core/src/cost/plan-types.ts`；`packages/engine-core/src/cost/plan-choices.ts`（建议新建）；`packages/engine-core/src/cost/kinds/additional.ts`；`packages/engine-core/src/cost/kinds/banish.ts`（建议新建）；`packages/engine-core/src/cost/kinds/disempower.ts`（建议新建）；`packages/engine-core/src/effects/instructions/cost.pay.ts`；`packages/engine-core/src/effects/instructions/cost.pay-any.ts`（建议新建）；`packages/engine-core/src/effects/instructions/cost.pay-any-power.ts`（建议新建）；`packages/engine-core/test/engine-gaps/costchoice.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/cost/plan-values.ts:66`：`if (!value || typeof value !== 'object' || !('id' in value) || !('zoneEntryId' in value)) return invalid('Cost requires an exact object reference');`。
- `packages/engine-core/src/cost/plan-values.ts:160`：`} else blocked('Unsupported payment kind: ${payment.kind}');`。
- CR v1.5：355.10.c.1, 204.3, 357.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：不可达。(4) [Accelerate] 的卡牌接线缺失：KeywordDef 的 accelerate.cost 声明与 805.6 入场就绪替代、cost/cost-plan.ts 的 accelerate 可选费用组、chain/engine.ts resolve() 的 selectedAdditional 消费都已合入，但 programs/play.ts translateCost 对展开的 cost 抛 Unsupported play cost field optional，progra。
- `unl/rengar-unseen`（`packages/card-dsl/src/cards/unl/rengar-unseen.ts:44`）：rogram，但都还没有可执行的生产消费路径，均不近似实现：(1) [Accelerate]（805.1.b/805.2.b/805.6）：费用计划（cost/cost-plan.ts 的 optionalAdditional kind "accelerate"）与链的就绪入场消费（chain/engine.ts 读取 selectedAdditional 的 accelerate）都已合入，展开的 accelerate.cost 静态声明与入场替代也能绑定（实测 expandProgram(inspe。

**受阻卡（完整）**：`ogn/bullet-time-miss-fortune`、`ogn/cruel-patron`、`ogn/garbage-grabber`、`ogn/kraken-hunter`、`ogn/malzahar-fanatic`、`ogn/portal-rescue`、`ogn/soulgorger`、`ogn/spectral-matron`、`ogn/super-mega-death-rocket-jinx`、`ogn/the-harrowing`、`ogn/vi-destructive`、`rad/an-offer-you-cant-refuse`、`rad/blade-of-the-exile`、`rad/boy-who-shattered-time`、`rad/chronobreak`、`rad/ekko-ingenious`、`rad/ekko-revolutionary`、`rad/invigorating-bloom`、`rad/iron-revenant`、`rad/ki-burst`、`rad/life-from-stone`、`rad/mordekaiser-dominating`、`rad/nazuman-ntofo`、`rad/parallel-convergence`、`rad/riven-deserter`、`rad/skystrike-squadron`、`rad/starry-eyed-songstress`、`sfd/akshan-mischievous`、`sfd/ancient-henge`、`sfd/arcane-shift`、`sfd/azir-sovereign`、`sfd/blade-of-the-ruined-king`、`sfd/boneshiver`、`sfd/boots-of-swiftness`、`sfd/brutalizer`、`sfd/cloth-armor`、`sfd/combat-chef`、`sfd/cull`、`sfd/dorans-ring`、`sfd/dorans-shield`、`sfd/experimental-hexplate`、`sfd/eye-of-the-herald`、`sfd/fizz-trickster`、`sfd/forgefire-cape`、`sfd/gold`、`sfd/guardian-angel`、`sfd/hexdrinker`、`sfd/hextech-anomaly`、`sfd/last-rites`、`sfd/legion-quartermaster`、`sfd/rabadons-deathcrown`、`sfd/recurve-bow`、`sfd/rell-magnetic`、`sfd/sea-monkey`、`sfd/serrated-dirk`、`sfd/shurelyas-requiem`、`sfd/sivir-mercenary`、`sfd/skyfall-of-areion`、`sfd/spinning-axe`、`sfd/steraks-gage`、`sfd/svellsongur`、`sfd/the-zero-drive`、`sfd/trinity-force`、`sfd/world-atlas`、`sfd/zaun-punk`、`unl/blighted-battleaxe`、`unl/crescent-guardian`、`unl/existential-dread`、`unl/forgotten-signpost`、`unl/hextech-gauntlets`、`unl/hunters-machete`、`unl/khazix-evolving-hunter`、`unl/mister-root`、`unl/nilah-joyful-ascetic`、`unl/rengar-unseen`、`unl/rift-herald`、`unl/sacrifice`、`unl/sharkling`、`unl/shepherds-heirloom`、`unl/soul-sword`、`ven/ambessa-respected-and-feared`、`ven/baccai-sandspinner`、`ven/brutal-hunter`、`ven/butcher-of-the-sands`、`ven/covert-informant`、`ven/endless-riches`、`ven/frostcoat-mother`、`ven/gangplank-naval`、`ven/glowstone`、`ven/grumpy-rockbear`、`ven/hand-hammer`、`ven/heart-of-the-tempest`、`ven/helm-of-suppression`、`ven/hextech-disc`、`ven/iterative-design`、`ven/jagged-cutlass`、`ven/kayle-justified`、`ven/keeper-of-law`、`ven/kennen-storm-of-shuriken`、`ven/kharox`、`ven/kinkou-lifeblade`、`ven/master-of-shadows`、`ven/matriarch-of-war`、`ven/mystic-vortex`、`ven/noxian-emissary`、`ven/pendulum-blade`、`ven/profiteer`、`ven/questionable-tome`、`ven/rampage`、`ven/ravenbloom-prefect`、`ven/serene-ascetic`、`ven/shadow-fiend`、`ven/shadow-order-disciple`、`ven/shady-spectacles`、`ven/sky-crusier`、`ven/solari-sunhawk`、`ven/souls-reflection`、`ven/steel-paws`、`ven/tail-cloaked-matriarch`、`ven/wild-claw`、`ven/zed-from-the-shadows`。

### 14. EG-FILTERS — 运行期集合过滤的关系、特征和位置值谓词

受阻 **115** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：实现严格候选谓词：关系 Might/印刷 cost、damaged/buffed/keyword/empowered、相对玩家、LocationRef 值相等；动态查询按对象身份去重并保留 null。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/layers/filter.ts`；`packages/engine-core/src/effects/interpreter/selectors.ts`；`packages/engine-core/src/effects/filters/**`（建议新建）；`packages/engine-core/test/engine-gaps/filters.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/layers/filter.ts:46`：`return actual === expected;`。
- `packages/engine-core/src/layers/filter.ts:60`：`if (value.location !== undefined && value.location !== object.location &&`。
- CR v1.5：355.8, 206, 710；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：认 binder，golden 用真实绑定注册 arithmetic 图层修正），但条件的相对玩家与位置锚点在图层查询路径上不可求值：生产查询最终走 layers/filter.ts 的 matchesObjectFilter，controller 只做字面量比较（740.1.b 的 opponent 永不命中，条件 fail-closed、+2 永不生效），sameLocationAs 完全不被读取（去掉 controller 门槛后会过度作用到其它战场与友方单位，golden 用实测对照说明）；p。
- `sfd/reksai-breacher`（`packages/card-dsl/src/cards/sfd/reksai-breacher.ts:72`）：s hand」需要打出来源区域的谓词：ObjectFilter 只做类型/控制者/所有者/区域/状态/tags/characteristics 匹配（layers/filter.ts 的 matchesObjectFilter 明确不读 playedFromZoneNot），golden 里的该键只是描述性占位、无正式语义。(3) [Accelerate] 的费用接线：805.6/805.6.a 的「付费后以就绪进场替代横置进场」需要打出流程在 Finalize 选择并收取可选附加费用；cost ki。

**受阻卡（完整）**：`ogn/captain-farron`、`ogn/cithria-of-cloudfield`、`ogn/defy`、`ogn/dune-drake`、`ogn/guerilla-warfare-teemo`、`ogn/gust`、`ogn/kadregrin-the-infernal`、`ogn/kinkou-monk`、`ogn/lee-sin-centered`、`ogn/mushroom-pouch`、`ogn/raging-soul`、`ogn/ride-the-wind`、`ogn/spectral-matron`、`ogn/spirits-refuge`、`ogn/trifarian-war-camp`、`ogn/viktor-leader`、`ogn/void-gate`、`ogn/warwick-hunter`、`ogn/wielder-of-water`、`ogn/windswept-hillock`、`ogs/garen-commander`、`ogs/master-yi-meditative`、`ogs/wuju-bladesman-starter`、`rad/avalanche`、`rad/banner-of-conquest`、`rad/command-attack`、`rad/demon-shade`、`rad/heartening-soul`、`rad/hush`、`rad/invigorating-bloom`、`rad/jarvan-iv-martial-paragon`、`rad/overloaded-traveler`、`rad/party-crasher`、`rad/portable-portal`、`rad/steadfast-outrider`、`rad/the-ball`、`rad/trifarian-captain`、`sfd/blood-money`、`sfd/breakneck-mech`、`sfd/jaull-fish`、`sfd/marai-spire`、`sfd/not-so-fast`、`sfd/reksai-breacher`、`sfd/renata-glasc-mastermind`、`sfd/sea-monkey`、`sfd/show-of-strength`、`sfd/strike-down`、`sfd/windsinger`、`unl/alpha-wildclaw`、`unl/angler-beast`、`unl/baron-nashor`、`unl/black-flame-altar`、`unl/brush`、`unl/conscription`、`unl/crimson-pigeons`、`unl/forbidding-waste`、`unl/gardens-of-becoming`、`unl/petal-pixie`、`unl/pyke-returned`、`unl/repulse`、`unl/right-of-conquest`、`unl/sacrifice`、`unl/safety-inspector`、`unl/shadow`、`unl/soul-harvest`、`unl/stare-down`、`unl/starhound`、`unl/undying-loyalty`、`unl/vilemaw`、`unl/void-assault`、`unl/xerath-freed`、`ven/akali-deadly-weapon`、`ven/ambessa-respected-and-feared`、`ven/ambessa-the-wolf`、`ven/applied-researchers`、`ven/apprentice-mage`、`ven/aurok-general`、`ven/baccai-sandspinner`、`ven/baccai-witherclaw`、`ven/dame-the-despoiler`、`ven/decree-of-discord`、`ven/decree-of-focus`、`ven/decree-of-insight`、`ven/decree-of-rage`、`ven/decree-of-strength`、`ven/decree-of-unity`、`ven/defender-of-tomorrow`、`ven/disciple-of-shen`、`ven/escaped-grayback`、`ven/gangplank-naval`、`ven/guttural-roar`、`ven/helm-of-suppression`、`ven/hextech-disc`、`ven/hextech-formula`、`ven/kennen-keeper-of-balance`、`ven/kinkou-lifeblade`、`ven/kinkou-temple`、`ven/lacerate`、`ven/legion-marauder`、`ven/ocean-drake`、`ven/platewyrm-egg`、`ven/questionable-tome`、`ven/rage-amplifier`、`ven/rebuttal`、`ven/risen-altar`、`ven/rogue-assassin`、`ven/sanction`、`ven/shadow-assassin`、`ven/shadowblade-lurker`、`ven/shock-blast`、`ven/solari-sunhawk`、`ven/steel-paws`、`ven/tail-cloaked-matriarch`、`ven/tomb-raider-barbara`、`ven/tools-of-empire`。

### 15. EG-TARGETS — 非目标 PickSpec 查询与链接/嵌套选择生命周期

受阻 **107** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-FILTERS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：支持 filter 和 linked/zoneSlice 结果的受限候选来源；区分 Finalize 选择与结算期非目标 pick，保持顺序、秘密性、LKI 和失效重验；不得给集合添加 became-target。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/target/target-plan.ts`；`packages/engine-core/src/chain/picks/**`；`packages/engine-core/src/target/picks/**`（建议新建）；`packages/engine-core/test/engine-gaps/targets.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/chain/picks/plan.ts:20`：`['filter', 'min', 'max'].some(key => own(spec, key)) || own(spec, 'zoneSlice') === own(spec, 'linked')) {`。
- `packages/card-dsl/src/ir/types.ts:345`：`export interface PickSpec {`。
- CR v1.5：355.10.c, 355.10.d, 355.18；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `rad/firelights-hideout`（`packages/card-dsl/src/cards/rad/firelights-hideout.ts:64`）：he next unit you play」这个一次性窗口没有 IR 形状：ObjectSelector 只有 self/source/target/pick/linked，ObjectFilter 没有 greatest/last-created 量词，TargetSpec 按 CR 355.5 必须在 finalize 时锁定已经存在的对象（该单位本回合稍后才打出），Duration 只有 permanent/end-of-turn/end-of-combat/while-source-in-zone/until，没有。
- `ogn/lee-sin-ascetic`（`packages/card-dsl/src/cards/ogn/lee-sin-ascetic.ts:33`）：验证：:rb_exhaust: 的启动费用经 translateCost → buildCostPlan → payCostPlan 真实支付。依赖：非目标自身选择器、多 Buff 许可的声明/查询词汇统一与 Defender designation 条件派发；不能伪造自身目标、绕过 Buff 原语直接改计数，也不用 amount:N 近似无限 Buff。。

**受阻卡（完整）**：`ogn/acceptable-losses`、`ogn/adaptatron`、`ogn/albus-ferros`、`ogn/ava-achiever`、`ogn/baited-hook`、`ogn/blind-fury`、`ogn/brazen-buccaneer`、`ogn/cruel-patron`、`ogn/cull-the-weak`、`ogn/divine-judgment`、`ogn/fox-fire-ahri`、`ogn/garbage-grabber`、`ogn/kings-edict`、`ogn/lee-sin-ascetic`、`ogn/mindsplitter`、`ogn/miss-fortune-captain`、`ogn/promising-future`、`ogn/sabotage`、`ogn/shakedown`、`ogn/spirits-refuge`、`ogn/stand-united`、`ogn/super-mega-death-rocket-jinx`、`ogn/thermo-beam`、`ogn/trifarian-gloryseeker`、`ogn/unchecked-power`、`ogs/tibbers-annie`、`rad/amateur-demolitionist`、`rad/battlefield-armorer`、`rad/blade-of-the-exile`、`rad/command-attack`、`rad/drakehound-packmaster`、`rad/ekko-ingenious`、`rad/encore`、`rad/firelights-hideout`、`rad/hexplosive-minefield`、`rad/hexplosives-expert`、`rad/invigorating-bloom`、`rad/ki-burst`、`rad/life-from-stone`、`rad/mechanical-bandit`、`rad/mordekaiser-dominating`、`rad/mordekaiser-twice-slain`、`rad/scrutinizing-scope`、`rad/starry-eyed-songstress`、`rad/suave-negotiator`、`rad/the-empyrean`、`sfd/angle-shot`、`sfd/apprentice-smith`、`sfd/bellows-breath`、`sfd/blade-dancer`、`sfd/called-shot`、`sfd/card-sharp`、`sfd/downwell`、`sfd/emperors-divide`、`sfd/hall-of-legends`、`sfd/here-to-help`、`sfd/hextech-anomaly`、`sfd/legion-quartermaster`、`sfd/ornn-blacksmith`、`sfd/rell-magnetic`、`sfd/royal-entourage`、`sfd/rumble-hotheaded`、`sfd/strike-down`、`unl/abandoned-hall`、`unl/atakhan`、`unl/bewitching-spirit`、`unl/blast-cone`、`unl/bone-skewer`、`unl/call-to-battle`、`unl/cursed-sarcophagus`、`unl/double-trouble`、`unl/dusk-rose-lab`、`unl/fate-weaver`、`unl/forgotten-signpost`、`unl/gutter-palace`、`unl/heedless-resurrection`、`unl/insightful-investigator`、`unl/ivern-nurturer`、`unl/moonfall`、`unl/rift-herald`、`unl/safety-inspector`、`unl/shard-of-undoing`、`unl/skyward-strike`、`unl/stare-down`、`unl/the-academy`、`unl/the-ruination`、`unl/thrill-of-the-hunt`、`unl/tricksy-tentacles`、`unl/ultrasoft-poro`、`unl/valley-of-idols`、`unl/vex-apathetic`、`unl/vex-mocking`、`unl/walking-roost`、`ven/apprentice-mage`、`ven/bottled-constellation`、`ven/cataclysmic-duel`、`ven/decree-of-discord`、`ven/escaped-grayback`、`ven/jayce-brilliant-inventor`、`ven/kharox`、`ven/lightning-rush`、`ven/pakaa-protector`、`ven/ravenbloom-prefect`、`ven/sky-crusier`、`ven/swain-visionary`、`ven/wild-claw`、`ven/zed-from-the-shadows`。

### 16. EG-EVENTS — 触发事件闭集、时点别名与 once 词汇对齐

受阻 **105** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 优先复用现有 IR。

**实现与验收**：把已存在生产者和有规则来源的新事件追加到词表；明确时点与事件别名，加入批次 once 范围及严格校验；绝不只放宽枚举。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/events/trigger-spec.ts`；`packages/engine-core/src/events/timing-points.ts`；`packages/engine-core/test/engine-gaps/events.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/events/trigger-spec.ts:71`：`export const EVENT_PATTERN_TYPES = [`。
- `packages/engine-core/src/events/trigger-spec.ts:3`：`export const TRIGGER_ONCE_SCOPES = [`。
- `/root/swarm-rift/logs/gate-51cd2b97.log:43318`：`error: 'trigger.filter.event: 值必须属于 zone-entered, zone-left, object-entered-zone, object-left-zone, card-played, object-targeted, became-target, object-killed, object-readied, object-exhausted, attack-declared, defense-declared, combat-damage-before, combat-damage-after, showdown-opened, showdown-closed, combat-ended, chain-item-pending, chain-item-finalized, chain-item-resolved, control-established, control-lost, conquered, held, scored, final-point。'`。
- CR v1.5：383.1, 383.3.e；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：o layer mapping"），也没有资源产出加成的持续效果形状。复核记录：hold 时点的订阅词汇是 "held"（TriggerSpec 的 EVENT_PATTERN_TYPES 只接受 held，events/pipeline-match.ts 的 EVENT_NAMES 把 hold 映射为 held），本卡已按该词汇声明并通过生产注册路径的校验。依赖：触发能力的费用字段/提取接线、modify-resource-ability 图层读者，以及 legend-zone、Victory Score 读。
- `sfd/seat-of-power`（`packages/card-dsl/src/cards/sfd/seat-of-power.ts:61`）：iming-point-producers.md) and the printed discriminant now uses the closed EVENT_PATTERN_TYPES value "conquered" (events/pipeline-match.ts maps it onto conquer), but the printed ability (383.4.c / 473.2.a) still cannot run end to end, and nothing is approxima。

**受阻卡（完整）**：`ogn/back-alley-bar`、`ogn/crackshot-corsair`、`ogn/dazzling-aurora`、`ogn/dr-mundo-expert`、`ogn/jinx-rebel`、`ogn/kaisa-evolutionary`、`ogn/karma-channeler`、`ogn/last-stand`、`ogn/loose-cannon`、`ogn/miss-fortune-captain`、`ogn/mistfall`、`ogn/mushroom-pouch`、`ogn/nocturne-horrifying`、`ogn/noxian-drummer`、`ogn/radiant-dawn`、`ogn/sona-harmonious`、`ogn/sprite`、`ogn/sprite-call`、`ogn/sprite-mother`、`ogn/stealthy-pursuer`、`ogn/the-arenas-greatest`、`ogn/volibear-imposing`、`ogn/yasuo-windrider`、`ogn/zaun-warrens`、`ogs/dark-child-starter`、`rad/ahri-confident`、`rad/akali-brash`、`rad/aphelios-exalted`、`rad/bandle-scouts-academy`、`rad/banner-of-conquest`、`rad/blossoming-dreamroot`、`rad/coalesced-energy`、`rad/demacian-illuminators`、`rad/lulu-whimsical`、`rad/mechanical-bandit`、`rad/momentary-companion`、`rad/raving-witness`、`rad/resource-extractor`、`rad/sneaky-zeebles`、`sfd/apprentice-smith`、`sfd/battle-mistress`、`sfd/blade-dancer`、`sfd/chem-baroness`、`sfd/corinna-veraza`、`sfd/corrupt-enforcer`、`sfd/draven-audacious`、`sfd/fae-dragon`、`sfd/fae-porter`、`sfd/glorious-executioner`、`sfd/guardian-of-the-passage`、`sfd/harpoon-squad`、`sfd/jax-unrelenting`、`sfd/kato-the-arm`、`sfd/prize-of-progress`、`sfd/ribbon-dancer`、`sfd/seat-of-power`、`sfd/simian-ancestor`、`sfd/spinning-axe`、`sfd/stellacorn-herder`、`sfd/treasure-hunter`、`unl/ashe-focused`、`unl/crowd-favorite`、`unl/dusk-rose-lab`、`unl/frozen-fortress`、`unl/gloomist`、`unl/green-father`、`unl/gustwalker`、`unl/hwei-brooding-painter`、`unl/imposing-challenger`、`unl/irresistible-faefolk`、`unl/jhin-murderous-artist`、`unl/katarina-reckless`、`unl/keeper-of-masks`、`unl/khazix-evolving-hunter`、`unl/khazix-mutating-horror`、`unl/leblanc-everywhere-at-once`、`unl/lillia-fae-fawn`、`unl/mageseeker-investigator`、`unl/master-yi-tempered`、`unl/mister-root`、`unl/nidalee-cat-form`、`unl/nilah-joyful-ascetic`、`unl/piltover-enforcer`、`unl/rippers-bay`、`unl/sumpworks-map`、`unl/trevor-snoozebottom`、`unl/turn-to-dust`、`unl/voidreaver`、`unl/voracious-gromp`、`unl/wuju-apprentice`、`ven/akali-silent`、`ven/bottled-constellation`、`ven/eclipse-dragon`、`ven/forsaken-baccai`、`ven/illaoi-prophet-of-the-great-kraken`、`ven/kharox`、`ven/master-of-shadows`、`ven/matriarch-of-war`、`ven/mel-defiant-soul`、`ven/minah-swiftfoot`、`ven/pakaa-protector`、`ven/renekton-brute`、`ven/shadow-order-disciple`、`ven/souls-reflection`、`ven/swain-visionary`。

### 17. EG-TURN — 回合清理、计分限制/阈值、Burn Out 与额外回合

受阻 **92** 张；**B5 / XL**（6–10 工程日）；deps：EG-CONTRACT, EG-RULES, EG-RECALL, EG-HIDDEN, EG-COMBAT。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：计分/获胜门槛及禁止有真实消费方；清理 Stun/Recall/Hidden、Rune Pool empty、Burn Out 与额外回合使用真实规则任务，保留每战场计分账本。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/turn/flow.ts`；`packages/engine-core/src/turn/phase-layers.ts`；`packages/engine-core/src/turn/tasks/**`（建议新建）；`packages/engine-core/src/scoring/**`；`packages/engine-core/src/effects/instructions/effect.additional-turn.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.score.ts`；`packages/engine-core/src/effects/instructions/effect.win.ts`；`packages/engine-core/test/engine-gaps/turn.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/turn/flow.ts:253`：`if (this.options.player(player).deckCount === 0) throw new TurnCombatBlockedError('burn-out', 'Burn Out needs an atomic rules task with repeated unreplaceable point gains (CR 432)');`。
- `packages/engine-core/src/turn/flow.ts:258`：`throw new TurnCombatBlockedError('empty-rune-pool', 'GameAction has no Rune Pool empty operation (CR 316.3 / 317.2.d)');`。
- `packages/engine-core/src/turn/flow.ts:73`：`throw new TurnCombatBlockedError('replaced-scoring', 'Structural Score replacement requires a rules-task contract');`。
- CR v1.5：317.2.d, 432, 473；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）： mapping")），封闭 GameAction 集合没有 hide，ZoneId/ObjectSnapshot 没有 Facedown Zone，turn/flow.ts 的清理对 faceDown 对象抛 TurnCombatBlockedError("hidden-cleanup-state")。(2) 740.4.a.2 要求「you may pay :rb_energy_2:」作为触发前置费用在 Finalize 支付，但冻结的 TriggeredAbility 没有 cost 字。
- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）： 没有 team/ally 读法（实测），无法把队友的 Hold 与自己的 Hold 合并判定；（5）「within 3 points of the Victory Score」需要当前 Victory Score（194.3/194.3.a，默认可被游戏模式改），ResolveContext 只暴露各自 score、没有 victoryScore，硬编码 8 就是臆造；（6）「your Gold [Add] an additional :rb_energy_1:」是改写 [Add] 产出的条件持续效。

**受阻卡（完整）**：`ogn/adaptatron`、`ogn/ahri-alluring`、`ogn/altar-to-unity`、`ogn/aspirants-climb`、`ogn/blitzcrank-impassive`、`ogn/find-your-center`、`ogn/leona-zealot`、`ogn/monastery-of-hirana`、`ogn/mushroom-pouch`、`ogn/navori-fighting-pit`、`ogn/noxian-drummer`、`ogn/possession`、`ogn/qiyana-victorious`、`ogn/sigil-of-the-storm`、`ogn/sprite`、`ogn/startipped-peak`、`ogn/the-arenas-greatest`、`ogn/time-warp`、`ogn/yasuo-windrider`、`ogn/zaun-warrens`、`ogs/dark-child-starter`、`ogs/might-of-demacia-starter`、`rad/banner-of-conquest`、`rad/cosmic-vista`、`rad/firebrand-raider`、`rad/firelights-hideout`、`rad/gravity-field`、`rad/ksante-courageous`、`rad/pillaged-armory`、`rad/ruined-monastery`、`rad/sneaky-zeebles`、`rad/the-good-stuff`、`rad/ziggs-explosive`、`sfd/chem-baroness`、`sfd/draven-audacious`、`sfd/dunebreaker`、`sfd/eminent-benefactor`、`sfd/forgotten-monument`、`sfd/guardian-of-the-passage`、`sfd/hall-of-legends`、`sfd/hostile-takeover`、`sfd/lucian-merciless`、`sfd/minefield`、`sfd/ornn-blacksmith`、`sfd/petricite-monument`、`sfd/plundering-poro`、`sfd/power-nexus`、`sfd/rumble-hotheaded`、`sfd/rumble-scrapper`、`sfd/sivir-ambitious`、`sfd/stellacorn-herder`、`sfd/tianna-crownguard`、`sfd/veiled-temple`、`sfd/windsinger`、`unl/amateur-recital`、`unl/arachnoid-horror`、`unl/back-off`、`unl/blue-sentinel`、`unl/brush`、`unl/crimson-pigeons`、`unl/crowd-favorite`、`unl/enthusiastic-promoter`、`unl/gemhand-hunter`、`unl/green-father`、`unl/gustwalker`、`unl/herald-of-spring`、`unl/iascylla`、`unl/inviolus-vox`、`unl/khazix-evolving-hunter`、`unl/poppy-paragon`、`unl/red-brambleback`、`unl/scorchclaw`、`unl/the-academy`、`unl/trapping-grounds`、`unl/trevor-snoozebottom`、`unl/vilemaw`、`unl/yeti-brawler`、`ven/corrupted-dragon`、`ven/kennen-keeper-of-balance`、`ven/kennen-storm-of-shuriken`、`ven/nasus-ascended`、`ven/ol-poro`、`ven/otterpus`、`ven/protective-sands`、`ven/renekton-brute`、`ven/sandstone-chimera`、`ven/serene-ascetic`、`ven/shadow-fiend`、`ven/shen-leader-of-the-kinkou-order`、`ven/shen-scourge-of-shadows`、`ven/swain-visionary`、`ven/zed-without-a-sound`。

### 18. EG-TOKEN — Token 定义、状态/落点与真实 Play 入口

受阻 **80** 张；**B5 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-LOCATIONS, EG-PLAY。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：补有来源的 token 定义和真实类型/traits/费用/关键词、入场状态、可选落点、批次创建后分别 Play；Gold 不套用单位入场；无印刷值保留 null。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.token.ts`；`packages/engine-core/src/effects/tokens/**`（建议新建）；`packages/engine-core/test/engine-gaps/token.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.token.ts:27`：`* cannot substitute for entering exhausted. Entry overrides are not supported.`。
- `packages/engine-core/src/effects/instructions/effect.token.ts:63`：`const DEFINITIONS = new Map<string, TokenSpec>([`。
- CR v1.5：187.5, 185.2.a, 440.2.c；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：按 2026-10-18 源码逐条复核，仍缺六项，均不近似实现。（1）Gold token 定义缺失：187.5 的 Gold 是带自身能力的 gear token（"[Reaction][>] Kill this, [E]: [Add] [A]."），effect.token 的冻结定义表按设计保持 blocked/judge-required，表内只有 recruit/sand-soldier/mech/refl。
- `unl/trevor-snoozebottom`（`packages/card-dsl/src/cards/unl/trevor-snoozebottom.ts:102`）：当前缺口（CR v1.5，2026-10-17 实测），均不近似实现：(1) 缺 187.2 的 3 [M] Sprite unit token 定义——它是域外单位 token、3 Might、Fae 标签、带 [Temporary]，而已合入 effect.token 的冻结定义表只含没有额外能力的 recruit/sand-soldier/mech/reflection/tentacle，复核实测该指令对 sprite 返回 negated 。

**受阻卡（完整）**：`ogn/herald-of-the-arcane`、`ogn/machine-evangel`、`ogn/sprite`、`ogn/sprite-call`、`ogn/sprite-mother`、`ogn/vanguard-captain`、`ogs/recruit-the-vanguard`、`rad/amateur-demolitionist`、`rad/an-offer-you-cant-refuse`、`rad/antagonistic-apparatus`、`rad/bandle-scouts-academy`、`rad/black-rose-sanctum`、`rad/encore`、`rad/heimerdinger-academy-instructor`、`rad/hexplosive-minefield`、`rad/hexplosives-expert`、`rad/hunting-dog`、`rad/reckless-innovator`、`rad/resource-extractor`、`rad/rousing-display`、`rad/satchel-charge`、`rad/the-waters-wage`、`rad/ziggs-explosive`、`rad/ziggs-short-fused`、`sfd/arise`、`sfd/battle-mistress`、`sfd/black-market-broker`、`sfd/blood-money`、`sfd/breakneck-mech`、`sfd/bushwhack`、`sfd/card-sharp`、`sfd/chem-baroness`、`sfd/chemtech-cask`、`sfd/corinna-veraza`、`sfd/deserts-call`、`sfd/draven-vanquisher`、`sfd/eminent-benefactor`、`sfd/fae-dragon`、`sfd/ferrous-forerunner`、`sfd/forecaster`、`sfd/gold`、`sfd/honest-broker`、`sfd/pickpocket`、`sfd/plundering-poro`、`sfd/renata-glasc-industrialist`、`sfd/rumble-hotheaded`、`sfd/rumble-scrapper`、`sfd/treasure-hoard`、`sfd/treasure-hunter`、`sfd/trove-golem`、`sfd/wages-of-pain`、`unl/baron-nashor`、`unl/bashful-bloom`、`unl/bloodharbor-ripper`、`unl/brush`、`unl/carrion-dredger`、`unl/deadly-flourish`、`unl/flurry-of-feathers`、`unl/frisky-hunter`、`unl/green-father`、`unl/gutter-palace`、`unl/keeper-of-masks`、`unl/lillia-fae-fawn`、`unl/mirror-image`、`unl/pyke-returned`、`unl/sprite-burst`、`unl/sprite-fountain`、`unl/sprite-queen`、`unl/trapping-grounds`、`unl/trevor-snoozebottom`、`unl/ultrasoft-poro`、`unl/walking-roost`、`unl/yeti-brawler`、`ven/death-mark`、`ven/hextech-disc`、`ven/iterative-design`、`ven/noxian-emissary`、`ven/up-from-the-deep`、`ven/zed-from-the-shadows`、`ven/zed-without-a-sound`。

### 19. EG-REPLACEMENT — 替代体规划、入口选择器与未支持 opcode

受阻 **79** 张；**B4 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-TARGETS, EG-COSTCHOICE。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：对齐 constant instead、replacement.object 和 condition；有规则地规划 banish/kill/inspect/token/optional/cost 等动作，补费用替代暴露；绝不执行后冒充替代。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/replacement/**`；`packages/engine-core/src/effects/instructions/replacement.enter.ts`；`packages/engine-core/src/effects/instructions/replacement.event.ts`；`packages/engine-core/src/effects/instructions/replacement.prevent.ts`；`packages/engine-core/src/effects/instructions/replacement.damage-multiplier.ts`（建议新建）；`packages/engine-core/src/effects/instructions/replacement.play-with-additional-copy.ts`（建议新建）；`packages/engine-core/test/engine-gaps/replacement.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/replacement/planner.ts:197`：`throw new BlockedReplacementError("Unsupported replacement opcode: " + instruction.op);`。
- `packages/engine-core/src/replacement/bind.ts:182`：`const value = evaluateConstant(boundSnapshot, target as unknown as Expr, "entry body target", candidate =>`。
- `/root/swarm-rift/logs/gate-51cd2b97.log:42002`：`error: 'Unsupported replacement opcode: effect.banish'`。
- CR v1.5：369.3, 370.1, 372.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：ma 对 entersExhausted 抛 TypeError，事后补 effect.exhaust 不等价（会多产生一次「成为横置」事件并错过入场替代）；（3）费用式「exhaust me」（383.3.b/383.3.b.1/415.4/415.5）缺触发点的 Finalize 绑定与 legend-zone 表达：正文已按已合入的可支付形状声明该费用（cost.modify 锁定 { kind: "activated", payments: [{ kind: "exhaust", ob。
- `ogn/nocturne-horrifying`（`packages/card-dsl/src/cards/ogn/nocturne-horrifying.ts:121`）：lay（effect.play 只接受调用方给的 finalized plan）。(5) replacement/ 的通用事件拦截与注册面已合入，但 replacement/pattern.ts 的 ACTION_KINDS 是封闭映射（只含 move-zone/kill/ready/exhaust/damage/score/play/reveal），没有 look 动作，370.1.c.1 的同刻生效语义仍缺。依赖：look 事件的注册词汇与 object 载荷、秘密区域打出许可、CardProgram→Fin。

**受阻卡（完整）**：`ogn/confront`、`ogn/immortal-phoenix`、`ogn/magma-wurm`、`ogn/nocturne-horrifying`、`ogn/noxian-guillotine-darius`、`ogn/sun-disc`、`ogn/swift-scout`、`ogn/symbol-of-the-solari`、`ogn/tasty-faefolk`、`ogn/the-boss`、`ogn/unlicensed-armory`、`ogn/unyielding-spirit`、`ogn/vayne-hunter`、`ogn/zhonyas-hourglass`、`ogs/highlander-yi`、`rad/disposal-expert`、`rad/entrenched-boar`、`rad/firebrand-raider`、`rad/heimerdinger-academy-instructor`、`rad/ksante-courageous`、`rad/lingering-animus`、`rad/mordekaiser-twice-slain`、`sfd/breakneck-mech`、`sfd/bushwhack`、`sfd/chem-baroness`、`sfd/counter-strike`、`sfd/direwing`、`sfd/downwell`、`sfd/dunebreaker`、`sfd/forgotten-monument`、`sfd/gearhead`、`sfd/rally-the-troops`、`sfd/renata-glasc-industrialist`、`sfd/soraka-wanderer`、`sfd/void-hatchling`、`sfd/xin-zhao-vigilant`、`unl/altar-of-blood`、`unl/bandle-soldier`、`unl/baron-nashor`、`unl/bashful-bloom`、`unl/blood-rose`、`unl/crescent-guardian`、`unl/jhin-meticulous-killer`、`unl/leblanc-fragmented`、`unl/lotus-trap`、`unl/monch`、`unl/scorchclaw`、`unl/shadow`、`unl/shadow-watcher`、`unl/smite`、`unl/tactical-retreat`、`unl/towering-pairofant`、`unl/undying-legion`、`unl/wuju-master`、`unl/xerath-freed`、`unl/zilean-time-mage`、`ven/brittle-steel`、`ven/corrupted-dragon`、`ven/covert-informant`、`ven/death-mark`、`ven/endless-riches`、`ven/esteemed-hierophant`、`ven/gangplank-naval`、`ven/iterative-design`、`ven/kennen-storm-of-shuriken`、`ven/ki-barrier`、`ven/onslaught`、`ven/otterpus`、`ven/perfect-execution`、`ven/profiteer`、`ven/public-execution`、`ven/questionable-tome`、`ven/renekton-rage-fueled`、`ven/ruthless-strike`、`ven/shadow-assassin`、`ven/shadow-dash`、`ven/twilight-shroud`、`ven/twilight-step`、`ven/up-from-the-deep`。

### 20. EG-LIFECYCLE — 死亡前收集、离区 LKI 与跨区能力注册生命周期

受阻 **78** 张；**B5 / L**（3–5 工程日）；deps：EG-EVENTS, EG-PAYLOAD, EG-TRIGGERS, EG-LEAVE, EG-STATIC, EG-GRANTS。 优先复用现有 IR。

**实现与验收**：Kill 的 Deathknell 在进 Trash 前 Pending 入链，替代死亡撤回；保留来源 LKI，解绑不能先于该波触发收集；按规则定义秘密区活动范围。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/lifecycle.ts`；`packages/engine-core/test/engine-gaps/lifecycle.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/programs/lifecycle.ts:67`：`const leavesBoard = emission.timingPoint === 'object-leaves-board' || emission.timingPoint === 'object-killed';`。
- CR v1.5：808.1.d.1, 808.1.d.2, 808.1.d.3；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：Might 已可执行：执行侧 continuous.might 与 programs/statics.ts 的 bindStaticToLayers/attachProgramLifecycle 都已合入，golden 经图层求值实测得到 4 → 6，且 buffs 仍为 0（不写成 Buff）。(3) 条件性 [Ganking] 的产出侧已合入但生产未装配：continuous.grant-keyword 原语、ability 图层关键词写入，以及 RIFT-710 的 programs/keyword-grants。
- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：.d 的面朝下打出（含战场限定）与 811.6 的下一回合 Reaction 许可仍无执行路径：展开出的静态半段在生产绑定上 fail-closed（attachProgramLifecycle 的默认 createEngineStaticBinder 抛 ProgramBindingError(judge-required, "Static ability kind cost.hidden has no layer mapping")），封闭 GameAction 集合没有 hide，ZoneId/ObjectSna。

**受阻卡（完整）**：`ogn/ekko-recurrent`、`ogn/fading-memories`、`ogn/flame-chompers`、`ogn/karthus-eternal`、`ogn/kogmaw-caustic`、`ogn/machine-evangel`、`ogn/qiyana-victorious`、`ogn/raging-soul`、`ogn/soaring-scout`、`ogn/spirits-refuge`、`ogn/sprite`、`ogn/sprite-call`、`ogn/tasty-faefolk`、`ogn/treasure-trove`、`ogn/udyr-wildman`、`ogn/undercover-agent`、`ogn/vanguard-helm`、`ogn/viktor-leader`、`ogn/watchful-sentry`、`ogn/windswept-hillock`、`ogn/zhonyas-hourglass`、`ogs/might-of-demacia-starter`、`rad/amateur-demolitionist`、`rad/clanging-sentry`、`rad/clocktower-guardian`、`rad/consult-the-heavens`、`rad/demon-shade`、`rad/detonation-amplifier`、`rad/for-demacia`、`rad/gravity-field`、`rad/hexplosive-minefield`、`rad/hexplosives-expert`、`rad/hunting-dog`、`rad/jarvan-iv-martial-paragon`、`rad/meticulous-restorationist`、`rad/momentary-companion`、`rad/mournful-spirit`、`rad/ntofo-strikes`、`rad/satchel-charge`、`rad/storm-raptor`、`rad/the-ball`、`rad/ziggs-explosive`、`rad/ziggs-short-fused`、`sfd/cloth-armor`、`sfd/ferrous-forerunner`、`sfd/glasc-mixologist`、`sfd/honest-broker`、`sfd/lonely-poro`、`sfd/reksai-breacher`、`sfd/sivir-mercenary`、`sfd/the-zero-drive`、`sfd/undertitan`、`unl/allay-eager-admirer`、`unl/ashe-focused`、`unl/baron-pit`、`unl/black-flame-altar`、`unl/black-rose-dignitary`、`unl/carrion-dredger`、`unl/deceiver`、`unl/dramatic-visionary`、`unl/leblanc-fragmented`、`unl/loyal-poro`、`unl/master-yi-tempered`、`unl/revna-the-lorekeeper`、`unl/rift-herald`、`unl/ruined-rex`、`unl/scuttle-crab`、`unl/shadows-call`、`unl/sprite-fountain`、`unl/towering-combatant`、`unl/towering-pairofant`、`ven/akali-silent`、`ven/ambessa-respected-and-feared`、`ven/brutal-hunter`、`ven/kennen-keeper-of-balance`、`ven/nasus-guardian-of-knowledge`、`ven/noxian-emissary`、`ven/perfect-execution`。

### 21. EG-LOCATIONS — LocationExpr/Ref 到动态合法目的地的绑定

受阻 **78** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 优先复用现有 IR。

**实现与验收**：支持能力控制者基地、当前目标当前位置/排除当前位置、战场集合与权限查询；只读选择器不再误当运行时 PlayerId；保持位置身份与入区身份。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/target/location/**`；`packages/engine-core/src/effects/interpreter/locations.ts`；`packages/engine-core/test/engine-gaps/locations.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/target/location/candidates.ts:3`：`import { sameLocation, locationKey } from "./ref.js";`。
- `packages/engine-core/src/effects/interpreter/locations.ts:54`：`* Adapt an effect.move argument object at the interpreter boundary. The`。
- CR v1.5：355.4, 449.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `rad/ziggs-explosive`（`packages/card-dsl/src/cards/rad/ziggs-explosive.ts:165`）：ossible, blockedReason "token-definition-or-abilities-judge-required")。(2) LocationExpr 选择器虽已能解析当前战场，但 effect.token 的解释器分发仍把已求值参数交给只接受 Expr 的冻结 argsSchema（实测拒绝 { kind: "location", ... }：Invalid effect.token argument: location），动态地点尚未接到 token 原语，执行边界仍需要。
- `rad/demon-shade`（`packages/card-dsl/src/cards/rad/demon-shade.ts:73`）：（Expr kind "location"，170.11.c 的 open 过滤 { type: battlefield, open: true }，355.4 / 355.4.a / 451.1），但候选来源仍未接线：target/location/candidates.ts 的 allRefs 只从对象当前地点、玩家 Base 与调用方传入的 LocationState 收集候选，合并的调用方（interpreter.ts prepareLocations / normalizeM。

**受阻卡（完整）**：`ogn/ahri-inquisitive`、`ogn/baited-hook`、`ogn/captain-farron`、`ogn/charm`、`ogn/herald-of-the-arcane`、`ogn/machine-evangel`、`ogn/mageseeker-warden`、`ogn/monastery-of-hirana`、`ogn/navori-fighting-pit`、`ogn/ride-the-wind`、`ogn/sprite-mother`、`ogn/stormbringer-volibear`、`ogn/trifarian-war-camp`、`ogn/void-gate`、`ogn/windswept-hillock`、`ogn/yasuo-remorseful`、`ogn/zenith-blade-leona`、`ogs/garen-commander`、`ogs/recruit-the-vanguard`、`rad/bedeviling-stranger`、`rad/command-attack`、`rad/demon-shade`、`rad/encore`、`rad/exemplar-of-demacia`、`rad/heimerdinger-academy-instructor`、`rad/hexplosive-minefield`、`rad/hexplosives-expert`、`rad/portable-portal`、`rad/resource-extractor`、`rad/satchel-charge`、`rad/sirens-song`、`rad/starry-eyed-songstress`、`rad/transpositionist`、`rad/ziggs-explosive`、`rad/ziggs-short-fused`、`sfd/arise`、`sfd/draven-vanquisher`、`sfd/eminent-benefactor`、`sfd/emperors-divide`、`sfd/ferrous-forerunner`、`sfd/janna-savior`、`sfd/loyal-pup`、`sfd/relentless-pursuit`、`sfd/temptation`、`sfd/treasure-hunter`、`sfd/trove-golem`、`sfd/vanguard-armory`、`unl/baron-nashor`、`unl/bashful-bloom`、`unl/black-flame-altar`、`unl/blast-cone`、`unl/call-to-battle`、`unl/flurry-of-feathers`、`unl/forgotten-signpost`、`unl/gutter-palace`、`unl/heroic-charge`、`unl/imposing-challenger`、`unl/isolate`、`unl/maduli-the-gatekeeper`、`unl/moonfall`、`unl/pyke-returned`、`unl/skyward-strike`、`unl/sprite-queen`、`unl/stare-down`、`unl/thrill-of-the-hunt`、`unl/tricksy-tentacles`、`unl/ultrasoft-poro`、`unl/vex-mocking`、`unl/void-assault`、`unl/xerath-freed`、`unl/yeti-brawler`、`ven/akali-deadly-weapon`、`ven/ocean-drake`、`ven/risen-altar`、`ven/shadow-dash`、`ven/twilight-step`、`ven/up-from-the-deep`、`ven/zed-without-a-sound`。

### 22. EG-PERMISSIONS — 跨区/延后 Play 许可与激活位置合法性

受阻 **74** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-LOCATIONS, EG-RULES。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：把已登记位置/区域许可应用到当前候选与 Finalize；open/occupied/控制者范围、指定对象跨区许可及下次 Ending 到期均严格。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/play-permissions.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.play-permission.ts`（建议新建）；`packages/engine-core/src/effects/instructions/continuous.location.ts`；`packages/engine-core/test/engine-gaps/permissions.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/chain/engine.ts:315`：`if (!this.playDestinationIsLegal(item)) throw new Error('Play destination is not legally allowed');`。
- `packages/engine-core/src/layers/rules/query.ts:333`：`export function playLocations(`。
- CR v1.5：355.2, 420.3.b.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `rad/ziggs-explosive`（`packages/card-dsl/src/cards/rad/ziggs-explosive.ts:165`）： LocationRef。(3) Deploy（830.1）与 Deathknell（808）的关键词展开仍缺消费方：Deploy 的 static continuous.location 在生产静态绑定即被拒绝（实测 judge-required: Static ability kind continuous.location has no layer mapping）、Finalize 目的地校验与 Deploy hold 触发的注册/地点过滤尚未接通（实测 { event: "hold", here: tr。
- `ogn/nocturne-horrifying`（`packages/card-dsl/src/cards/ogn/nocturne-horrifying.ts:121`）：d: "self" 虽能被 translateTriggerFilter 绑定为注册源对象，但事件端没有对象可比。(4) 从被查看的牌库顶（秘密区域）打出卡牌的许可与位置校验没有生产来源（420.3.b / 355.2）；chain/interpreter-adapter 的 LITERAL_FIELDS 也未解包 cost.modify 的 id/cost/linkKey，按 CardProgram 运行实测在 “cost.modify id must be a non-empty strin。

**受阻卡（完整）**：`ogn/deadbloom-predator`、`ogn/fox-fire-ahri`、`ogn/mageseeker-warden`、`ogn/miss-fortune-buccaneer`、`ogn/nocturne-horrifying`、`ogn/sai-scout`、`ogn/shen-kinkou`、`ogn/sneaky-deckhand`、`ogn/sprite-call`、`ogn/teemo-scout`、`ogs/recruit-the-vanguard`、`rad/akali-brash`、`rad/banner-of-conquest`、`rad/blossoming-dreamroot`、`rad/concert-poster`、`rad/demacian-standard`、`rad/demon-shade`、`rad/detonation-amplifier`、`rad/dockside-lock-up`、`rad/evelynn-consuming`、`rad/gravity-field`、`rad/jarvan-iv-martial-paragon`、`rad/last-caress`、`rad/pillaged-armory`、`rad/portable-portal`、`rad/resource-extractor`、`rad/runeblade-anvil`、`rad/the-ball`、`rad/the-good-stuff`、`rad/transpositionist`、`rad/ziggs-explosive`、`rad/ziggs-short-fused`、`sfd/bushwhack`、`sfd/corinna-veraza`、`sfd/edge-of-night`、`sfd/guards`、`sfd/jayce-man-of-progress`、`sfd/rengar-pouncing`、`sfd/rockfall-path`、`sfd/sudden-storm`、`unl/arachnoid-horror`、`unl/back-off`、`unl/chakram-dancer`、`unl/diana-no-longer-human`、`unl/grim-apothecary`、`unl/inferna`、`unl/jhin-meticulous-killer`、`unl/lord-broadmane`、`unl/maduli-the-gatekeeper`、`unl/nidalee-cat-form`、`unl/poppy-defender-of-the-meek`、`unl/pyke-dockside-butcher`、`unl/rengar-trophy-hunter`、`unl/ultrasoft-poro`、`unl/vi-peacekeeper`、`unl/vilemaw`、`ven/brittle-steel`、`ven/dragon-form`、`ven/dragon-roost`、`ven/dredge-up`、`ven/endless-riches`、`ven/iterative-design`、`ven/lacerate`、`ven/lightning-rush`、`ven/morgana-vindictive`、`ven/ocean-drake`、`ven/onslaught`、`ven/public-execution`、`ven/shadow-dash`、`ven/soulspinner`、`ven/spiderling`、`ven/temporal-breach`、`ven/tornado-warrior`、`ven/up-from-the-deep`。

### 23. EG-CHOICEPLAN — Finalize 模式规划、嵌套目标与跨启动模式记忆

受阻 **69** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-TARGETS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：355.3 在 Finalize 决定模式并只锁所选分支目标；支持 optional/repeat 的目标生命周期，跨启动每回合模式记忆可回放且回合重置。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/chain/finalize/choices.ts`（建议新建）；`packages/engine-core/src/chain/finalize/choice-memory.ts`（建议新建）；`packages/engine-core/test/engine-gaps/choiceplan.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/chain/engine.ts:507`：`if (instruction.op === 'choice.mode') throw new ChainContractBlockedError('Mode choices require a Finalize/Resolve choice-plan adapter');`。
- `packages/engine-core/src/chain/engine.ts:506`：`if (nested && instruction.targets?.length) throw new ChainContractBlockedError('Nested/repeated targets require an interpreter target-selection lifecycle adapter');`。
- CR v1.5：355.3, 355.5.b；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：AtFinalize；两条触发的 TargetSpec 又嵌在 choice.optional 的 body 内，chain/engine.ts 的 assertFinalizationSurface 以 "Nested/repeated targets require an interpreter target-selection lifecycle adapter" 阻断 Finalize（golden 用真实 ChainEngine 复现该拒绝），触发连入链都到不了结算。cost.pay 本体已合入并在解释器结算期真实。
- `rad/demon-shade`（`packages/card-dsl/src/cards/rad/demon-shade.ts:73`）：n choose one" 要求先选单位再选模式（355.5 在 355.3 之前）；RIFT-358 已合入有序 zone pick 与链接值，但 choice.mode 本身仍不可结算——实测 programs/play.ts 的 describePlay 与 chain/engine.ts 的 assertFinalizationSurface 都抛 "Mode choices require a Finalize/Resolve choice-plan adapter"，本卡连 play 。

**受阻卡（完整）**：`ogn/blitzcrank-impassive`、`ogn/flame-chompers`、`ogn/leona-determined`、`ogn/mistfall`、`ogn/navori-fighting-pit`、`ogn/overt-operation`、`ogn/party-favors`、`ogn/qiyana-victorious`、`ogn/reavers-row`、`ogn/sett-brawler`、`ogn/shakedown`、`ogn/soulgorger`、`ogn/spectral-matron`、`ogn/tideturner`、`ogn/twisted-fate-gambler`、`ogn/udyr-wildman`、`ogn/vayne-hunter`、`rad/aphelios-exalted`、`rad/avalanche`、`rad/command-attack`、`rad/demacian-standard`、`rad/demon-shade`、`rad/encore`、`rad/kaisa-rebel`、`rad/ksante-dauntless`、`rad/last-caress`、`rad/lost-to-the-sands`、`rad/reckless-innovator`、`rad/riven-broken-blade`、`rad/rousing-display`、`rad/scrutinizing-scope`、`rad/the-ball`、`rad/the-waters-wage`、`sfd/angle-shot`、`sfd/azir-sovereign`、`sfd/blade-dancer`、`sfd/buhru-captain`、`sfd/card-sharp`、`sfd/fae-porter`、`sfd/hard-bargain`、`sfd/lucian-gunslinger`、`sfd/overzealous-fan`、`sfd/relentless-pursuit`、`sfd/rocket-barrage`、`sfd/royal-entourage`、`sfd/strike-down`、`unl/curtain-call`、`unl/death-from-below`、`unl/deceiver`、`unl/disposal-order`、`unl/flurry-of-feathers`、`unl/forgotten-library`、`unl/heroic-charge`、`unl/ivern-friend-to-all`、`unl/keepers-verdict`、`unl/virtuoso`、`ven/ambessa-respected-and-feared`、`ven/forgotten-relic`、`ven/jayce-hammer-in-hand`、`ven/kennen-keeper-of-balance`、`ven/kharox`、`ven/masa-crashing-thunder`、`ven/mesmerize`、`ven/minah-swiftfoot`、`ven/noxian-demolitionist`、`ven/ocean-drake`、`ven/rebuttal`、`ven/sanction`、`ven/shady-spectacles`。

### 24. EG-LAYERS — 动态图层重算、条件快照、时长与拷贝依赖

受阻 **66** 张；**B2 / L**（3–5 工程日）；deps：EG-EXPR, EG-FILTERS。 优先复用现有 IR。

**实现与验收**：在依赖变化时重评连续条件和数值；有效 Might 快照避免自身递归；实现有证据的窗口/失效和 base-vs-current 层语义。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/layers/engine.ts`；`packages/engine-core/src/layers/ops/index.ts`；`packages/engine-core/src/layers/duration.ts`；`packages/engine-core/test/engine-gaps/layers.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/layers/engine.ts:126`：`function conditionMatches(effect: AnyRecord, object: LayeredObjectSnapshot): boolean {`。
- `packages/engine-core/src/layers/ops/index.ts:60`：`export function isDurationAlias(value: unknown): value is DurationAlias {`。
- CR v1.5：478.3, 479.4.b；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/renekton-brute`（`packages/card-dsl/src/cards/ven/renekton-brute.ts:122`）： 误当成新跨越；events/producers/might-change.ts 的 deriveMightChangedEmissions 仍没有图层重算后的生产调用方。(2) 828.1.b.1 的门控读取 self.empowered：参考内核可求值（golden 用真实 empower 动作使该门控开启并授予 Deflect/Ganking），但契约 ObjectSnapshot（engine-core/src/effects/contract.ts）不声明 live em。
- `ogs/garen-rugged`（`packages/card-dsl/src/cards/ogs/garen-rugged.ts:43`）：eld），combat/derived-might.ts 的窄路径只覆盖它自有的指定语义、不消费本卡程序。（golden 里直接注册原始对象条件证明 layers/engine.ts 自身不求值未识别条件，但生产绑定总是发函数形态，因此该形状不是本卡阻塞项。）依赖：expr-ext 到默认解释器/静态条件的 dispatch、战斗 designation 的生产方。不近似实现。。

**受阻卡（完整）**：`ogn/bandle-tree`、`ogn/dr-mundo-expert`、`ogn/draven-showboat`、`ogn/fortified-position`、`ogn/jeweled-colossus`、`ogn/kraken-hunter`、`ogn/lee-sin-ascetic`、`ogn/leona-determined`、`ogn/ravenborn-tome`、`ogn/sett-brawler`、`ogn/sett-kingpin`、`ogn/shen-kinkou`、`ogn/sun-disc`、`ogn/trifarian-war-camp`、`ogn/unyielding-spirit`、`ogn/vilemaws-lair`、`ogs/garen-rugged`、`rad/ahri-confident`、`rad/akali-brash`、`rad/banner-of-conquest`、`rad/boy-who-shattered-time`、`rad/durand-memorial`、`rad/firelights-hideout`、`rad/herald-of-the-emperor`、`rad/lady-of-clockwork`、`rad/lulu-whimsical`、`rad/piltovan-guidebot`、`rad/runeblade-anvil`、`rad/seraphine-not-alone`、`sfd/ancient-warmonger`、`sfd/fiora-peerless`、`sfd/forge-of-the-fluft`、`sfd/laurent-duelist`、`sfd/lucian-gunslinger`、`sfd/needlessly-large-yordle`、`sfd/ornn-forge-god`、`sfd/rell-magnetic`、`sfd/show-of-strength`、`sfd/soraka-wanderer`、`sfd/temporal-portal`、`unl/black-flame-altar`、`unl/determined-sentry`、`unl/diana-lunari`、`unl/imposing-challenger`、`unl/kinkou-initiate`、`unl/mutated-mouser`、`unl/square-up`、`unl/the-academy`、`unl/towering-combatant`、`unl/towering-pairofant`、`unl/vault-breaker`、`unl/vaults-of-helia`、`unl/vex-apathetic`、`unl/vex-mocking`、`ven/astral-heron`、`ven/dragon-form`、`ven/dune-surfer`、`ven/heisho-shell-of-the-world`、`ven/horns-of-the-dragon`、`ven/illaoi-prophet-of-the-great-kraken`、`ven/ki-barrier`、`ven/reluctant-leader`、`ven/renekton-brute`、`ven/shock-blast`、`ven/solari-sunhawk`、`ven/steel-paws`。

### 25. EG-HIDDEN — Hide 命令、Facedown Zone 与后续打出生命周期

受阻 **62** 张；**B3 / XL**（6–10 工程日）；deps：EG-CONTRACT, EG-LOCATIONS, EG-RULES, EG-POWER。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：实现 Hide、战场容量/控制权/次回合解锁、失控回收和 from-Hidden Reaction/费用/目标范围；已有 [A] 费用帮助器保留。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/zones/hidden/**`（建议新建）；`packages/engine-core/src/cost/kinds/hidden.ts`；`packages/engine-core/src/effects/keywords/Hidden.ts`；`packages/engine-core/test/engine-gaps/hidden.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/contract.ts:16`：`export type ZoneId = "hand" | "deck" | "rune-deck" | "trash" | "banishment" | "board" | "rune-zone" | "chain";`。
- `packages/engine-core/src/cost/README.md:59`：`not move a card, grant Reaction, create a facedown zone, or install Flow's delayed`。
- `/root/swarm-rift/logs/gate-51cd2b97.log:43758`：`error: 'Static ability kind cost.hidden has no layer mapping'`。
- CR v1.5：107.3, 811.1.b, 811.1.d.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：四处缺口，均不近似实现（复核 2026-10-17）：(1) [Hidden]（811.1）的 KeywordDef 已展开为 static cost.hidden，费用侧也有执行证据——buildHiddenCostPlan 能锁定 hide（1 点任意域 Power，811.1.b）与 play（忽略 base Energy/Power）两种计划，payHiddenCostPlan 真实支付（gol。
- `rad/demon-shade`（`packages/card-dsl/src/cards/rad/demon-shade.ts:73`）：四处当前缺口（2026-10-18 第四轮复核实测），均不近似实现：(1) 目的地已按 RIFT-357 的合并形状写成运行期 Location 选择（Expr kind "location"，170.11.c 的 open 过滤 { type: battlefield, open: true }，355.4 / 355.4.a / 451.1），但候选来源仍未接线：target/location/candidates.ts 的 allRefs 只从对象当。

**受阻卡（完整）**：`ogn/ava-achiever`、`ogn/bandle-tree`、`ogn/blastcone-fae`、`ogn/block`、`ogn/ember-monk`、`ogn/facebreaker`、`ogn/fight-or-flight`、`ogn/fox-fire-ahri`、`ogn/guerilla-warfare-teemo`、`ogn/hidden-blade`、`ogn/mushroom-pouch`、`ogn/noxus-saboteur`、`ogn/pack-of-wonders`、`ogn/pakaa-cub`、`ogn/sprite-call`、`ogn/stand-united`、`ogn/swift-scout`、`ogn/teemo-scout`、`ogn/teemo-strategist`、`ogn/tideturner`、`ogn/zhonyas-hourglass`、`rad/agonys-embrace`、`rad/bandle-scouts-academy`、`rad/bedeviling-stranger`、`rad/bushwhack-trap`、`rad/demon-shade`、`rad/elnuk-herd`、`rad/evelynn-consuming`、`rad/evelynn-in-control`、`rad/momentary-companion`、`rad/scrutinizing-scope`、`rad/the-waters-wage`、`sfd/black-market-broker`、`sfd/bushwhack`、`sfd/edge-of-night`、`sfd/emperors-divide`、`sfd/guards`、`sfd/here-to-help`、`sfd/hostile-takeover`、`sfd/sudden-storm`、`sfd/switcheroo`、`sfd/wages-of-pain`、`sfd/windsinger`、`unl/back-off`、`unl/bone-skewer`、`unl/evelynn-entrancing`、`unl/katarina-reckless`、`unl/keeper-of-masks`、`unl/lotus-trap`、`unl/mischievous-marai`、`unl/monster-harpoon`、`unl/pyke-dockside-butcher`、`unl/pyke-returned`、`unl/scuttle-crab`、`unl/smoke-and-mirrors`、`ven/disciple-of-shen`、`ven/kennen-keeper-of-balance`、`ven/mystic-vortex`、`ven/resonating-strike`、`ven/spiderling`、`ven/temporal-breach`、`ven/tornado-warrior`。

### 26. EG-GRANTS — 授予关键词的二次展开与完整能力授予/撤销

受阻 **60** 张；**B3 / L**（3–5 工程日）；deps：EG-KEYWORDS, EG-LAYERS, EG-FILTERS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：登记并撤销派生关键词/完整能力，按有效值堆叠；支持条件变化与来源移动/换控制者；由唯一静态路由安装，不另造结算。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/keyword-grants.ts`；`packages/engine-core/src/programs/ability-grants/**`（建议新建）；`packages/engine-core/src/effects/instructions/continuous.grant-ability.ts`（建议新建）；`packages/engine-core/src/effects/instructions/continuous.ignore-ability.ts`（建议新建）；`packages/engine-core/test/engine-gaps/grants.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/programs/keyword-grants.ts:100`：`* Non-static expansions fail closed until their lifecycle binding is available.`。
- `packages/engine-core/src/chain/engine.ts:84`：`this.layers = options.layers ?? new LayerEngine(options.host.objects());`。
- CR v1.5：801.3.a, 478.3；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：入但生产未装配：continuous.grant-keyword 原语、ability 图层关键词写入，以及 RIFT-710 的 programs/keyword-grants.ts（expandEffectiveKeywords/KeywordGrantLayerEngine）把已授予关键词 展开成 continuous.movement 并产出 permission.routes 都已合入，实测授予后 movement().canGank 为 true 且 Standard Move 成功；但没有。
- `ven/renekton-brute`（`packages/card-dsl/src/cards/ven/renekton-brute.ts:122`）：haracteristic: empowered"，442.1 的重复 Empower 约束因此仍只在参考内核成立。(3) 授予后的关键词只有参考层的重展开、没有生产消费方：已合入的 programs/keyword-grants.ts KeywordGrantLayerEngine 能把 empower 后的 Deflect/Ganking 重新展开（实测可读到 target.tax 与 continuous.movement，canGank 变 true，809.1.c.1 的。

**受阻卡（完整）**：`ogn/bilgewater-bully`、`ogn/block`、`ogn/bounty-hunter`、`ogn/captain-farron`、`ogn/cleave`、`ogn/fiora-victorious`、`ogn/heimerdinger-inventor`、`ogn/last-stand`、`ogn/raging-soul`、`ogn/spirits-refuge`、`ogn/taric-protector`、`ogn/udyr-wildman`、`ogn/windswept-hillock`、`rad/boy-who-shattered-time`、`rad/clanging-sentry`、`rad/consult-the-heavens`、`rad/demon-shade`、`rad/for-demacia`、`rad/heartening-soul`、`rad/jarvan-iv-martial-paragon`、`rad/ntofo-strikes`、`rad/starry-eyed-songstress`、`sfd/ancient-warmonger`、`sfd/blood-rush`、`sfd/breakneck-mech`、`sfd/forecaster`、`sfd/forge-of-the-fluft`、`sfd/gem-jammer`、`sfd/jax-unmatched`、`sfd/kato-the-arm`、`sfd/purifier`、`sfd/reksai-breacher`、`sfd/relentless-pursuit`、`sfd/rumble-hotheaded`、`sfd/sivir-mercenary`、`unl/allay-eager-admirer`、`unl/black-flame-altar`、`unl/deceiver`、`unl/gardens-of-becoming`、`unl/gustwalker`、`unl/lillia-protector-of-dreams`、`unl/master-yi-tempered`、`unl/mirror-image`、`unl/mosstomper`、`unl/shadows-call`、`ven/ambessa-respected-and-feared`、`ven/baccai-reaper`、`ven/baccai-sandspinner`、`ven/dominus`、`ven/dune-surfer`、`ven/grumpy-rockbear`、`ven/gust-monk`、`ven/heart-of-the-tempest`、`ven/heisho-shell-of-the-world`、`ven/jayce-hammer-in-hand`、`ven/oasis-raider`、`ven/perfect-execution`、`ven/renekton-brute`、`ven/serene-ascetic`、`ven/shadow-fiend`。

### 27. EG-PIPELINE — 触发批次、每次事件范围、倍增与抑制

受阻 **60** 张；**B3 / L**（3–5 工程日）；deps：EG-EVENTS, EG-PAYLOAD。 优先复用现有 IR。

**实现与验收**：按真实原子批次收集 once 和相对玩家条件；支持有依据的触发倍增/禁止及动态注册生命周期，保留 rollback 与不同批次独立性。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/events/pipeline.ts`；`packages/engine-core/src/events/pipeline-types.ts`；`packages/engine-core/src/events/pipeline-match.ts`；`packages/engine-core/src/events/trigger-rules/**`（建议新建）；`packages/engine-core/test/engine-gaps/pipeline.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/events/pipeline.ts:55`：`const value = scope === 'per-game' ? 'game' : scope === 'per-object' ? '${source.ref.id}:${source.ref.zoneEntryId}' : this.clock[scope.slice(4) as keyof PipelineClock];`。
- CR v1.5：383.3.e, 386.1, 423.1.b；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：续效果形状。复核记录：hold 时点的订阅词汇是 "held"（TriggerSpec 的 EVENT_PATTERN_TYPES 只接受 held，events/pipeline-match.ts 的 EVENT_NAMES 把 hold 映射为 held），本卡已按该词汇声明并通过生产注册路径的校验。依赖：触发能力的费用字段/提取接线、modify-resource-ability 图层读者，以及 legend-zone、Victory Score 读数、Teammate(ally) 关系、Gold 。
- `sfd/seat-of-power`（`packages/card-dsl/src/cards/sfd/seat-of-power.ts:61`）：ed discriminant now uses the closed EVENT_PATTERN_TYPES value "conquered" (events/pipeline-match.ts maps it onto conquer), but the printed ability (383.4.c / 473.2.a) still cannot run end to end, and nothing is approximated: (1) the battlefield-relative "。

**受阻卡（完整）**：`ogn/jinx-rebel`、`ogn/karma-channeler`、`ogn/karthus-eternal`、`ogn/obelisk-of-power`、`ogn/poro-herder`、`ogn/radiant-dawn`、`ogn/relentless-storm`、`ogn/the-dreaming-tree`、`ogn/vanguard-helm`、`ogn/viktor-innovator`、`ogn/viktor-leader`、`ogn/zaun-warrens`、`ogs/lux-illuminated`、`rad/banner-of-conquest`、`rad/demacian-illuminators`、`rad/detonation-amplifier`、`rad/fanfare`、`rad/mournful-spirit`、`rad/rakelstake`、`rad/storm-raptor`、`rad/titanic-shrine`、`rad/zero-point-inflection`、`sfd/azir-ascendant`、`sfd/battle-mistress`、`sfd/chem-baroness`、`sfd/draven-audacious`、`sfd/guardian-of-the-passage`、`sfd/last-rites`、`sfd/legion-quartermaster`、`sfd/power-nexus`、`sfd/rumble-hotheaded`、`sfd/rumble-scrapper`、`sfd/seat-of-power`、`sfd/simian-ancestor`、`sfd/soraka-wanderer`、`sfd/spinning-axe`、`sfd/zaun-punk`、`unl/alpha-wildclaw`、`unl/ashe-focused`、`unl/blue-sentinel`、`unl/fresh-beans`、`unl/frigid-jewel`、`unl/katarina-reckless`、`unl/leblanc-everywhere-at-once`、`unl/mageseeker-investigator`、`unl/nami-headstrong`、`unl/piltover-enforcer`、`unl/red-brambleback`、`unl/spectral-centaur`、`unl/starhound`、`unl/vicious-snapjaws`、`ven/astral-heron`、`ven/decree-of-unity`、`ven/fretful-feline`、`ven/nasus-guardian-of-knowledge`、`ven/piltovan-forge`、`ven/rampage`、`ven/reluctant-leader`、`ven/sacred-protector`、`ven/threshold-of-the-gray`。

### 28. EG-POWER — Universal Power 与限定用途资源支付

受阻 **53** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：单独承载 Universal 来源与指定用途资源，支付时分配并消费来源；已有任意域需求不等于能产生 Universal Power；null 印刷值不改写。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/cost/resources.ts`；`packages/engine-core/src/cost/payment.ts`；`packages/engine-core/src/effects/instructions/effect.resources.ts`；`packages/engine-core/src/cost/resource-provenance.ts`（建议新建）；`packages/engine-core/test/engine-gaps/power.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/contract.ts:14`：`export type Domain = "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order";`。
- `packages/engine-core/src/cost/README.md:96`：`values. They cannot express the universal Power source supported by migrated`。
- CR v1.5：163.2.b, 054.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/prodigal-explorer`（`packages/card-dsl/src/cards/sfd/prodigal-explorer.ts:90`）： condition 或约定 kind（always/never/compare/all/any/not/expression），本卡的 kind "use-only-if" + value 经 programs/activate.ts 的 translateRestriction 实测抛 "restriction ... kind use-only-if needs a rules adapter"，chain Finalize 也只检查调用方传入的 condition，054.2 的 o。
- `ogn/nocturne-horrifying`（`packages/card-dsl/src/cards/ogn/nocturne-horrifying.ts:121`）：”，而本地 sourceText 只有触发式 “look at … and see me, you may play me for :rb_rune_rainbow:.”，措辞不能同时成立，需裁定。(2) 触发注册在第 4 点的事件名上失败：本卡 filter 的 event: "cards-looked-at" 被 translateTriggerFilter 保留，events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭枚举（无该名称），vali。

**受阻卡（完整）**：`ogn/daughter-of-the-void`、`ogn/malzahar-fanatic`、`ogn/nocturne-horrifying`、`ogn/the-boss`、`ogn/volibear-furious`、`rad/akali-brash`、`rad/an-offer-you-cant-refuse`、`rad/bandle-scouts-academy`、`rad/gravity-field`、`rad/iron-revenant`、`rad/orianna-mechanical-marvel`、`rad/sneaky-zeebles`、`rad/trifarian-captain`、`sfd/ancient-henge`、`sfd/card-sharp`、`sfd/ezreal-prodigy`、`sfd/fire-below-the-mountain`、`sfd/forgefire-cape`、`sfd/glasc-mixologist`、`sfd/gold`、`sfd/hextech-anomaly`、`sfd/irelia-graceful`、`sfd/prodigal-explorer`、`sfd/rabadons-deathcrown`、`sfd/renata-glasc-mastermind`、`sfd/shurelyas-requiem`、`sfd/spinning-axe`、`sfd/treasure-hoard`、`sfd/vex-cheerless`、`sfd/wages-of-pain`、`unl/altar-of-blood`、`unl/bloodharbor-ripper`、`unl/blue-sentinel`、`unl/dancing-grenade`、`unl/death-from-below`、`unl/honeyfruit`、`unl/jhin-murderous-artist`、`unl/mageseeker-investigator`、`unl/scorn-of-the-moon`、`unl/shadow`、`unl/undying-loyalty`、`ven/baccai-witherclaw`、`ven/butcher-of-the-sands`、`ven/death-mark`、`ven/dominus`、`ven/dragon-roost`、`ven/glowstone`、`ven/helm-of-suppression`、`ven/hextech-disc`、`ven/matriarch-of-war`、`ven/shuriken-flip`、`ven/tail-cloaked-matriarch`、`ven/temporal-breach`。

### 29. EG-TAX — Deflect 目标税与任意域 Power 收取

受阻 **52** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 优先复用现有 IR。

**实现与验收**：读取当前静态/授予 Deflect，按每次选择生成任意域 Power additional cost；区分税需求与 Universal 来源，支持 ignore-tax 与目标重验。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/target/tax/**`；`packages/engine-core/src/chain/finalize/target-tax.ts`（建议新建）；`packages/engine-core/test/engine-gaps/tax.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/chain/engine.ts:348`：`item.costPlan = buildCostPlan(paymentContext, { ...(input ?? { id: 'cost:${item.id}', cost: { energy: { kind: 'constant', value: 0 } } }), mandatoryAdditional: [...(input?.mandatoryAdditional ?? []), ...taxes.map((tax, index) => ({ id: 'target-tax:${index}', cost: { energy: { kind: 'constant' as const, value: tax.amount } } }))] });`。
- `packages/engine-core/src/target/tax/adapter.ts:11`：`import { collectTargetTaxes, deflectCost, type CollectedTargetTax, type TargetTaxCollectionOptions } from "./collect.js";`。
- `/root/swarm-rift/logs/gate-51cd2b97.log:41482`：`error: 'Static ability kind target.tax has no layer mapping'`。
- CR v1.5：809.1.c.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `unl/rengar-unseen`（`packages/card-dsl/src/cards/unl/rengar-unseen.ts:44`）：rtCombat 仍抛 "combat-start-transaction"，没有真正的 Attacker designation 生产方。(3) [Deflect]（809.1.c/809.1.c.1）：target/tax 的 collectTargetTaxes 与 TargetTaxCostAdapter 已合入，但没有 Chain Finalize 消费方（grep 全 src 无调用），而 chain/engine.ts 的税回调把 tax.amount 直接当成 Energy。
- `ven/renekton-brute`（`packages/card-dsl/src/cards/ven/renekton-brute.ts:122`）：。(2) 828.1.b.1 的门控读取 self.empowered：参考内核可求值（golden 用真实 empower 动作使该门控开启并授予 Deflect/Ganking），但契约 ObjectSnapshot（engine-core/src/effects/contract.ts）不声明 live empowered 计数，apps/game-server 的引擎宿主把 empower 动作写成 buffs（host.ts 的 case "empower"），缺字段时求值抛 M。

**受阻卡（完整）**：`ogn/commander-ledros`、`ogn/deadbloom-predator`、`ogn/fiora-victorious`、`ogn/pouty-poro`、`ogn/qiyana-victorious`、`ogn/spirits-refuge`、`ogn/volibear-furious`、`rad/dune-devourer`、`rad/hunting-dog`、`rad/ki-burst`、`rad/skystrike-squadron`、`rad/storm-raptor`、`rad/watchful-curator`、`sfd/breakneck-mech`、`sfd/draven-audacious`、`sfd/irelia-fervent`、`sfd/jax-unmatched`、`sfd/kato-the-arm`、`sfd/navori-scout`、`sfd/ornn-forge-god`、`sfd/petricite-monument`、`sfd/sivir-ambitious`、`sfd/tianna-crownguard`、`unl/allay-eager-admirer`、`unl/bird`、`unl/carrion-dredger`、`unl/flurry-of-feathers`、`unl/frisky-hunter`、`unl/galio-indefatigable`、`unl/gutter-palace`、`unl/jhin-murderous-artist`、`unl/master-yi-tempered`、`unl/mosstomper`、`unl/poppy-paragon`、`unl/rengar-unseen`、`unl/trapping-grounds`、`unl/ultrasoft-poro`、`unl/vex-apathetic`、`unl/vi-hotheaded`、`unl/walking-roost`、`ven/baccai-sandspinner`、`ven/decree-of-insight`、`ven/grumpy-rockbear`、`ven/heisho-shell-of-the-world`、`ven/jayce-hammer-in-hand`、`ven/kayle-justified`、`ven/nasus-ascended`、`ven/plaza-guardian`、`ven/renekton-brute`、`ven/serene-ascetic`、`ven/solari-sunhawk`、`ven/steel-paws`。

### 30. EG-GEAR — 装备附着、宿主失效与装备数量/位置规则

受阻 **49** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-FILTERS, EG-LOCATIONS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：附着前绑定来源/host，控制者/同地/数量限制由规则检查；死亡/移动/脱离时装备跟随或清理有真实动作；不以通用 Move 掩盖 Attach。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.attach.ts`；`packages/engine-core/src/effects/instructions/effect.detach.ts`；`packages/engine-core/src/zones/unit-lifecycle.ts`；`packages/engine-core/src/zones/permanent-state.ts`；`packages/engine-core/test/engine-gaps/gear.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.attach.ts:4`：`* required 'host' evaluate to { kind: "source" }, { kind: "target", id },`。
- CR v1.5：818.1, 819；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/shady-spectacles`（`packages/card-dsl/src/cards/ven/shady-spectacles.ts:64`）："，message "Unsupported payment kind: equip"）；印刷费用（1 Energy + 1 Order 符文，CR 818.1.c/135.2.e.4）也无法送达 KeywordDef.expand（契约 3.8.3 的 params.cost 未由 programs/keywords.ts 转发，调用方只传 value/host）。programs/activate.ts 已将 Equip 展开为带目标和费用的 ChainDraft，通用启动绑定已。
- `sfd/rell-magnetic`（`packages/card-dsl/src/cards/sfd/rell-magnetic.ts:50`）：Energy 上限筛选 Equipment（:rb_energy_2:）、生成忽略费用的 FinalizedCostPlan，并把被打出的对象链接给 effect.attach：ObjectFilter 没有费用谓词（实测 translateObjectFilter 对 picks.filter 抛 "Unsupported filter field energyLte"，cost/plan-values.ts 的 readCost 也不读取印刷费用上限）；cost/cost-plan.ts 能表达 。

**受阻卡（完整）**：`rad/drakehound-packmaster`、`rad/nazuman-ntofo`、`rad/transpositionist`、`sfd/akshan-mischievous`、`sfd/armed-assailant`、`sfd/blade-of-the-ruined-king`、`sfd/boneshiver`、`sfd/boots-of-swiftness`、`sfd/brutalizer`、`sfd/cloth-armor`、`sfd/combat-chef`、`sfd/cull`、`sfd/dorans-ring`、`sfd/dorans-shield`、`sfd/edge-of-night`、`sfd/emperor-of-the-sands`、`sfd/experimental-hexplate`、`sfd/eye-of-the-herald`、`sfd/guardian-angel`、`sfd/hexdrinker`、`sfd/jax-unmatched`、`sfd/jax-unrelenting`、`sfd/last-rites`、`sfd/lucian-merciless`、`sfd/master-bingwen`、`sfd/ornn-forge-god`、`sfd/recurve-bow`、`sfd/rell-magnetic`、`sfd/sentinel-adept`、`sfd/serrated-dirk`、`sfd/skyfall-of-areion`、`sfd/spinning-axe`、`sfd/steraks-gage`、`sfd/svellsongur`、`sfd/veteran-poro`、`sfd/world-atlas`、`unl/blighted-battleaxe`、`unl/deceiver`、`unl/hextech-gauntlets`、`unl/hunters-machete`、`unl/keeper-of-masks`、`unl/mirror-image`、`unl/shepherds-heirloom`、`unl/soul-sword`、`ven/hand-hammer`、`ven/jagged-cutlass`、`ven/pendulum-blade`、`ven/riven-shattered`、`ven/shady-spectacles`。

### 31. EG-MOVE — Standard Move/Ganking 原子动作与事件桥接

受阻 **49** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-LOCATIONS, EG-RULES, EG-PAYLOAD。 优先复用现有 IR。

**实现与验收**：原子 Exhaust + 单位/组 Move，基地/战场/Ganking 路径与重验，向唯一管线提交 move-location；保留 Recall 区别并回滚整批。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/zones/movement.ts`；`packages/engine-core/src/turn/movement.ts`（建议新建）；`packages/engine-core/test/engine-gaps/move.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/combat/flow.ts:83`：`throw new TurnCombatBlockedError('standard-move-transaction', 'Standard Move requires atomic Exhaust + Move with rollback (CR 144.2)');`。
- CR v1.5：144.2, 144.4.c.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/sivir-mercenary`（`packages/card-dsl/src/cards/sfd/sivir-mercenary.ts:112`）：ogramLifecycle 都已合入，golden 经图层求值实测得到 4 → 6，且 buffs 仍为 0（不写成 Buff）。(3) 条件性 [Ganking] 的产出侧已合入但生产未装配：continuous.grant-keyword 原语、ability 图层关键词写入，以及 RIFT-710 的 programs/keyword-grants.ts（expandEffectiveKeywords/KeywordGrantLayerEngine）把已授予关键词 展开成 cont。
- `unl/rengar-unseen`（`packages/card-dsl/src/cards/unl/rengar-unseen.ts:44`）：/statics.ts 也仍抛 "Static ability kind target.tax has no layer mapping"。(4) [Ganking]（810.1.b/144.4.c.1）：展开的 continuous.movement 能通过 binder 绑定并注册到 ability 层，但 layers/rules/query.ts 的 movement() 只读 effect.permission.routes，而展开给的是字符串 permission: "batt。

**受阻卡（完整）**：`ogn/bilgewater-bully`、`ogn/bounty-hunter`、`ogn/commander-ledros`、`ogn/fiora-victorious`、`ogn/kaisa-evolutionary`、`ogn/kayn-unleashed`、`ogn/miss-fortune-captain`、`ogn/noxian-drummer`、`ogn/raging-soul`、`ogn/udyr-wildman`、`ogn/vi-destructive`、`ogn/vilemaws-lair`、`ogn/volibear-imposing`、`ogn/windswept-hillock`、`ogn/yasuo-windrider`、`ogn/zenith-blade-leona`、`ogn/zhonyas-hourglass`、`ogs/highlander-yi`、`ogs/master-yi-honed`、`rad/demon-shade`、`rad/ekko-ingenious`、`rad/gravity-field`、`rad/portable-portal`、`rad/siren-of-the-shallows`、`sfd/breakneck-mech`、`sfd/gem-jammer`、`sfd/laurent-bladekeeper`、`sfd/minotaur-reckoner`、`sfd/sivir-mercenary`、`sfd/soraka-wanderer`、`unl/altar-of-blood`、`unl/atakhan`、`unl/baron-pit`、`unl/determined-sentry`、`unl/gustwalker`、`unl/jhin-murderous-artist`、`unl/master-yi-tempered`、`unl/megatusk`、`unl/nilah-joyful-ascetic`、`unl/pyke-dockside-butcher`、`unl/rengar-unseen`、`unl/revna-the-lorekeeper`、`unl/tactical-retreat`、`unl/vault-breaker`、`unl/wily-newtfish`、`ven/kayle-justified`、`ven/kinkou-lifeblade`、`ven/oasis-raider`、`ven/renekton-brute`。

### 32. EG-MULTIPLAYER — 逐玩家/对手作用域与玩家选择指令

受阻 **48** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-TARGETS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：从可信玩家列表建立逐玩家顺序、chooser、选择与责任归属，允许无对象分支；输出真实 PlayerId，不能用 repeat 次数近似。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/interpreter/choice.ts`；`packages/engine-core/src/effects/interpreter/player-scope.ts`（建议新建）；`packages/engine-core/src/effects/instructions/target.player.ts`（建议新建）；`packages/engine-core/src/effects/instructions/choice.each-player.ts`（建议新建）；`packages/engine-core/src/effects/instructions/choice.each-other-player.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.play-for-each-player.ts`（建议新建）；`packages/engine-core/test/engine-gaps/multiplayer.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/interpreter/choice.ts:6`：`const chooser = args.chooser === undefined ? context.controller : string(args.chooser, "Chooser");`。
- CR v1.5：355.10.e, 412.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kharox`（`packages/card-dsl/src/cards/ven/kharox.ts:144`）：players"]：chain/picks/plan.ts 只锁定 zoneSlice/linked 来源，Finalize 没有把动态对手集合解析成玩家选择，effect.mill 的 pick 通道实测 negated/impossible（355.9.a / 441.2）。(4) 「play it, ignoring its cost」缺真实费用计划：chain/engine.ts 的 Finalize 只对 item.cost 调 buildCostPlan，卡片 body 。
- `ven/glowstone`（`packages/card-dsl/src/cards/ven/glowstone.ts:149`）：ecall" 显式阻断（457–460：Recall 不是 Move，不发 Move 事件、不受移动限制），不得用 move-location 近似；玩家选择也没有卡牌可用的 select-player 指令形态（265/355.10.e 的选择记录未合入）。(4)「At the end of your turn, kill this and deal 5 to all units you control」的「all units you control」是按特征程序化选出的集合（35。

**受阻卡（完整）**：`ogn/acceptable-losses`、`ogn/blind-fury`、`ogn/cull-the-weak`、`ogn/divine-judgment`、`ogn/forge-of-the-future`、`ogn/invert-timelines`、`ogn/kings-edict`、`ogn/mindsplitter`、`ogn/obelisk-of-power`、`ogn/party-favors`、`ogn/promising-future`、`ogn/sabotage`、`ogn/targons-peak`、`ogn/the-arenas-greatest`、`ogn/twisted-fate-gambler`、`ogn/whirlwind`、`rad/chronobreak`、`rad/hunters-circle`、`rad/mechanical-bandit`、`rad/rakelstake`、`rad/scrutinizing-scope`、`rad/suave-negotiator`、`sfd/card-sharp`、`sfd/downwell`、`sfd/draven-audacious`、`sfd/forgotten-monument`、`sfd/hextech-anomaly`、`sfd/the-papertree`、`unl/bewitching-spirit`、`unl/bone-skewer`、`unl/call-to-battle`、`unl/insightful-investigator`、`unl/khazix-mutating-horror`、`unl/rippers-bay`、`unl/safety-inspector`、`unl/scuttle-crab`、`unl/shard-of-undoing`、`unl/star-spring`、`unl/stare-down`、`unl/valley-of-idols`、`unl/walking-roost`、`ven/blade-twirler`、`ven/cataclysmic-duel`、`ven/decree-of-strength`、`ven/disciple-of-shen`、`ven/glowstone`、`ven/kharox`、`ven/minah-swiftfoot`。

### 33. EG-PLAY — 被选卡的印刷费用到嵌套 Play Finalize

受阻 **47** 张；**B4 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-COSTCHOICE, EG-DISCOUNTS, EG-TARGETS。 优先复用现有 IR。

**实现与验收**：由真实选中对象和目录生成 finalized plan，分别 ignore-base Energy/Power，保留追加费/增费；新 Play 链项与来源许可、token 和取消回滚一致；不得同步递归结算。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.play.ts`；`packages/engine-core/src/effects/play/**`（建议新建）；`packages/engine-core/test/engine-gaps/play.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.play.ts:18`：`* 'target' names a TargetSpec whose finalized references are read with`。
- `packages/engine-core/src/chain/engine.ts:94`：`if (cost.finalized !== true) throw new Error('Effect Play requires a finalized cost override');`。
- CR v1.5：420.3, 356.1.b.1, 356.1.b.3；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ogn/nocturne-horrifying`（`packages/card-dsl/src/cards/ogn/nocturne-horrifying.ts:121`）：be a non-empty string (or supply source)” 处失败，即使补上也要把该 CostPlan 接到从秘密区域打出的 effect.play（effect.play 只接受调用方给的 finalized plan）。(5) replacement/ 的通用事件拦截与注册面已合入，但 replacement/pattern.ts 的 ACTION_KINDS 是封闭映射（只含 move-zone/kill/ready/exhaust/damage/score/play。
- `ven/kharox`（`packages/card-dsl/src/cards/ven/kharox.ts:144`）：.ts 的 Finalize 只对 item.cost 调 buildCostPlan，卡片 body 内的常量 finalized 计划不会被生成；effect.play 还要求选中对象已由 Finalize 锁定目标，而 effect.play 的 target 在 choice.optional 的 body 内，实测命中 ChainContractBlockedError "Nested/repeated targets require an interpreter target-sele。

**受阻卡（完整）**：`ogn/ava-achiever`、`ogn/baited-hook`、`ogn/blind-fury`、`ogn/dazzling-aurora`、`ogn/flame-chompers`、`ogn/immortal-phoenix`、`ogn/kaisa-evolutionary`、`ogn/nocturne-horrifying`、`ogn/portal-rescue`、`ogn/promising-future`、`ogn/reinforce`、`ogn/soulgorger`、`ogn/spectral-matron`、`ogn/the-harrowing`、`rad/akali-brash`、`rad/an-offer-you-cant-refuse`、`rad/chronobreak`、`rad/clocktower-guardian`、`rad/drakehound-packmaster`、`rad/ekko-revolutionary`、`rad/life-from-stone`、`rad/runeblade-anvil`、`rad/transpositionist`、`sfd/arcane-shift`、`sfd/fizz-trickster`、`sfd/glasc-mixologist`、`sfd/here-to-help`、`sfd/jayce-man-of-progress`、`sfd/reksai-swarm-queen`、`sfd/rell-magnetic`、`sfd/rumble-hotheaded`、`sfd/treasure-hoard`、`sfd/void-burrower`、`sfd/void-rush`、`unl/bone-skewer`、`unl/cursed-sarcophagus`、`unl/dancing-grenade`、`unl/death-from-below`、`unl/heedless-resurrection`、`unl/rift-herald`、`unl/the-academy`、`unl/thrill-of-the-hunt`、`unl/undying-loyalty`、`ven/kharox`、`ven/tail-cloaked-matriarch`、`ven/temporal-breach`、`ven/wild-claw`。

### 34. EG-EMPOWER — Empowered 二元/可叠加状态、谓词与 Disempower 费用

受阻 **46** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-EXPR。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：状态由动作提交、快照和条件读取统一支持，遵守二元/多次许可上限、Disempower 实付收据；不把已存在 effect.empower 当作缺失。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.empower.ts`；`packages/engine-core/src/zones/empower-state.ts`（建议新建）；`packages/engine-core/src/effects/interpreter/predicates/empowered.ts`（建议新建）；`packages/engine-core/test/engine-gaps/empower.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.empower.ts:494`：`"effect.empower disempower mode does not accept amount, multiple, or limit"`。
- `packages/engine-core/src/effects/contract.ts:50`：`readonly buffs: number;`。
- CR v1.5：442.1.b, 442.1.c.1, 443.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/renekton-brute`（`packages/card-dsl/src/cards/ven/renekton-brute.ts:122`）：t/Ganking），但契约 ObjectSnapshot（engine-core/src/effects/contract.ts）不声明 live empowered 计数，apps/game-server 的引擎宿主把 empower 动作写成 buffs（host.ts 的 case "empower"），缺字段时求值抛 MissingInformation "Unavailable characteristic: empowered"，442.1 的重复 Empower 约束因此仍只在参考内。
- `rad/boy-who-shattered-time`（`packages/card-dsl/src/cards/rad/boy-who-shattered-time.ts:135`）：" fail-closed；不能把 value: 1 当作印刷的 1 Energy + Exhaust，也不能在卡文件里重写关键词。费用管线不接受 “Disempower me” 作为费用：cost/plan-values.ts 支持的支付种类只有 energy / power / xp / exhaust / discard / recycle / kill / reveal / spend-buff，kind: "disempower" 会被 readCost 以 judge-required 拒绝（443 。

**受阻卡（完整）**：`rad/boy-who-shattered-time`、`ven/akali-deadly-weapon`、`ven/akali-silent`、`ven/ambessa-respected-and-feared`、`ven/ambessa-the-wolf`、`ven/applied-researchers`、`ven/apprentice-mage`、`ven/aurok-general`、`ven/baccai-sandspinner`、`ven/baccai-witherclaw`、`ven/dame-the-despoiler`、`ven/defender-of-tomorrow`、`ven/escaped-grayback`、`ven/frostcoat-mother`、`ven/gangplank-naval`、`ven/glowstone`、`ven/guttural-roar`、`ven/heart-of-the-tempest`、`ven/helm-of-suppression`、`ven/hextech-disc`、`ven/hextech-formula`、`ven/kayle-justified`、`ven/kinkou-lifeblade`、`ven/lacerate`、`ven/legion-marauder`、`ven/master-of-shadows`、`ven/matriarch-of-war`、`ven/mel-newly-awakened`、`ven/nasus-ascended`、`ven/platewyrm-egg`、`ven/profiteer`、`ven/punching-poro`、`ven/questionable-tome`、`ven/rage-amplifier`、`ven/renekton-brute`、`ven/rogue-assassin`、`ven/sanction`、`ven/serene-ascetic`、`ven/shadow-fiend`、`ven/shock-blast`、`ven/solari-sunhawk`、`ven/souls-reflection`、`ven/steel-paws`、`ven/tail-cloaked-matriarch`、`ven/tomb-raider-barbara`、`ven/tools-of-empire`。

### 35. EG-RECALL — Recall 独立动作及通用 Move 指令消费

受阻 **46** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-LOCATIONS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：Recall 使用独立动作与观察历史；Move 绑定所移动对象和合法目的地、非目标集合与交换事务；目的地规则复用 Location 模块。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/zones/recall.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.move.ts`；`packages/engine-core/src/effects/instructions/effect.swap-location.ts`（建议新建）；`packages/engine-core/test/engine-gaps/recall.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.move.ts:16`：`* - mode: move (default) or recall. Recall is explicitly BLOCKED: the frozen`。
- `packages/engine-core/src/turn/flow.ts:321`：`throw new TurnCombatBlockedError('recall-action', 'Cleanup Recall needs an action distinct from Move (CR 323.6 / 458)');`。
- CR v1.5：458.1, 457；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `rad/ziggs-explosive`（`packages/card-dsl/src/cards/rad/ziggs-explosive.ts:165`）：y 的清洁期免召回（830.1.b.3）已合入 turn/flow.ts，实测带 Deploy 的非 Unit 装备留在战场、不带该关键词则在该步抛 recall-action，故这一条不再是缺口；Deathknell [Effect] 正文所需的 trigger.leave 原语仍未注册，因此 "deal 2 to an enemy unit here and kill all other Bombs you control here" 的 here 地点与集合消灭形态都没有展开。(4。
- `sfd/soraka-wanderer`（`packages/card-dsl/src/cards/sfd/soraka-wanderer.ts:154`）：.ts 的 conditionMatches 仍不求值 compare，静态/图层路线也带不了它。(4) 即使绑定到对象，effect.move 的 recall 模式仍被显式阻断（“Recall requires an action distinct from Move”，458/458.3），replacement/planner.ts 在规划期即抛 BlockedReplacementError，且不得用普通移动近似（Recall 不是 Move）。依赖：战斗分配批次（826）、替。

**受阻卡（完整）**：`ogn/back-alley-bar`、`ogn/charm`、`ogn/miss-fortune-buccaneer`、`ogn/possession`、`ogn/stealthy-pursuer`、`ogn/symbol-of-the-solari`、`ogn/the-boss`、`ogn/unlicensed-armory`、`ogn/volibear-imposing`、`ogn/yasuo-windrider`、`ogn/zhonyas-hourglass`、`ogs/highlander-yi`、`ogs/recruit-the-vanguard`、`rad/amateur-demolitionist`、`rad/black-rose-sanctum`、`rad/chronobreak`、`rad/firelights-hideout`、`rad/hunters-circle`、`rad/mordekaiser-twice-slain`、`rad/pillaged-armory`、`rad/resource-extractor`、`rad/ziggs-explosive`、`sfd/corrupt-enforcer`、`sfd/fae-porter`、`sfd/harpoon-squad`、`sfd/hostile-takeover`、`sfd/relentless-pursuit`、`sfd/ribbon-dancer`、`sfd/soraka-wanderer`、`sfd/stellacorn-herder`、`sfd/temptation`、`unl/altar-of-blood`、`unl/blast-cone`、`unl/conscription`、`unl/deceiver`、`unl/flurry-of-feathers`、`unl/imposing-challenger`、`unl/mister-root`、`unl/smoke-and-mirrors`、`unl/stare-down`、`unl/tactical-retreat`、`unl/void-assault`、`ven/akali-deadly-weapon`、`ven/glowstone`、`ven/twilight-step`、`ven/up-from-the-deep`。

### 36. EG-INSPECT — 有序查看/展示、reveal-until 与结果内受限选择

受阻 **45** 张；**B3 / L**（3–5 工程日）；deps：EG-TARGETS, EG-FILTERS。 优先复用现有 IR。

**实现与验收**：按真实牌库次序读取到条件为止，绑定有序结果和余集；选择只在本次查看集合内且支持类型/关系约束、可见性与对手猜测。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.inspect.ts`；`packages/engine-core/src/effects/instructions/effect.reveal.ts`；`packages/engine-core/src/effects/instructions/effect.order.ts`；`packages/engine-core/src/effects/instructions/effect.reveal-until.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.mill.ts`；`packages/engine-core/test/engine-gaps/inspect.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.inspect.ts:17`：`* 核心规则 v1.5 128.3–128.4：look 仅向 player 披露，所有选择均为 chooser-only。`。
- CR v1.5：425.3, 355.18；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ogn/nocturne-horrifying`（`packages/card-dsl/src/cards/ogn/nocturne-horrifying.ts:121`）：/规则冲突——CR v1.5 370.1.c.1 把这段文本引为替代效果 “As you look at or reveal me from the top of your deck, you may banish me. If you do, you may play me for [A].”，而本地 sourceText 只有触发式 “look at … and see me, you may play me for :rb_rune_rainbow:.”，措辞不能同时成立，需裁定。(2) 触发注册在第。
- `rad/command-attack`（`packages/card-dsl/src/cards/rad/command-attack.ts:105`）：field hasKeyword" 拒绝该键，因此目标限制无法求值（830.3；依赖 Deploy 特征过滤器契约）。(2)「Look at the top 5 cards of your Main Deck」是私下 top-N 查看：effect.inspect 的 top 作用域要求上游按真实牌库顺序提供有序 picksSpecId。RIFT-358 的 zoneSlice 有序 pick 核心已合入（chain/picks/plan.ts 的 finalizeOrderedPickPlans。

**受阻卡（完整）**：`ogn/baited-hook`、`ogn/blind-fury`、`ogn/dazzling-aurora`、`ogn/gemcraft-seer`、`ogn/jeweled-colossus`、`ogn/karma-channeler`、`ogn/mystic-poro`、`ogn/nocturne-horrifying`、`ogn/noxus-saboteur`、`ogn/promising-future`、`ogn/sai-scout`、`ogn/teemo-strategist`、`ogn/the-candlelit-sanctum`、`rad/command-attack`、`rad/drakehound-packmaster`、`rad/encore`、`rad/ki-burst`、`rad/life-from-stone`、`rad/mechanical-bandit`、`rad/rakelstake`、`rad/scrutinizing-scope`、`rad/the-empyrean`、`sfd/called-shot`、`sfd/forecaster`、`sfd/ornn-blacksmith`、`sfd/strike-down`、`sfd/void-hatchling`、`sfd/void-rush`、`unl/ashe-focused`、`unl/cursed-sarcophagus`、`unl/diana-lunari`、`unl/divining-shells`、`unl/double-trouble`、`unl/fate-weaver`、`unl/forgotten-library`、`unl/ivern-nurturer`、`unl/keepers-verdict`、`unl/rift-herald`、`unl/scuttle-crab`、`ven/apprentice-mage`、`ven/bottled-constellation`、`ven/decree-of-strength`、`ven/jayce-brilliant-inventor`、`ven/swain-visionary`、`ven/wild-claw`。

### 37. EG-ADD — Add 立即结算与支付中启动窗口

受阻 **43** 张；**B5 / M**（1–2 工程日）；deps：EG-POWER, EG-COSTBIND。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：从本卡能力识别 Add，立即结算并在费用支付的合法 Reaction Add 窗口执行；保留来源用途和回执，不绕过优先权。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/programs/add.ts`（建议新建）；`packages/engine-core/src/chain/finalize/add-window.ts`（建议新建）；`packages/engine-core/test/engine-gaps/add.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/chain/engine.ts:401`：`activateAddDuringPayment(draft: ChainDraft): void {`。
- `packages/engine-core/src/programs/activate.ts:29`：`return { id, controller, source, kind: 'activated', speed: ability.timing, body, cost: { id: 'cost:${id}', cost, ...(source.power ? { domains: source.power } : {}) }, ...(restrictions ? { restrictions } : {}) };`。
- CR v1.5：430.2, 430.3；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）： token 定义缺失：187.5 的 Gold 是带自身能力的 gear token（"[Reaction][>] Kill this, [E]: [Add] [A]."），effect.token 的冻结定义表按设计保持 blocked/judge-required，表内只有 recruit/sand-soldier/mech/reflection/tentacle，实测该原语对 gold 返回 negated + blockedReason "token-definition-o。
- `rad/ksante-dauntless`（`packages/card-dsl/src/cards/rad/ksante-dauntless.ts:107`）：卡牌侧没有该入口：continuous.might 的 argsSchema 拒绝 layer 字段、运行时拒绝 mode multiply（只接受 add/set）；continuous.keyword 只做「增补带值关键词」，实测对既有 Shield 追加固定值得到的是相加结果（printed 3 + grant 3 = 6、printed 5 + grant 3 = 8），等于真正倍增只在印刷值恰好等于增量时巧合成立，不能作为加倍语义；其 value 也只接受非负整数，不能引。

**受阻卡（完整）**：`ogn/daughter-of-the-void`、`ogn/dr-mundo-expert`、`ogn/hand-of-noxus`、`ogn/malzahar-fanatic`、`ogs/lux-crownguard`、`rad/akali-brash`、`rad/an-offer-you-cant-refuse`、`rad/bandle-scouts-academy`、`rad/herald-of-the-emperor`、`rad/iron-revenant`、`rad/ksante-dauntless`、`rad/lady-of-clockwork`、`rad/reckless-innovator`、`rad/resource-extractor`、`rad/sneaky-zeebles`、`sfd/ancient-henge`、`sfd/black-market-broker`、`sfd/blood-money`、`sfd/card-sharp`、`sfd/chem-baroness`、`sfd/chemtech-cask`、`sfd/fae-dragon`、`sfd/fire-below-the-mountain`、`sfd/gearhead`、`sfd/gold`、`sfd/hextech-anomaly`、`sfd/pickpocket`、`sfd/plundering-poro`、`sfd/treasure-hoard`、`sfd/treasure-hunter`、`sfd/trove-golem`、`sfd/wages-of-pain`、`unl/bloodharbor-ripper`、`unl/blue-sentinel`、`unl/deadly-flourish`、`unl/honeyfruit`、`unl/ivern-friend-to-all`、`unl/jhin-murderous-artist`、`unl/kinkou-initiate`、`unl/scorn-of-the-moon`、`ven/butcher-of-the-sands`、`ven/dominus`、`ven/platewyrm-egg`。

### 38. EG-COMBATPRIORITY — Tank/Backline/Assault 等战斗伤害分配规则

受阻 **38** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-RULES, EG-LAYERS。 优先复用现有 IR。

**实现与验收**：在真实伤害选择中消费 Tank/Backline 优先级、致命阈值与允许分配量，派生 Might 使用当前层；不绕过规则假称 proven-none。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/combat/base-combat-allocation.ts`；`packages/engine-core/src/combat/derived-might.ts`；`packages/engine-core/src/combat/allocation-rules/**`（建议新建）；`packages/engine-core/test/engine-gaps/combatpriority.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/combat/base-combat-allocation.ts:60`：`readonly assignmentModifier: 'proven-none';`。
- CR v1.5：467.2.c.3, 815.1.b, 826.4.b；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/soraka-wanderer`（`packages/card-dsl/src/cards/sfd/soraka-wanderer.ts:154`）：四处当前缺口，均不近似实现：(1) [Backline]（826）的 KeywordDef 已合入（effects/keywords/Backline.ts，注册为 continuous.combat/damage-assignment），但它只落到 ability 图层；战斗伤害步骤仍未绑定 Tank/Backline 的分配优先级（combat/base-combat-allo。
- `unl/pyke-returned`（`packages/card-dsl/src/cards/unl/pyke-returned.ts:102`）：ration 转换与 lifecycle attach/detach 亦已合入），路径本身可求值，缺的只是该位置谓词。[Hidden]（811）与 [Backline]（826）只按契约 3.7 声明关键词；两者的 KeywordDef 已合入，展开实测为 cost.hidden（生产 binder 抛「Static ability kind cost.hidden has no layer mapping」）与 continuous.combat（该 kind 目前只作为图层登记存在，没有。

**受阻卡（完整）**：`ogn/blitzcrank-impassive`、`ogn/block`、`ogn/caitlyn-patrolling`、`ogn/kayn-unleashed`、`ogn/lecturing-yordle`、`ogn/maddened-marauder`、`ogn/sett-kingpin`、`ogn/shen-kinkou`、`ogn/stormclaw-ursine`、`ogn/sunlit-guardian`、`ogn/taric-protector`、`ogn/volibear-imposing`、`rad/durand-memorial`、`rad/jarvan-iv-royal-heir`、`rad/party-crasher`、`rad/steadfast-outrider`、`sfd/needlessly-large-yordle`、`sfd/rell-magnetic`、`sfd/soraka-wanderer`、`sfd/xin-zhao-vigilant`、`unl/alpha-wildclaw`、`unl/elder-dragon`、`unl/enthusiastic-promoter`、`unl/evelynn-entrancing`、`unl/galio-indefatigable`、`unl/leblanc-everywhere-at-once`、`unl/lillia-protector-of-dreams`、`unl/mutated-mouser`、`unl/piltover-enforcer`、`unl/poppy-defender-of-the-meek`、`unl/pyke-returned`、`unl/towering-combatant`、`unl/vex-mocking`、`unl/yuumi-magical-cat`、`ven/dune-surfer`、`ven/eye-of-twilight`、`ven/horns-of-the-dragon`、`ven/kinkou-temple`。

### 39. EG-ADAPTER — 链解释器参数解包与跨结算注册身份

受阻 **36** 张；**B1 / L**（3–5 工程日）；deps：EG-CONTRACT。 优先复用现有 IR。

**实现与验收**：按 opcode schema 正确解包 literal 字段（stun、inspect/reveal/cost.modify、divide 等）；生成可回放且不同结算不冲突的 id，AwaitChoice 重试不重复提交。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/chain/interpreter-adapter.ts`；`packages/engine-core/test/engine-gaps/adapter.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/chain/interpreter-adapter.ts:32`：`const LITERAL_FIELDS: Readonly<Record<string, readonly string[]>> = {`。
- CR v1.5：317.2.c, 478.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kennen-keeper-of-balance`（`packages/card-dsl/src/cards/ven/kennen-keeper-of-balance.ts:67`）：对 controller: opponent 直接抛 judge-required。(4) 生产链的解释器适配器还不能执行本卡自己的 Stun 指令：chain/interpreter-adapter.ts 的 LITERAL_FIELDS 没有登记 effect.stun.target，卡 IR 的 { kind: "constant", value: specId } 会被原语 schema 以 "effect.stun target must be a spec id string" 拒绝（golden 用该适配器复现。
- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：经 linked-value 收取，golden 在解释器上真实执行并断言横置发生），但生产链路径不会把 cost.modify 的 id 字面量化（chain/interpreter-adapter.ts，实测抛 TypeError），且契约 3.1 的 TriggeredAbility 没有费用字段、programs/triggers.ts 也不从正文提取（TriggerRegistration.cost/mayAtFinalize 恒为 undefined），因此该费用到不了 Finalize，与 383.3.b.1「。

**受阻卡（完整）**：`ogn/dazzling-aurora`、`ogn/eclipse-herald`、`ogn/ember-monk`、`ogn/facebreaker`、`ogn/jinx-rebel`、`ogn/lee-sin-ascetic`、`ogn/nocturne-horrifying`、`ogn/portal-rescue`、`ogn/the-harrowing`、`ogn/twisted-fate-gambler`、`ogn/udyr-wildman`、`ogn/volibear-furious`、`ogn/zenith-blade-leona`、`ogs/lux-illuminated`、`rad/scorched-earth`、`sfd/altar-of-memories`、`sfd/chem-baroness`、`sfd/hall-of-legends`、`sfd/harpoon-squad`、`sfd/jax-unrelenting`、`sfd/lucian-merciless`、`sfd/master-bingwen`、`sfd/spirit-wheel`、`sfd/veteran-poro`、`sfd/void-rush`、`unl/alpha-strike`、`unl/back-off`、`unl/bone-skewer`、`unl/diana-lunari`、`unl/existential-dread`、`unl/fresh-beans`、`unl/heroic-charge`、`unl/rift-herald`、`ven/fretful-feline`、`ven/kennen-keeper-of-balance`、`ven/riven-shattered`。

### 40. EG-LEAVE — trigger.leave 与 Deathknell 正文挂接

受阻 **31** 张；**B1 / M**（1–2 工程日）；deps：EG-CONTRACT。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：将关键词正文挂入真实死亡触发，去掉不可执行占位；订阅与结算区分，不能仅注册一个新 op 就宣称死亡流程完成。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/trigger.leave.ts`（建议新建）；`packages/engine-core/src/effects/keywords/Deathknell.ts`；`packages/engine-core/test/engine-gaps/leave.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/keywords/Deathknell.ts:46`：`op: "trigger.leave",`。
- CR v1.5：808.1.c, 808.1.d；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `rad/ziggs-explosive`（`packages/card-dsl/src/cards/rad/ziggs-explosive.ts:165`）：turn/flow.ts，实测带 Deploy 的非 Unit 装备留在战场、不带该关键词则在该步抛 recall-action，故这一条不再是缺口；Deathknell [Effect] 正文所需的 trigger.leave 原语仍未注册，因此 "deal 2 to an enemy unit here and kill all other Bombs you control here" 的 here 地点与集合消灭形态都没有展开。(4) defense-declared 时点虽已在 timing-points.t。
- `rad/detonation-amplifier`（`packages/card-dsl/src/cards/rad/detonation-amplifier.ts:70`）：Unsupported static appliesTo" 拒绝，两者均实测），keywords/Deathknell.ts 的展开体仍引用未注册的 trigger.leave 原语，触发收集阶段（events/）也没有倍率接口；程序只保留待接线的 static 声明（同 Karthus, Eternal 先例），不用结算期的 repeat 近似（383.4.g.1/383.4.g.2）。(3) Play Effect 触发的 CardProgram 注册路径已合入；kill-then-draw 半段。

**受阻卡（完整）**：`ogn/ekko-recurrent`、`ogn/karthus-eternal`、`ogn/kogmaw-caustic`、`ogn/machine-evangel`、`ogn/soaring-scout`、`ogn/tasty-faefolk`、`ogn/undercover-agent`、`ogn/watchful-sentry`、`rad/clocktower-guardian`、`rad/detonation-amplifier`、`rad/gravity-field`、`rad/hexplosive-minefield`、`rad/hexplosives-expert`、`rad/hunting-dog`、`rad/mournful-spirit`、`rad/ziggs-explosive`、`rad/ziggs-short-fused`、`sfd/ferrous-forerunner`、`sfd/glasc-mixologist`、`sfd/honest-broker`、`sfd/lonely-poro`、`unl/black-rose-dignitary`、`unl/carrion-dredger`、`unl/dramatic-visionary`、`unl/leblanc-fragmented`、`unl/loyal-poro`、`unl/rift-herald`、`unl/ruined-rex`、`unl/scuttle-crab`、`unl/sprite-fountain`、`ven/noxian-emissary`。

### 41. EG-LEGEND — 传奇额外区域创建与 deckbuilding/Unique 构筑决策

受阻 **29** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-KEYWORDS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：实现额外传奇选择、Create 到 Legend Zone 和来源离场移除；deckbuilding/Unique 决策由真正构筑校验消费。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.create-legend.ts`（建议新建）；`packages/engine-core/src/game/legend-zone.ts`（建议新建）；`packages/engine-core/src/deck/**`；`packages/engine-core/test/engine-gaps/legend.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/deck/index.ts:1`：`export {};`。
- CR v1.5：440.2.b.4, 107.4.d.1, 825.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chem-baroness`（`packages/card-dsl/src/cards/sfd/chem-baroness.ts:175`）：过入场替代）；（3）费用式「exhaust me」（383.3.b/383.3.b.1/415.4/415.5）缺触发点的 Finalize 绑定与 legend-zone 表达：正文已按已合入的可支付形状声明该费用（cost.modify 锁定 { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }，cost.pay 经 linked-value 收取，golden 在解释器上真实执行并断言横置发生），但生产链。
- `sfd/prodigal-explorer`（`packages/card-dsl/src/cards/sfd/prodigal-explorer.ts:90`）：3.6 的 ZoneId（hand/deck/rune-deck/trash/banishment/board/rune-zone/chain）没有 Legend Zone（CR 107.4），而 game/lifecycle.ts 把传奇 create-token 到 chain 后不再移动（实测费用计划因此拒付：cost/payment.ts 的 checkAction 只接受 board/rune-zone 上的对象，抛 CostPlanError(cannot-pay-cost) "An 。

**受阻卡（完整）**：`ogs/dark-child-starter`、`ogs/lady-of-luminosity-starter`、`ogs/might-of-demacia-starter`、`ogs/wuju-bladesman-starter`、`rad/exemplar-of-demacia`、`rad/heartening-soul`、`rad/neeko-blending-in`、`rad/pride-of-nazumah`、`rad/starry-eyed-songstress`、`sfd/bard-mercurial`、`sfd/battle-mistress`、`sfd/blade-dancer`、`sfd/chem-baroness`、`sfd/emperor-of-the-sands`、`sfd/fire-below-the-mountain`、`sfd/forgefire-cape`、`sfd/glorious-executioner`、`sfd/grandmaster-at-arms`、`sfd/prodigal-explorer`、`sfd/rabadons-deathcrown`、`sfd/royal-entourage`、`sfd/shurelyas-requiem`、`unl/gloomist`、`unl/green-father`、`unl/keeper-of-the-hammer`、`unl/pridestalker`、`unl/voidreaver`、`ven/profiteer`、`ven/spiderling`。

### 42. EG-DELAYED — 延迟触发、临时替代与下一次窗口登记指令

受阻 **28** 张；**B5 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-EVENTS, EG-REPLACEMENT。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：补真实登记指令、宿主/控制者/期限/一次消费/回滚，触发窗口与替代窗口分别登记；与链执行的 id 稳定性配合。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/trigger.delayed.ts`（建议新建）；`packages/engine-core/src/effects/instructions/replacement.register.ts`（建议新建）；`packages/engine-core/src/effects/delayed/**`（建议新建）；`packages/engine-core/test/engine-gaps/delayed.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/registry.generated.ts:73`：`export const instructionDefinitionsById = registryById;`。
- CR v1.5：391, 392；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `unl/blue-sentinel`（`packages/card-dsl/src/cards/unl/blue-sentinel.ts:102`）：an）也不读倍率（同 Karthus, Eternal 的缺口）。(2)「at the start of your next Main Phase」是延迟触发（391.2/392）：effects/instructions/ 没有任何 opcode 消费 ctx.registerDelayedTrigger（registry.generated 无 trigger.delayed），也没有「下一次 Main Phase」的期限模型。(3)「[Add] :rb_rune_rainbow。
- `sfd/hostile-takeover`（`packages/card-dsl/src/cards/sfd/hostile-takeover.ts:58`）：按 391.2/392/393 是该咒语创建的 Delayed Ability（359.3.e.16 的示例正是本卡）：ResolveContext.registerDelayedTrigger 在契约 3.6 中，但 effects/instructions/ 没有已注册的 trigger.delayed op（registry.generated.ts 无该条目），写成卡自身触发会违反 391.1/393；(3) Recall（457-460：不是 Move、不触发 Move 能力、不受移动限制、保留伤害与状态）被。

**受阻卡（完整）**：`ogn/blazing-scorcher`、`ogn/confront`、`ogn/imperial-decree`、`ogn/lee-sin-centered`、`ogn/noxian-guillotine-darius`、`ogn/ravenborn-tome`、`ogn/sun-disc`、`ogn/targons-peak`、`ogn/tasty-faefolk`、`ogn/unyielding-spirit`、`rad/fanfare`、`rad/hexplosive-minefield`、`rad/last-caress`、`sfd/fae-dragon`、`sfd/hostile-takeover`、`sfd/rally-the-troops`、`unl/ashe-focused`、`unl/blue-sentinel`、`unl/deadly-flourish`、`unl/grim-resolve`、`unl/iascylla`、`unl/lotus-trap`、`unl/nami-headstrong`、`unl/tactical-retreat`、`ven/ki-barrier`、`ven/sanction`、`ven/siphoning-strike`、`ven/tornado-warrior`。

### 43. EG-DAMAGE — effect.damage 非目标集合与分配参数

受阻 **21** 张；**B2 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-FILTERS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：支持程序化非目标 query/linked 集合与已锁目标的 divide；分配选择与实际 Deal 不混淆，零/免疫/替代边界保持。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.damage.ts`；`packages/engine-core/src/effects/instructions/effect.kill-when-damaged.ts`（建议新建）；`packages/engine-core/test/engine-gaps/damage.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.damage.ts:94`：`throw new Error("effect.damage args.target must be a TargetSpec id string");`。
- CR v1.5：355.10.d, 418.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/glowstone`（`packages/card-dsl/src/cards/ven/glowstone.ts:149`）：all units you control」的「all units you control」是按特征程序化选出的集合（355.10.d，从不做选择），effect.damage 只接受 Finalize 锁定的 TargetSpec，没有非目标集合分支（turn-end 时点与触发注册本身已合入，programs/triggers.ts 可消费 turn-end 模式）。golden 覆盖身份/结构与 effect.kill(self) 的真实执行。依赖：每实例 Empower 费用透传与费用绑定、Disempower 费用种类、Recall 独立动作、玩家选择形态、非目标集合伤害形态。。
- `unl/dancing-grenade`（`packages/card-dsl/src/cards/unl/dancing-grenade.ts:45`）：or each time this spell has dealt damage this turn」的 Bonus Damage 次数没有生产者——effect.damage 只链接单次动作的 dealt / dealtTo / dealtCount，HistoryQuery（condition.history）只按动作/时点/对象/objectFilter 计数，并且 Expr 没有历史读取（history 仅是 body 指令），没有按卡身份绑定「本卡已造成伤害次数」的结果键（ogn/disintegrate 同一缺口）；(3) 重打费用尚未接入重放正在结算的法术的嵌套 play 生命周期，“i。

**受阻卡（完整）**：`ogn/anivia-primal`、`ogn/bullet-time-miss-fortune`、`ogn/cannon-barrage`、`ogn/flurry-of-blades`、`ogn/noxian-guillotine-darius`、`ogn/stormbringer-volibear`、`ogn/unchecked-power`、`ogn/volibear-furious`、`ogn/warwick-hunter`、`ogs/firestorm`、`ogs/tibbers-annie`、`rad/avalanche`、`rad/graves-blasting-through`、`rad/scorched-earth`、`unl/alpha-strike`、`unl/crescent-strike`、`unl/dancing-grenade`、`unl/frozen-fortress`、`unl/vilemaw`、`ven/glowstone`、`ven/renekton-rage-fueled`。

### 44. EG-COPY — Copy 与链项重做选择/重复打出

受阻 **20** 张；**B5 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-CHOICEPLAN, EG-PLAY。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：仅按规则复制可复制值/法术链项与新选择；区分 re-play、Repeat 与 copy，保留新项身份、控制者、Finalize/Resolve 顺序。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.copy.ts`；`packages/engine-core/src/layers/copy.ts`；`packages/engine-core/src/effects/instructions/effect.play-back.ts`（建议新建）；`packages/engine-core/src/effects/instructions/choice.remake-chain-item-choices.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.replace.ts`（建议新建）；`packages/engine-core/src/effects/copy/**`（建议新建）；`packages/engine-core/test/engine-gaps/copy.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.copy.ts:21`：`* Existing-object copies belong to the copy layer (446.1-2, 479.1.a-d), before`。
- CR v1.5：479.4, 418.5；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/rocket-barrage`（`packages/card-dsl/src/cards/sfd/rocket-barrage.ts:58`）：dDef.expand 时只传 keyword/value/host、印刷的 4 Energy 被丢弃；把已支付实例数接到解释器 repeat 节点并重做模式选择（820.2/820.2.a）的接线也不存在：付费回执只能由 condition.predicate 的 result: "cost.optional-additional-paid" 读成布尔值，而 repeat 节点只接受非负整数（实测 "Repeat count must be a non-negative safe in。
- `unl/brush`（`packages/card-dsl/src/cards/unl/brush.ts:51`）：四处缺口，均不近似实现：(1)「Bird, Cat, Dog, Poro, and Ivern units here have +1 [M]」的标签集合是 or 语义（133.8），而已合入的 ObjectFilter 与匹配器只按「每个 tags 条目都命中」求值（layers/filter.ts、解释器 selectors、参考内核 matchesFilter），写 tags: [五个标签] 会要求单位同时具备全部五个标签；程序用 tagsAnyOf 。

**受阻卡（完整）**：`ogn/defy`、`ogn/heimerdinger-inventor`、`ogn/mystic-reversal`、`ogn/tideturner`、`ogn/trifarian-war-camp`、`ogn/void-gate`、`rad/chronobreak`、`sfd/minefield`、`sfd/rocket-barrage`、`sfd/svellsongur`、`unl/atakhan`、`unl/brush`、`unl/deceiver`、`unl/green-father`、`unl/keeper-of-masks`、`unl/mirror-image`、`unl/zilean-time-mage`、`ven/rebuttal`、`ven/shady-spectacles`、`ven/temporal-breach`。

### 45. EG-MATCH — 对局建立时印刷数据、程序生命周期与命令桥接

受阻 **20** 张；**B7 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-COSTBIND, EG-STATIC, EG-TRIGGERS, EG-LIFECYCLE, EG-FINALIZE。 优先复用现有 IR。

**实现与验收**：核查 RIFT-760 已加入 MatchCard 的字段，继续传播目录真实 type/stat/cost/traits 并安装程序/完整命令路径；不再把历史缺字段当新需求。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/game/lifecycle.ts`；`packages/engine-core/src/game/command-adapter.ts`（建议新建）；`packages/engine-core/test/engine-gaps/match.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/game/lifecycle.ts:12`：`export interface MatchCard {`。
- `packages/engine-core/src/game/lifecycle.ts:65`：`readonly programs?: MatchPrograms;`。
- CR v1.5：116, 117；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/prodigal-explorer`（`packages/card-dsl/src/cards/sfd/prodigal-explorer.ts:90`）：une-deck/trash/banishment/board/rune-zone/chain）没有 Legend Zone（CR 107.4），而 game/lifecycle.ts 把传奇 create-token 到 chain 后不再移动（实测费用计划因此拒付：cost/payment.ts 的 checkAction 只接受 board/rune-zone 上的对象，抛 CostPlanError(cannot-pay-cost) "An exhaust cost requires a rea。
- `unl/khazix-evolving-hunter`（`packages/card-dsl/src/cards/unl/khazix-evolving-hunter.ts:133`）：ntext().query 求值，host query 不解析 sameLocationAs（参考内核实测 0 个候选），game-server 的 EngineRuntimeHost.matchesFilter 也只比较 zone/type/owner/controller。effect.damage 的动态 Might 数额已合入，golden 用链适配器 + 参考内核真实执行卡程序原始参数。不近似实现。。

**受阻卡（完整）**：`rad/amateur-demolitionist`、`rad/an-offer-you-cant-refuse`、`rad/antagonistic-apparatus`、`rad/cosmic-vista`、`rad/heimerdinger-academy-instructor`、`rad/supernova`、`sfd/lonely-poro`、`sfd/prodigal-explorer`、`sfd/royal-entourage`、`sfd/yordle-explorer`、`unl/baron-pit`、`unl/black-flame-altar`、`unl/gloomist`、`unl/green-father`、`unl/keeper-of-the-hammer`、`unl/khazix-evolving-hunter`、`unl/khazix-mutating-horror`、`unl/pridestalker`、`ven/brutal-hunter`、`ven/shen-leader-of-the-kinkou-order`。

### 46. EG-ZONES — Zone/Banish/Recycle 的源与链接集合消费

受阻 **17** 张；**B3 / L**（3–5 工程日）；deps：EG-TARGETS。 优先复用现有 IR。

**实现与验收**：统一接受有根据的宿主/链接对象和集合补集，正确 owner 目的地与 banish 新引用收据；不扩大展示集合；保留 stale/替代结果。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.zone.ts`；`packages/engine-core/src/effects/instructions/effect.banish.ts`；`packages/engine-core/src/effects/instructions/effect.recycle.ts`；`packages/engine-core/src/effects/instructions/effect.recycle-rest.ts`（建议新建）；`packages/engine-core/test/engine-gaps/zones.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.zone.ts:15`：`* 'target' names a finalized TargetSpec and is resolved with 'ctx.targets()';`。
- `packages/engine-core/src/effects/instructions/effect.banish.ts:17`：`*   { choose: id, filter, chooser?, visibility? }. Targets come only from`。
- CR v1.5：417.1, 428.1, 448.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/fizz-trickster`（`packages/card-dsl/src/cards/sfd/fizz-trickster.ts:123`）：刚打出的对象」（契约变更请求）。已合入并真实执行：choice.optional 接受/拒绝、effect.play（锁定目标 + 调用方零费计划）、effect.recycle 回收与 stale 目标 ignored；card-played 触发注册与 source: "self" 映射已有真实执行证据（trigger.leave/RIFT-359 与本卡无关）。依赖：目标过滤的印刷费用谓词或契约变更、所选对象费用计划接线与选择符契约变更。不近似实现。。
- `unl/disposal-order`（`packages/card-dsl/src/cards/unl/disposal-order.ts:106`）：模式一无法用已合入的 effect.recycle from 形状表达（{ zone, owner?: controller | source-owner, amount }）：(1)「opponents' trashes」按 CR 108.2.a 是每名对手各自的 Trash，是复数区域；from 只能读单一所有者的单一区域，按 controller 读会静默漏掉对手 Trash 中的牌，也没有规则条目把它收窄为控制者自己的区域；描述性 owner（"opponen。

**受阻卡（完整）**：`ogn/blind-fury`、`ogn/blitzcrank-impassive`、`ogn/dazzling-aurora`、`ogn/divine-judgment`、`ogn/forge-of-the-future`、`ogn/pack-of-wonders`、`ogn/reinforce`、`ogn/super-mega-death-rocket-jinx`、`rad/mechanical-bandit`、`rad/transpositionist`、`sfd/downwell`、`sfd/fizz-trickster`、`sfd/void-burrower`、`unl/disposal-order`、`unl/fate-weaver`、`unl/ivern-nurturer`、`ven/onslaught`。

### 47. EG-HARNESS — 真实测试内核的 Power 支付与生产适配证据

受阻 **14** 张；**B1 / M**（1–2 工程日）；deps：无。 优先复用现有 IR。

**实现与验收**：修复已有 pay 动作忽略 Power 的真实测试内核，场景走默认生产组装并提供精确回执断言；禁止为通过测试注入手工结算。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/testing/test-kernel.ts`；`packages/engine-core/src/effects/testing/scenario/**`；`packages/engine-core/test/engine-gaps/harness.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/testing/test-kernel.ts:330`：`case "pay": { const player = this.state.players.get(action.player); if (!player || !action.plan.finalized) return fail(); const energy = action.plan.energy ?? 0; const xp = action.plan.xp ?? 0; if (player.energy < energy || player.xp < xp) return fail("prevented"); player.energy -= energy; player.xp -= xp; return done(); }`。
- CR v1.5：357.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/chemtech-cask`（`packages/card-dsl/src/cards/sfd/chemtech-cask.ts:53`）：指令（204.1.c/204.3/355.10.c.1）：TriggeredAbility 没有 cost 字段；cost.pay 指令已注册，但其 payments 只接受 { energy, power, xp } 形状（或已完成计划），本卡声明的裸数组 [{ kind: "exhaust", object: "self" }] 被 paymentsPlan 拒绝（CostPlanError cannot-pay-cost），也没有把卡牌程序内的 cost.pay 指令接到触发器 Finalize 收费管线的路径。
- `ven/shadow-order-disciple`（`packages/card-dsl/src/cards/ven/shadow-order-disciple.ts:94`）：inalization 支付的费用（441.1 定义 Burn、441.3.a 限定其只在效果或费用指示时执行）；cost.pay 原语已合入，但其 payments 形状只接受 energy/power/xp 键，golden 实测 kind burn 使费用计划抛 CostPlanError judge-required（cost/plan-values.ts 的非标准付费种类只有 exhaust/discard/recycle/kill/reveal/spend-buff）。(2) 前置费用与可选决策的 Fin。

**受阻卡（完整）**：`ogn/bandle-tree`、`ogn/find-your-center`、`ogn/stormclaw-ursine`、`ogn/treasure-trove`、`rad/ezreal-dashing`、`rad/portable-portal`、`rad/watchful-curator`、`sfd/chemtech-cask`、`sfd/fae-porter`、`sfd/void-burrower`、`unl/bird`、`ven/baccai-reaper`、`ven/shadow-order-disciple`、`ven/tomb-raider-barbara`。

### 48. EG-MIGHT — Base Might、Set/Swap 与层内数值变换

受阻 **12** 张；**B3 / M**（1–2 工程日）；deps：EG-CONTRACT, EG-LAYERS。 优先复用现有 IR。

**实现与验收**：用明确层序实现 base 修改与 swap/snapshot 变换、最小值；沿用已存在加减/乘/设值和时长，不重复开发通用 Might 原语。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/continuous.might.ts`；`packages/engine-core/src/effects/instructions/continuous.base-might.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.swap-might.ts`（建议新建）；`packages/engine-core/test/engine-gaps/might.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/continuous.might.ts:33`：`* - amount?: Expr / number — 增量（可负）；mode "set" 时是目标值。缺省 0。`。
- CR v1.5：143.2.a, 479.4.b；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `rad/lady-of-clockwork`（`packages/card-dsl/src/cards/rad/lady-of-clockwork.ts:124`）：st」需要 trait 层的类型改写（拿到 unit 类型）与 Might 设值，并在图层内按 206 读取该装备印刷的 Energy 值；已合入的 continuous.might 只做 Might 的 add/set、argsSchema 拒绝 addTypes（实测 “Invalid continuous.might argument: addTypes”），layers/engine.ts 的 applyTrait 虽有 add-type 分支但没有卡牌侧入口把它与 Might 设值绑成一次特征改写。(3) 持续期「until you 。
- `ogn/leona-zealot`（`packages/card-dsl/src/cards/ogn/leona-zealot.ts:29`）：-player query"（实测 BOUND 失败），因此该光环连注册都做不到（更谈不上消费 stunned/sameLocationAs 与逐条 minimum）。layers/ops 的 applyMightMinimums 是按 478.1.c 的逐条钳制 helper，但只有调用方显式遍历条目时才生效，图层引擎本体仍只做终值 0 钳制（实测 amount:-8、minimum:1 的注册读出 might=0 而非 1）。已合入并发可验证：replacement.enter 的 state: "ready" 形状真实改写 chain→board 入场（golden 断言）。依赖：玩家分数谓词、相对玩家静态过滤绑定与逐条 minimum 钳制的图层消费；不固定 Victory Score 为 8。。

**受阻卡（完整）**：`ogn/convergent-mutation`、`ogn/ember-monk`、`ogn/leona-zealot`、`ogs/lux-illuminated`、`rad/herald-of-the-emperor`、`rad/lady-of-clockwork`、`rad/lulu-whimsical`、`rad/piltovan-guidebot`、`sfd/gearhead`、`sfd/switcheroo`、`ven/dragon-form`、`ven/fretful-feline`。

### 49. EG-NAMED — 命名、暗猜、Show-Off 与指定能力启动

受阻 **11** 张；**B3 / M**（1–2 工程日）；deps：EG-CONTRACT, EG-TARGETS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：规则支持的命名选项来自当前目录/牌局可信集合，秘密答案不泄露；指定能力生成真正的新 Pending/激活项并守费用/时机。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/choice.name.ts`（建议新建）；`packages/engine-core/src/effects/instructions/choice.hidden-guess.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.show-off.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.activate-named-trigger.ts`（建议新建）；`packages/engine-core/src/effects/named-choices/**`（建议新建）；`packages/engine-core/test/engine-gaps/named.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/registry.generated.ts:73`：`export const instructionDefinitionsById = registryById;`。
- CR v1.5：135.2.b.7, 383.4.g.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `unl/blast-cone`（`packages/card-dsl/src/cards/unl/blast-cone.ts:169`）：的候选包含被移动单位的当前位置，写进 IR 会把非法目的地交给玩家，因此保留被 effect.move 拒绝的描述性占位（fail closed），不猜目的地。(2)「you move an enemy unit」缺可判定载荷：events/action-adapter.ts 的 object-moved 事件把 player 记成被移动对象的原控制者（move-location 动作不带 player），也没有 cause 归因，无法按 412.4 / 412.5 过滤「由你。
- `rad/the-empyrean`（`packages/card-dsl/src/cards/rad/the-empyrean.ts:162`）：四项当前真实缺口（2026-10-18 实测）：(1) show off 的关键词拼写两边不一致：效果注册表以 KeywordDef.keyword（"Show Off"）为键，programs/keywords.ts 的 definitionFor 只做大小写折叠，卡牌写的 slug "show-off" 实测抛 “Keyword show-off has no executable Keywor。

**受阻卡（完整）**：`ogn/reckoners-arena`、`ogn/teemo-strategist`、`rad/primordial-roar`、`rad/rousing-display`、`rad/scrutinizing-scope`、`rad/the-empyrean`、`unl/blast-cone`、`unl/sprite-fountain`、`unl/the-list`、`ven/fallen-feline`、`ven/resonating-strike`。

### 50. EG-RUNTIME — 生产 Host 的 Play/Counter 与新动作原子执行

受阻 **10** 张；**B8 / XL**（6–10 工程日）；deps：EG-CONTRACT, EG-MATCH, EG-COMBAT, EG-TURN, EG-FINALIZE。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：Host 的 play/counter 当前显式 impossible；接可信程序/Finalize 与新动作，安装完整 Match 与图层/事件消费；新投影字段由协调者追加协议，保留 ACK/隐私/旧 profile 回放。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`apps/game-server/src/engine-runtime/host.ts`；`apps/game-server/src/engine-runtime/runtime.ts`；`apps/game-server/src/engine-runtime/projection.ts`；`apps/game-server/src/engine-runtime/__tests__/engine-gaps-runtime.test.ts`（建议新建）。

**证据**：

- `apps/game-server/src/engine-runtime/host.ts:250`：`case "play": return this.impossible();`。
- `apps/game-server/src/engine-runtime/host.ts:251`：`case "counter": return this.impossible();`。
- CR v1.5：355.15, 357.2；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ven/kharox`（`packages/card-dsl/src/cards/ven/kharox.ts:144`）：keyword/value，programs/keywords.ts 的 expandProgram 一律调 def.expand({ value, host }) 而不传 params，Empower.ts 因此只能回落到 cost: { kind: "empower" }；实测 createProgramBinding().describeActivate 抛 ProgramBindingError(judge-required) "Unsupported cost kind empower on activate:…"（827.1.c.1 / 827.1.c.2）。(2) empowered-changed 不在 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES：validateEventPattern 直接以 invalid-event-type 拒绝该判别式，所以 programs/triggers.ts 的 triggerRegistrations 无法注册本触发；事件载荷（previousCount/currentCount/cause）与 828.1.d 的“成为 Empowered”方向判定同样缺消费方（442.2.a）。(3) 「choose an opponent」的 picks 只有描述性 options: ["dynamic:opponent-players"]：chain/picks/plan.ts 只锁定 zoneSlice/linked 来源，Finalize 没有把动态对手集合解析成玩家选择，effect.mill 的 pick 通道实测 negated/impossible（355.9.a / 441.2）。(4) 「play it, ignoring its cost」缺真实费用计划：chain/engine.ts 的 Finalize 只对 item.cost 调 buildCostPlan，卡片 body 内的常量 finalized 计划不会被生成；effect.play 还要求选中对象已。
- `unl/khazix-evolving-hunter`（`packages/card-dsl/src/cards/unl/khazix-evolving-hunter.ts:133`）：ntext().query 求值，host query 不解析 sameLocationAs（参考内核实测 0 个候选），game-server 的 EngineRuntimeHost.matchesFilter 也只比较 zone/type/owner/controller。effect.damage 的动态 Might 数额已合入，golden 用链适配器 + 参考内核真实执行卡程序原始参数。不近似实现。。

**受阻卡（完整）**：`rad/amateur-demolitionist`、`rad/an-offer-you-cant-refuse`、`rad/antagonistic-apparatus`、`rad/cosmic-vista`、`rad/heimerdinger-academy-instructor`、`rad/supernova`、`sfd/lonely-poro`、`unl/khazix-evolving-hunter`、`unl/khazix-mutating-horror`、`ven/kharox`。

### 51. EG-BUFF — Buff 的 self/集合/非目标选择与支出收据

受阻 **9** 张；**B3 / M**（1–2 工程日）；deps：EG-TARGETS, EG-FILTERS。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：直接宿主、linked 与程序化集合不用伪 TargetSpec；任意数 Buff 的非目标选择和实际 spentCount 支持；遵守单 Buff 上限。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.buff.ts`；`packages/engine-core/test/engine-gaps/buff.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.buff.ts:37`：`* - target: TargetSpec id; the objects are read with ctx.targets(target).`。
- CR v1.5：702.2.b.1, 355.10.c.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `ogn/kraken-hunter`（`packages/card-dsl/src/cards/ogn/kraken-hunter.ts:54`）：u may spend any number of buffs as an additional cost” 需要 Finalize 里不受限数量的 spend-buff 支付选择；cost/plan-types.ts 的 CostPlanInput.optionalAdditional 是每个组件一次的布尔选择（OptionalCostInput.selected?: boolean，207 / 356.4），成本侧唯一的数量通道是 CostAction.action.amount 这个锁定值，没有“任。
- `ogn/trifarian-gloryseeker`（`packages/card-dsl/src/cards/ogn/trifarian-gloryseeker.ts:12`）：，所以该阈值实际是恒真的对象计数，不是「本回合已 Finalize 另一张牌」。(2) effect.buff 仍只接受 TargetSpec id（effect.buff.ts::parseArgs 要求非空字符串 target），没有非目标自身选择入口；「buff me」属 355.10.d.1 的非目标选择，保留的 self-unit TargetSpec 是受阻描述，若强行走 Finalize 会错误产生 became-target。(3) 触发注册与展开还有两处拒绝：触发 body 的 object:'self' 键被 programs/filters.tran。

**受阻卡（完整）**：`ogn/albus-ferros`、`ogn/cithria-of-cloudfield`、`ogn/kraken-hunter`、`ogn/overt-operation`、`ogn/peak-guardian`、`ogn/sett-brawler`、`ogn/trifarian-gloryseeker`、`ogn/wildclaw-shaman`、`rad/kaisa-rebel`。

### 52. EG-MODIFIERS — Bonus Damage、致命阈值与减 Might 修改

受阻 **9** 张；**B3 / M**（1–2 工程日）；deps：EG-CONTRACT, EG-RULES。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：有来源的 Deal 数值增量、致命判定与 Might 减值修正规则；分配数额与最终 Deal 分开，场所/施放者与持续窗口严格。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/continuous.bonus-damage.ts`（建议新建）；`packages/engine-core/src/effects/instructions/continuous.lethal-threshold.ts`（建议新建）；`packages/engine-core/src/effects/instructions/continuous.modify-might-reduction.ts`（建议新建）；`packages/engine-core/src/effects/instructions/effect.shield-value.ts`（建议新建）；`packages/engine-core/src/effects/modifiers/**`（建议新建）；`packages/engine-core/test/engine-gaps/modifiers.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.damage.ts:18`：`* - bonus?: Expr — 本 Deal 动作获得的 Bonus Damage（CR 418.4 / 712–715）。`。
- CR v1.5：715.4, 142.4.c；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `sfd/rabadons-deathcrown`（`packages/card-dsl/src/cards/sfd/rabadons-deathcrown.ts:54`）：三处当前缺口，均不近似实现：（1）数据/规则原文不一致仍待裁定：CR v1.5 715.4 的示例把本卡描述为提供 3 点 Bonus Damage（"the ability has 3 Bonus Damage from Rabadon’s Deathcrown"），但本地 deck-catalog（sfd-191-221）的 ability 只有 [Unique] 与 [Equip]，没有任何 Bonus Damage 文本；effect.damage 虽已接受 bon。
- `unl/dancing-grenade`（`packages/card-dsl/src/cards/unl/dancing-grenade.ts:45`）：.5 / 420.3 不足以安全落地），故不写固定次数的 repeat 或二次 damage；(2)「this deals 1 additional Bonus Damage for each time this spell has dealt damage this turn」的 Bonus Damage 次数没有生产者——effect.damage 只链接单次动作的 dealt / dealtTo / dealtCount，HistoryQuery（condition.history）只按动作/。

**受阻卡（完整）**：`ogn/ravenborn-tome`、`ogn/void-gate`、`ogs/annie-fiery`、`rad/ntofo-strikes`、`rad/ziggs-short-fused`、`sfd/rabadons-deathcrown`、`unl/dancing-grenade`、`unl/elder-dragon`、`ven/mel-newly-awakened`。

### 53. EG-REFLEXIVE — 反身触发创建独立 Pending 链项

受阻 **7** 张；**B4 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-TRIGGERS, EG-CHOICEPLAN。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：从原指令结果创建新 Pending 能力与控制者/条件快照，后续目标和 may 在新项 Finalize 选择；同步 sequence/repeat 不代替反身触发。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/trigger.reflexive.ts`（建议新建）；`packages/engine-core/src/effects/reflexive/**`（建议新建）；`packages/engine-core/test/engine-gaps/reflexive.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/registry.generated.ts:73`：`export const instructionDefinitionsById = registryById;`。
- CR v1.5：388.4, 389.1；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `unl/death-from-below`（`packages/card-dsl/src/cards/unl/death-from-below.ts:63`）：四处缺口，均不近似实现：(1) 反身触发（CR 388 / 388.4 以本卡为官方示例、389 / 389.1）没有卡牌侧构造：结算时要把新能力作为链项加入链，IR 的六种 Ability 与 choice.optional 都做不到，已注册的 42 个 op 里也没有 trigger.reflexive（实测 has() 为 false）；下面对 “Then, …。
- `ogn/dragons-rage-lee-sin`（`packages/card-dsl/src/cards/ogn/dragons-rage-lee-sin.ts:57`）：两段缺口（均为 2026-10-17 实测，不近似实现）：(1) 反身触发无创建者：「Then choose another enemy unit at its destination」按 S-ORIGINS 勘误属于反身触发（388.1/388.2/389.1/389.2、355.5.b：第二个目标由新 Pending Item 自行 Finalize，不是在原咒语的 Finalize 选择），而已。

**受阻卡（完整）**：`ogn/dragons-rage-lee-sin`、`ogn/twisted-fate-gambler`、`unl/alpha-strike`、`unl/bone-skewer`、`unl/death-from-below`、`unl/hwei-brooding-painter`、`ven/forgotten-relic`。

### 54. EG-KILL — Kill 程序化集合及真实对象归属

受阻 **6** 张；**B3 / M**（1–2 工程日）；deps：EG-FILTERS, EG-PAYLOAD。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：补 query/linked 非目标集合 Kill；严格取当前候选与责任玩家，依次/同时由规则决定；死亡替代和 LKI 交事件层。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/effect.kill.ts`；`packages/engine-core/test/engine-gaps/kill.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/instructions/effect.kill.ts:17`：`* - 'target'?: string —— TargetSpec 的 id，经 'ctx.targets(id)' 取得结算时仍然合法的目标集合`。
- CR v1.5：429.1, 355.10.d；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `rad/ziggs-explosive`（`packages/card-dsl/src/cards/rad/ziggs-explosive.ts:165`）：to an enemy unit here and kill all other Bombs you control here" 的 here 地点与集合消灭形态都没有展开。(4) defense-declared 时点虽已在 timing-points.ts 声明，但 combat/flow.ts 在 combat 开启路径抛出 TurnCombatBlockedError('combat-start-transaction')，383.4.f.2 的 Defend Trigger。
- `unl/atakhan`（`packages/card-dsl/src/cards/unl/atakhan.ts:123`）：ckedError('combat-start-transaction')），且 TriggerSpec 还不能把本次防御者、攻击地点与选择者绑定到 effect.kill 的非目标选择（383.4.e/359.3.f）。(4) Ganking 已展开为 continuous.movement 且该 static 能经 createEngineStaticBinder.bindStatic 注册（实测成功，不再抛 layer mapping 错误），但展开的 permission 是字符串 "battlef。

**受阻卡（完整）**：`ogn/thermo-beam`、`ogn/warwick-hunter`、`rad/ziggs-explosive`、`unl/atakhan`、`unl/shard-of-undoing`、`unl/the-ruination`。

### 55. EG-LINKED — Linked Ability 关联对象、跨区新引用与历史身份

受阻 **5** 张；**B3 / L**（3–5 工程日）；deps：EG-CONTRACT, EG-PAYLOAD。 **IR 扩展（只增不改）**，接口由 EG-CONTRACT 先行。

**实现与验收**：实现 394–398 的来源入区实例关联集合与跨区新引用收据；同名牌不可互认，作用域失效按规则；将真实伤害历史按实体/实例暴露。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/linked-abilities/**`（建议新建）；`packages/engine-core/src/effects/interpreter/linked-objects.ts`（建议新建）；`packages/engine-core/test/engine-gaps/linked.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/effects/interpreter/selectors.ts:15`：`export function resolveObjectSelector(selector: ObjectSelector, environment: Pick<ExpressionContext, "context" | "host" | "linked">): ObjectRef[] {`。
- CR v1.5：394, 398, 124；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `unl/virtuoso`（`packages/card-dsl/src/cards/unl/virtuoso.ts:63`）：发快照的 PipelineEvent 没有绑定成对象选择符的路径（383.2.c.3.b / 359.3.f.3）；(3) “four spells banished with me”（CR 394–398）的 Linked Ability 作用域没有合并追踪器，effect.zone 只能经 target/pick 读取，picks 来自 Finalize 锁定答案，无法表达关联集合（实测 4 张无关放逐法术即满足计数，put-in-trash 随后 ignored）；(4) “you may banis。
- `unl/death-from-below`（`packages/card-dsl/src/cards/unl/death-from-below.ts:63`）： 只有 self/source/target/pick/linked，跨区（124）后 self/source 不再指向 Trash 里那张牌，没有“自己在某区域的当前引用”选择器；且本卡 targets.filter 的 { source: "self", zone: "trash" } 被 programs/filters.ts 的 translateObjectFilter 以 "Unsupported filter field source" 拒绝（实测 describePlay。

**受阻卡（完整）**：`unl/ashe-focused`、`unl/cursed-sarcophagus`、`unl/dancing-grenade`、`unl/death-from-below`、`unl/virtuoso`。

### 56. EG-TRAITS — continuous.add-tag 到既有 trait 层的指令桥接

受阻 **1** 张；**B3 / S**（0.5–1 工程日）；deps：EG-LAYERS。 优先复用现有 IR。

**实现与验收**：复用已有 add-tag/grant-tag 层操作，补 CardProgram 指令和撤销/期限接线。 正常/拒绝/失效/替代/回滚场景须经真实生产路径，原始卡 IR 不能手工改状态结算。

**owns**：`packages/engine-core/src/effects/instructions/continuous.add-tag.ts`（建议新建）；`packages/engine-core/src/layers/trait-adapter.ts`（建议新建）；`packages/engine-core/test/engine-gaps/traits.test.mjs`（建议新建）。

**证据**：

- `packages/engine-core/src/layers/engine.ts:192`：`} else if (kind === "add-tag" || kind === "gain-tag" || kind === "grant-tag") {`。
- CR v1.5：133.8；近期复核原文与门禁补证见 JSON `evidence`。

**代表卡当前理由**：

- `unl/ivern-friend-to-all`（`packages/card-dsl/src/cards/unl/ivern-friend-to-all.ts:170`）：Mode choices require a Finalize/Resolve choice-plan adapter"，CR 355.1）。(2) continuous.add-tag 没有 CardProgram 指令注册与 trait 层写入接线（133.8）：注册表无该 opcode；trait 层本身已有 add-tag/grant-tag。(3) conquer/hold 的 Score 波只有 player/details.battlefieldId，缺参与征服/固守单位的对象匹配（383.4.c。

**受阻卡（完整）**：`unl/ivern-friend-to-all`。

## 无法单靠引擎解除的卡

以下卡除 `unl/buff` 外亦有引擎缺口；即使引擎完成，仍须保留 `judge-required` 直到对应审核通过。规则裁定/文本差异与源数据问题分别请求协调者处理，盘点不改目录。

| 卡 | 类别 | 仍需解决 |
| --- | --- | --- |
| ogn/convergent-mutation | 需规则/文本裁定 | another friendly unit 的选择者/目标属性与快照时点未定；355.7、355.10.d、479.4.b。 |
| ogn/divine-judgment | 需规则/文本裁定 | Recycle the rest 指代四类保留集合的补集还是别的集合，需要正式裁定。 |
| ogn/nocturne-horrifying | 需规则/文本裁定 | 本地 sourceText 与 CR 370.1.c.1 的替代式示例不一致，需勘误/按印刷号裁定。 |
| ogn/pack-of-wonders | 需规则/文本裁定 | [Hidden] card 指关键词牌还是 Facedown Zone 牌，需正式澄清。 |
| ogn/sona-harmonious | 需源数据核验 | 本地 ready 4 与 CR 383.2.a.1 的 ready up to 4 不同，需按官方文本/印刷核验数量选择口径。 |
| ogn/teemo-strategist | 需源数据核验 | 程序 sourceText 与已刷新勘误顺序/Hidden 分支不同；先统一文本、身份和目标时序。 |
| ogs/lux-crownguard | 需源数据核验 | 同 canonical 的 OGS Use only 与 VEN Spend this Energy only 文本，以及标签不一致；先确定执行印刷/文本。 |
| rad/invigorating-bloom | 需源数据核验 | 目录为 Unit，但 Energy/Power/Might 缺失；不得补零或推断卡型。 |
| rad/iron-revenant | 需源数据核验 | rad-143-167 与 rad-170-167 是否保留 only 的用途限制不同，需勘误或按印刷号绑定。 |
| rad/kaisa-rebel | 需源数据核验 | 同 canonical 的 rad-sp4-005 文本与 Might 不同，需先统一印刷身份。 |
| rad/nazuman-ntofo | 需源数据核验 | 目录 tags 为空导致 not-equipment-tag；引擎不应猜测/补造装备标签。 |
| rad/overloaded-traveler | 需源数据核验 | 目录为 Spell 且 might=2，文本为永久 Unit 的静态能力，需源数据核验。 |
| rad/scrutinizing-scope | 需源数据核验 | 目录为 Spell，文本为留场永久物的启动能力，需源数据核验。 |
| rad/zero-point-inflection | 需源数据核验 | 目录为 Spell，文本为留场永久物的持续触发和 kill this，需源数据核验。 |
| sfd/rabadons-deathcrown | 需规则/文本裁定 | 本地程序/目录只有 Unique 与 Equip，CR 715.4 示例却引用 3 Bonus Damage；没有卡面/勘误依据时不能自行添加该效果。 |
| sfd/void-burrower | 需规则/文本裁定 | 同 canonical 的 sfd-187-221 与 sfd-243-221 直接 Play / 先 Banish 再 Play 文本不同，需按印刷号或勘误解决。 |
| unl/buff | 需分类口径审核 | 提醒/规则说明文本的 CardProgram status 口径需统一审核；effect.buff 已实现单 Buff 限制，judgeReason 明确依赖无，不制造引擎任务。 |
| unl/dancing-grenade | 需规则/文本裁定 | Play this again 的来源、嵌套顺序与次数归属未有足够规则依据。 |

Death from Below 的反身 may 已由 v1.5 388.4 官方例子明确，Virtuoso 的首段 may 也应先按 383.3.a/.a.3 审核；不因旧契约的指令可选包装再发明官方规则缺口。它们仍被引擎的反身项/触发 Finalize/linked 等缺口阻塞，状态不升级。Seat of Power 的尾部双句点、Mesmerize 的缺分隔符记录为非功能文本清理，不虚增无法由引擎解决的阻塞卡数。

## 30% / 70% / 95% 目标估算

分母为 1,080 个唯一卡程序；基线**标签**可用 158（141 executable + 17 no-ability）。下表先给目标需要真正补齐的卡数，再按“排名逐项加入任务并展开全部 deps”计算可消除已知阻塞的上限。它不是最少任务优化，也不是实测执行通过率；所列 selectedTasks 见 JSON。引擎合入后再并发补卡、翻转 TODO 并逐卡验证，才可计入真实可执行数。

| 目标 | 目标可用卡 | 对应 executable 标签 | 至少新增 executable | 推荐任务闭包数量 | 该闭包的候选可用上限 |
| --- | --- | --- | --- | --- | --- |
| 30% | 324 | 307 | 166 | 26 | 371 |
| 70% | 756 | 739 | 598 | 38 | 779 |
| 95% | 1026 | 1009 | 868 | 50 | 1026 |

若验收分子严格只计 `executable`，不把 17 张 `no-ability` 算入，使用以下单独估算（JSON `strictExecutableEstimates`）。分母仍为全部 1,080 张；任务排序和依赖闭包算法相同。

| 目标 | 目标 executable | 至少新增 executable | 推荐任务闭包数量 | 该闭包的候选 executable 上限 |
| --- | --- | --- | --- | --- |
| 30% | 324 | 183 | 26 | 354 |
| 70% | 756 | 615 | 38 | 762 |
| 95% | 1026 | 885 | 52 | 1027 |

所有引擎任务完成并补卡验证后，按当前已知理由的保守可用上限是 **1062/1,080**（其中 executable 至多 1045，另 17 无能力）；另 18 张等裁定/源数据或分类审核。95% 目标在这个静态模型中可达；不代表已覆盖未发现规则缺口。

headless 仍需 EG-MATCH / RUNTIME / MOVE / COMBAT / TURN / FINALIZE 的真实命令和服务。共享 soak 累计为 6,400 局、0 winner、5,395 blocked、205 guard、800 concede、0 exception/replayMismatch/privacyLeak；是历史累积观测，不能将 concede 或绿色诊断当作自然胜。原 README 的 100 局还报告 72 missing printed costs、4 cost domains、24 other-filter，但 RIFT-760 已部分解决数据字段，必须重跑后再比较分布。

## 盘点验证

本任务只创建两个文档，不运行包构建、全量测试、e2e 或共享数据库集成测试。验证包括：JSON 解析/必填字段、922/922 覆盖、canonical 唯一、卡↔任务反向索引、源/测试哈希、56 个任务 DAG、每条 deps 严格在前批、全局/同批 owns 无重叠、排名与预测数可重算。另独立求值 1,080 个 TypeScript 源程序，状态、canonical、原文、judgeReason 与完整 abilities IR 均匹配盘点输入。已跟踪输入从固定 integration 对象读取校验；gitignored 的本地生成指令注册表另列来源与哈希，不混称 Git 快照对象。证据日志和只读抽取/验证脚本在 `/tmp/RIFT-781-engine-gap-inventory/`。

轻量 JSON 读取：

```sh
python -m json.tool docs/plans/engine-gaps.json > /dev/null
node -e 'const x=JSON.parse(require("node:fs").readFileSync("docs/plans/engine-gaps.json","utf8")); console.log(x.summary); console.log(x.gaps.slice(0,20).map(g=>[g.id,g.cardCount,g.batch]));'
```
