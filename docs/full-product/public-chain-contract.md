# Public Chain Contract

## Wire compatibility

The public Chain card list is an optional extension of the existing
`riftbound-duel-v3-actions-1` projection. The outer projection and command
profile tags do not change. A legacy active Chain summary containing only
`active`, `itemCount`, and `pendingCount` remains valid and strict; unknown
fields remain invalid.

The server selected execution profile `public-chain-v1` records schema `4`
archives and binds `riftbound-p4-public-chain-v1` to the replay context and
protected CAS gate. Legacy-unit schema 1/2 and Spell schema 3 archives retain
their existing profile, bytes, private fingerprints, and replay checks.

## Public fields

For the public-chain profile, an active summary may contain an exact `cards`
array. Its only fields are:

```ts
{ cardId: string; controllerPlayerId: string; status: "pending" | "finalized" }
```

The array length equals `itemCount`; the number of `pending` entries equals
`pendingCount`; and every controller is a roster seat. Repeated card IDs are
valid because separate physical cards can share a printing. Array order and
count preserve those separate public entries.

The source is the server's canonical live `chainCards` joined with the
authoritative Chain item status. Physical UID, owner, chain ID, executor,
payment ID, cost proof, source epoch, hidden choices, and private capability
data are never projected. Unknown source relationships block publication
instead of being synthesized from client events or a viewer's hand.

## Client behavior

`DuelMatchBoard` renders the server supplied card ID through the public catalog
title/image resolver and displays controller and pending/finalized state. It
does not derive rules, costs, targets, or operations. Duplicate names use the
public list index for React identity and never an opaque physical UID.

## 链上费用与响应时点

玩家选择可选额外费用后再确定总费用；付款完成和卡牌确认后，才按规则进入可响应时点。符文操作成功只表示该次资源操作已完成，不表示链上卡牌已付清或已经结算。待付款项按控制者和实际卡牌实例绑定，不能借用同名卡或另一项的付款收据。

客户端的可操作牌以服务端当前窗口的 enabled actions 为准。YGO 的时点概念用于界面表达，合法性按当前 Riftbound CR v1.4 判定。等待付款、等待选择、等待对手响应和结算中的状态分别显示；不得仅根据卡面含 Reaction 就开放操作。

新 public-chain-v1（日志 schema 4）从真实 canonical 资源收据确认资源命令，重复请求复用同一确认；历史 spell-v1（schema 3）保持原日志行为以通过严格回放。选择地区的房间使用独立 regional-public-chain-v1（schema 5）固定地区、赛事当地日期及官方发售来源版本。
