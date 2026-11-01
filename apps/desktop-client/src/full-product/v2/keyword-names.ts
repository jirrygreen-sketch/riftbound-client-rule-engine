/**
 * Official zh-CN keyword names, only for keywords whose English and Chinese
 * card text were both read from the official gallery (accessed 2026-10-31):
 * https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
 *
 * - Vision → 预知: ogn-086-298 宝石巨像 "[Vision] (When you play me, look at the top card…)" / "[预知]（当你打出我时，查看主牌堆顶部的一张牌…）".
 * - Shield → 坚守: sfd-181-221 机械公敌 "Your Mechs have [Shield]." / "你的“机械”属性单位获得[坚守]。".
 * - Assault → 强攻: sfd-026-221 兰博 "Your Mechs each have [Assault]." / "你的“机械”属性单位获得[强攻]。".
 * - Ganking → 游走: sfd-007-221 晶能阻断器 "give a unit [Ganking] this turn" / "让一名单位本回合内获得[游走]".
 * - Deflect → 法盾: sfd-071-221 疾驰机械 "[Deflect] and [Ganking]" / "[法盾]和[游走]".
 * - Reaction → 反应, Repeat → 回响: sfd-182-221 危险温度 "[Reaction] … [Repeat]" / "[反应] … [回响]".
 * - Quick-Draw → 灵便, Equip → 装配: sfd-022-221 长剑 "[Quick-Draw] … [Equip]" / "[灵便] … [装配]".
 *
 * Any other keyword stays in English rather than being translated here.
 */
const OFFICIAL_KEYWORD_NAMES: Readonly<Record<string, string>> = Object.freeze({
  vision: "预知",
  shield: "坚守",
  assault: "强攻",
  ganking: "游走",
  deflect: "法盾",
  reaction: "反应",
  repeat: "回响",
  "quick-draw": "灵便",
  equip: "装配"
});

export function officialKeywordName(keyword: string): string | undefined {
  return OFFICIAL_KEYWORD_NAMES[keyword.trim().toLowerCase()];
}
