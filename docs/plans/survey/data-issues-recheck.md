# RIFT-54 data-issue 复核

复核对象是刷新后的 `packages/card-data/data/deck-catalog.json`：

- `dataVersion`: `2026-10-15-official-gallery`
- catalog `digest`: `sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d`
- 文件 SHA-256: `06421ffce228ad3412a03c0e237834ac7388ce905c42892e75a5101fd33ac720f`
- 复核范围：四份 `unclassified-*.json` 中 `verdict: "data-issue"` 的 31 条记录

“已解决”表示刷新目录已经消除了该条记录描述的目录差异；“部分解决”表示主要能力文本已经更新，但同一条记录仍有标签、alternate printing 或同 identity printing 的差异；“未解决”表示当前目录仍保留原差异。规则编号、S-GALLERY、S-ORIGINS、Unleashed/Radiance Errata 和 Patch Notes 均沿用原分诊记录中的官方来源标识。

| Printing | 卡名 | 状态 | 新目录观察与剩余差异 | 官方来源 |
| --- | --- | --- | --- | --- |
| `ogn-028-298` | Draven | 未解决 | OGN 仍有 `Noxus`，同 identity 的 `ven-172-166` 仍没有；能力文本已可读。 | CR v1.5 132.4, 133.8.a, 479.4；S-GALLERY OGN/VEN |
| `ogn-030-298` | Jinx | 未解决 | OGN 仍有 `Zaun`，`ven-168-166` 仍缺少；Accelerate、Assault 和 discard 文本存在。 | CR v1.5 133.8.a, 423.4, 807.1, 805.1；S-GALLERY OGN/VEN |
| `ogn-035-298` | Vayne | 未解决 | OGN 仍没有 `Sentinel`，SFD 两个对应 printing 有 `Sentinel`；enter ready 文本可读。 | CR v1.5 133.8.a, 359.2.c, 471.1, 369.3；S-GALLERY OGN/SFD |
| `ogn-036-298` | Vi | 未解决 | OGN 仍有 `Piltover`，`ven-167-166` 仍缺少；Ganking 与回收费用文本存在。 | CR v1.5 133.8.a, 417.3, 810.1；S-GALLERY OGN/VEN |
| `ogn-039-298` | Kai'Sa | 未解决 | OGN 仍有 `The Void`，`ven-sp1-006` 仍缺少；Accelerate 与 conquer draw 文本存在。 | CR v1.5 133.8.a, 414.1, 471.1, 805.1；S-GALLERY OGN/VEN |
| `ogn-073-298` | Sona | 部分解决 | OGN 已是 `At the end of your turn, if I'm at a battlefield, ready up to 4 friendly runes.`；但 OGN 仍有 `Demacia`，`ven-sp2-006` 没有。 | CR v1.5 133.8.a, 383.2.a.1, 416.1；S-ORIGINS Sona；S-GALLERY OGN/VEN |
| `ogn-115-298` | Promising Future | 已解决 | 已包含从五张中 banish 一张、recycle 其余牌，以及从下一位玩家开始 play those cards；Energy/Power 限制也在文本中。 | CR v1.5 303.2.a, 355.9.a, 356.1.b.2, 420.5, 738；S-ORIGINS Promising Future；S-RADIANCE Pending Item Target Legality |
| `ogn-117-298` | Viktor | 未解决 | OGN 仍有 `Zaun`，`ven-176-166` 仍缺少；token 入 base 文本可读。 | CR v1.5 133.8.a, 187.1, 383.1；S-GALLERY OGN/VEN |
| `ogn-119-298` | Ahri | 未解决 | OGN/VEN 特印仍有 `Ionia`，SFD 对应 printing 仍没有；attack/defend 双触发文本存在。 | CR v1.5 133.8.a, 359.3.f.2, 383.1, 479.4.b；S-GALLERY OGN/SFD/VEN |
| `ogn-121-298` | Teemo | 部分解决 | OGN 文本已与新版结构一致：先选敌方单位，再 reveal top 5、按 Hidden 计伤害并 recycle；但 OGN 仍有 `Bandle City`，SFD 对应 printing 没有。 | CR v1.5 133.8.a, 135.2.b.5.a, 355.5, 715.4, 811.1；S-ORIGINS Teemo；S-GALLERY OGN/SFD |
| `ogn-164-298` | Sett | 未解决 | OGN 仍有 `Ionia`，SFD/VEN 对应 printing 没有；OGN 仍使用 `When I'm played and when I conquer`，VEN 已是新版 `When you play me or when I conquer`。 | CR v1.5 133.8.a, 204.1.b, 357.2, 383.1, 702.2.b；S-GALLERY OGN/SFD/VEN |
| `ogn-205-298` | Yasuo | 未解决 | OGN 仍有 `Ionia`，SFD 两个对应 printing 没有；第三次移动计分文本存在。 | CR v1.5 133.8.a, 383.1, 458, 470.2, 810.1；S-GALLERY OGN/SFD |
| `ogn-235-298` | Karma | 部分解决 | OGN 已包含 `to your Main Deck` 的回收条件；但 OGN 仍有 `Ionia`，SFD/VEN 对应 printing 没有。 | CR v1.5 052, 133.8.a, 383.1, 417.1.a, 417.1.b, 817.1；S-ORIGINS Karma；S-GALLERY OGN/SFD/VEN |
| `ogn-238-298` | Leona | 未解决 | OGN 仍有 `Mount Targon`，`ven-184-166` 没有；Shield 与 stun 文本存在。 | CR v1.5 133.8.a, 424.1.b, 814.1；S-GALLERY OGN/VEN |
| `ogn-243-298` | Darius | 未解决 | OGN 仍有 `Noxus`，SFD 对应 printing 没有；Trifarian、Legion 和 ready 文本保留。 | CR v1.5 133.8.a, 359.2.c, 416.1, 479.4, 812.1；S-GALLERY OGN/SFD |
| `ogn-258-298` | Dragon's Rage | 已解决 | 已包含 `Then do this:`，并在移动后选择另一个目的地敌方单位。 | CR v1.5 355.5.b, 388.1, 389.1, 418.6.b.3, 451.1；S-ORIGINS Dragon's Rage |
| `ogn-259-298` | Unforgiven | 未解决 | OGN 仍写 `Move a friendly unit to or from its base`；分诊要求的新版来源限定尚未进入该 printing。Legend 的 `energy`/`power` 仍为 `null`。 | CR v1.5 107.1, 127.1, 204.1.b, 449.1, 449.2, 451.1；S-ORIGINS Unforgiven；S-GALLERY OGN |
| `ogs-014-024` | Lux | 未解决 | OGS 仍有 `Demacia`，`ven-sp6-006` 没有；OGS 仍写 `Use only to play spells`，VEN 已写 `Spend this Energy only to play spells`。 | CR v1.5 133.8.a, 163.1, 166.1, 430.2, 430.3, 054.2；S-GALLERY OGS/VEN |
| `ogs-020-024` | Highlander | 已解决 | 已包含 `would die`、heal、exhaust 和 recall 的新版替代文本。 | CR v1.5 391.3, 419.1, 370.1.a.1, 458, 460.1, 808.1.d.1；S-ORIGINS Highlander |
| `unl-200-219` | Mirror Image | 已解决 | 已使用 `Then do this:`，复制 Reflection token 后再变成所选单位的 copy。 | CR v1.5 388.1, 389.1, 420.3, 446.3, 816.1；Unleashed Errata |
| `unl-139-219` | Bone Skewer | 已解决 | 已使用 `If they do, then do this:`，并保留指定 battlefield、忽略全部费用和 stun。 | CR v1.5 388.1, 389.1, 420.3, 425.1, 356.1；Unleashed Errata |
| `unl-120-219` | Rengar | 已解决 | 已使用 `I can Ambush to a battlefield where there are enemy units, even if you don't have units there.`。 | CR v1.5 822.1, 822.1.c, 355.2；Unleashed Errata |
| `unl-029-219` | Red Brambleback | 部分解决 | 标准 printing 已有 `Ionia` 且完整文本可读；alternate `unl-029a-219` 仍没有标签，且仍需独立表达 Conquer effects 的重复触发。 | CR v1.5 383.4.g.2, 471.1, 805.1, 133.8；RIFT-9/S-GALLERY alternate |
| `unl-087-219` | Blue Sentinel | 部分解决 | 标准 printing 已有 `Mount Targon` 且文本可读；alternate `unl-087a-219` 仍没有标签，且仍需独立表达 Hold effects 的重复触发。 | CR v1.5 383.4.g.2, 391.2, 430.1, 471.2, 133.8；RIFT-9/S-GALLERY alternate |
| `unl-213-219` | Gardens of Becoming | 未解决 | 当前文本仍是 `Units here have ":rb_exhaust:: Gain 1 XP."`，仍保留损坏的引号/符号尾部；目标文本应为 `[Exhaust]: Gain 1 XP.`。 | CR v1.5 151.1, 415.1, 729.1, 133.6.a；官方卡图记录 |
| `unl-118-219` | Elder Dragon | 已解决 | alternate 记录当前已有 `Dragon` 与 `Demacia`；剩余的来源限定致死阈值是规则/引擎能力缺口，不再是目录数据差异。 | CR v1.5 142.4.a, 142.4.c, 143.2.b, 418.1；官方卡图记录 |
| `sfd-217-221` | Seat of Power | 未解决 | 当前文本仍以 `control..` 双句点结尾，未清理为单句点。 | CR v1.5 135.2.d.3, 414, 323.1；`deck-catalog.json` 记录 |
| `rad-167-167` | Neeko | 已解决 | 当前文本已是 `choose up to 3 different legends`；Legend Zone 与构筑边界仍属于规则实现工作。 | CR v1.5 103.1, 103.2.a, 107.4；Radiance Errata 2026-10-09: Neeko, Blending In |
| `sfd-201-221` | Chem-Baroness | 部分解决 | 主 printing 已使用 `[Add]`；同 identity 的 `sfd-249-221` 仍使用错误大小写 `[ADD]`。 | CR v1.5 135.2.c.1, 430, 323.1, 123；S-GALLERY same identity |
| `rad-127-167` | Rousing Display | 未解决 | 当前文本仍以 `instead.disa` 结尾，保留截断/污染尾部。 | CR v1.5 832, 135.2.b.5, 123；Radiance Patch Notes: Show Off |
| `rad-154-167` | Last Caress | 已解决 | 当前文本已将 `even from face down` 放在主句中，去除了旧括号位置。 | CR v1.5 135.2.d.3, 420, 801.3.a；Radiance Errata 2026-10-09: Last Caress |

## 汇总

| 状态 | 数量 |
| --- | ---: |
| 已解决 | 9 |
| 部分解决 | 6 |
| 未解决 | 16 |
| 合计 | 31 |

部分解决和未解决项仍应保持 `judge-required`/blocked 边界；这份复核没有把尚未统一的标签、勘误文本或规则语义转成可执行能力。
