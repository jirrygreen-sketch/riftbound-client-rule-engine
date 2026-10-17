# Judge coverage report

Generated from the card-dsl generated registry. Counts use canonical card identities.

- Total canonical programs: **1080**
- Executable: **91**
- Judge-required: **973**
- No ability: **16**
- Coverage (executable / all canonical): **8.43%**
- Coverage (executable / canonical identities with ability): **8.55%**
- Judge-required cards needing manual classification: **0**

The registry does not currently expose card type metadata. The card-type table therefore reports `unknown` until that field is added to the CardProgram contract.

## By set

| 分组 | canonical | executable | judge-required | no-ability | 覆盖率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ogn | 298 | 43 | 241 | 14 | 14.43% |
| ogs | 24 | 5 | 19 | 0 | 20.83% |
| rad | 147 | 6 | 141 | 0 | 4.08% |
| sfd | 219 | 25 | 194 | 0 | 11.42% |
| unl | 225 | 9 | 215 | 1 | 4% |
| ven | 167 | 3 | 163 | 1 | 1.80% |

## By card type

| 分组 | canonical | executable | judge-required | no-ability | 覆盖率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| unknown | 1080 | 91 | 973 | 16 | 8.43% |

## Top 15 missing dependencies

Sorted by the number of affected canonical identities. A card can occur in multiple dependency rows when its reason names multiple gaps.

| Rank | Dependency | Kind | Canonical cards | Sets |
| ---: | --- | --- | ---: | --- |
| 1 | `RIFT-91` | task | 327 | ogn, ogs, rad, sfd, unl, ven |
| 2 | `RIFT-89` | task | 284 | ogn, ogs, rad, sfd, unl, ven |
| 3 | `RIFT-257` | task | 234 | ogn, rad, sfd, unl, ven |
| 4 | `RIFT-120` | task | 213 | ogn, ogs, rad, sfd, unl, ven |
| 5 | `RIFT-90` | task | 198 | ogn, ogs, rad, sfd, unl, ven |
| 6 | `continuous.might` | op | 192 | ogn, ogs, rad, sfd, unl, ven |
| 7 | `RIFT-9` | task | 127 | ogn, ogs, rad, sfd, unl, ven |
| 8 | `RIFT-261` | task | 126 | ogn, rad, sfd, unl, ven |
| 9 | `cost.pay` | op | 117 | ogn, rad, sfd, unl, ven |
| 10 | `effect.buff` | op | 115 | ogn, ogs, rad, sfd, unl, ven |
| 11 | `effect.ready` | op | 90 | ogn, ogs, rad, sfd, unl, ven |
| 12 | `cost.modify` | op | 86 | ogn, rad, sfd, unl, ven |
| 13 | `effect.token` | op | 85 | ogn, ogs, rad, sfd, unl, ven |
| 14 | `effect.draw` | op | 81 | ogn, ogs, rad, sfd, unl, ven |
| 15 | `effect.move` | op | 78 | ogn, ogs, rad, sfd, unl, ven |

## Manual classification

**0** canonical identities have a judge-required status but no parseable dependency clue. Their IDs are retained in report.json for follow-up review.

