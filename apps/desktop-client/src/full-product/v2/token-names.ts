/**
 * Official zh-CN names used by token-creating card text.
 *
 * Source (accessed 2026-10-29):
 * https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
 *
 * Recruit:
 * - English: ogn-211-298 Faithful Manufactor — "play a 1 :rb_might: Recruit
 *   unit token here."
 * - Chinese: ogn-211-298 忠实的工坊主 — "在此处额外打出一名1:rb_might:的“随从”。"
 * - Supporting citations: ogn-218-298 Vanguard Captain → 先锋队长 ("两名1
 *   :rb_might:的“随从”"); sfd-168-221 Vanguard Armory → 先锋军备
 *   ("三名1:rb_might:的“随从”").
 *
 * Sand Soldier:
 * - English: sfd-157-221 Royal Guard — "play a 2 :rb_might: Sand Soldier
 *   unit token here."
 * - Chinese: sfd-157-221 皇家守卫 — "在此处打出一名2:rb_might:的“黄沙士兵”。"
 * - Supporting citation: sfd-207-221 Emperor's Dais → 帝王神坛 ("2:rb_might:
 *   的“黄沙士兵”").
 *
 * Mech:
 * - English: sfd-076-221 Production Surge — "Play a 3 :rb_might: Mech unit
 *   token to your base."
 * - Chinese: sfd-076-221 产量激增 — "打出一名3:rb_might:的“机器人”到你的基地。"
 * - The quoted English and Chinese clauses on sfd-076-221 provide the explicit
 *   Mech → 机器人 pairing. rad-022-167 旋转陀螺机 also uses “机器人”.
 *
 * Gold:
 * - English: sfd-004-221 Bushwhack — "Play a Gold gear token exhausted."
 * - Chinese: sfd-004-221 丛林伏击 — "打出一个休眠的“金币”装备指示物。"
 * - The token definition itself is sfd-t03, whose official Chinese card name
 *   is “金币”; rad-022-167 also says “金币”装备指示物.
 *
 * Bomb:
 * - English: rad-001-167 Amateur Demolitionist — "play a Bomb gear token to a
 *   battlefield."
 * - Chinese: rad-001-167 业余爆破狂 — "将一个“炸弹”装备指示物打出到一处战场。"
 *
 * Reflection:
 * - English: unl-199-219 Deceiver — "play a ready Reflection unit token there."
 * - Chinese: unl-199-219 诡术妖姬 — "在该处打出一名处于活跃状态的“映像”。"
 *
 * Bird:
 * - English: unl-088-219 Gutter Palace — "Play a 1 :rb_might: Bird unit token
 *   with [Deflect]."
 * - Chinese: unl-088-219 倾颓宫殿 — "打出一名1:rb_might:的“战鹰”，它拥有[法盾]。"
 *
 * Shadow Clone:
 * - English: ven-023a-166 Zed — "play a 0 :rb_might: Shadow Clone unit token."
 * - Chinese: ven-023a-166 劫 — "则打出一名0:rb_might:的“影分身”。"
 *
 * Tentacle:
 * - English: ven-109-166 Illaoi — "play a ... Tentacle unit token from
 *   Bilgewater."
 * - Chinese: ven-109-166 俄洛伊 — "打出一名具有“比尔吉沃特”属性的1:rb_might:
 *   “触手”。"
 *
 * Sprite:
 * - English: unl-230-219 Bashful Bloom — "Play a ready 3 :rb_might: Sprite token with
 *   [Temporary]."
 * - Chinese: unl-230-219 含羞蓓蕾 — "打出一名处于活跃状态的3:rb_might:“精灵”，它拥有[瞬息]。"
 *
 * Brush:
 * - English: unl-195-219 Green Father — "replace that battlefield with a Brush
 *   battlefield token."
 * - Chinese: unl-195-219 翠神 — "将该战场替换为一个“草丛”战场指示物。"
 *
 * Baron Pit:
 * - English: unl-147-219 Baron Nashor — "add a Baron Pit battlefield token to
 *   the board."
 * - Chinese: unl-147-219 纳什男爵 — "将一个“男爵巢穴”战场指示物添置到场上。"
 *
 * Guards! (sfd-154-221) and Arise! (sfd-198-221) contain English card text in
 * the official zh_CN gallery. The token names above come only from other cards'
 * official Chinese text; neither spell name is translated here.
 */
export const OFFICIAL_TOKEN_NAMES = {
  Recruit: "随从",
  "Recruit (DE)": "随从",
  "Recruit (NX)": "随从",
  "Recruit (ZN)": "随从",
  "Sand Soldier": "黄沙士兵",
  Mech: "机器人",
  Sprite: "精灵",
  Gold: "金币",
  Bomb: "炸弹",
  Reflection: "映像",
  Bird: "战鹰",
  "Shadow Clone": "影分身",
  Tentacle: "触手",
  Brush: "草丛",
  "Baron Pit": "男爵巢穴"
} as const satisfies Readonly<Record<string, string>>;

export type OfficialTokenName = keyof typeof OFFICIAL_TOKEN_NAMES;

/** Return only a name attested in official zh-CN card text; otherwise undefined. */
export function officialTokenName(englishName: string | undefined): string | undefined {
  if (englishName === undefined) return undefined;
  return OFFICIAL_TOKEN_NAMES[englishName as OfficialTokenName];
}
