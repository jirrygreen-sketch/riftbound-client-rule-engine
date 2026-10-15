import { isConstructedRegionSelection, type ConstructedRegionContext, type ConstructedRegionSelection } from '@riftbound/protocol';
import type { CardCatalogRuntime } from './card-catalog.js';
import { evaluateRegionalSetAvailability, type RegionalSchedule } from './constructed-regional-availability.js';
import { validateConstructedDeck, cardTypeZoneMaxCopies } from './constructed-policy.js';
import type { DeckSubmission } from './deck-validation.js';

/** Event regions, independent of printing language. Missing launch facts stay unknown. */
export const CONSTRUCTED_REGION_OPTIONS = Object.freeze([
  Object.freeze({regionCode:'CN',label:'中国大陆'}),
  Object.freeze({regionCode:'ROW',label:'中国大陆以外地区'})
]);
export const CONSTRUCTED_REGIONAL_POLICY_VERSION = 'regional-constructed-v1' as const;
export const CONSTRUCTED_RELEASE_SCHEDULE_VERSION = 'official-launch-schedule-20261014-v1' as const;
export const CONSTRUCTED_RELEASE_SCHEDULE: RegionalSchedule = Object.freeze(([
  {
    "regionCode": "CN",
    "setCode": "ogn",
    "releaseDate": null,
    "sourceUrl": null,
    "status": "unknown"
  },
  {
    "regionCode": "ROW",
    "setCode": "ogn",
    "releaseDate": "2025-10-31",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/how-to-buy-riftbound/",
    "status": "confirmed"
  },
  {
    "regionCode": "CN",
    "setCode": "ogs",
    "releaseDate": null,
    "sourceUrl": null,
    "status": "unknown"
  },
  {
    "regionCode": "ROW",
    "setCode": "ogs",
    "releaseDate": "2025-10-31",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/how-to-buy-riftbound/",
    "status": "confirmed"
  },
  {
    "regionCode": "CN",
    "setCode": "sfd",
    "releaseDate": "2025-12-12",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/recap-of-our-pax-unplugged-panel/",
    "status": "confirmed"
  },
  {
    "regionCode": "ROW",
    "setCode": "sfd",
    "releaseDate": "2026-02-13",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/recap-of-our-pax-unplugged-panel/",
    "status": "confirmed"
  },
  {
    "regionCode": "CN",
    "setCode": "unl",
    "releaseDate": "2026-04-10",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/the-unleashed-overview/",
    "status": "confirmed"
  },
  {
    "regionCode": "ROW",
    "setCode": "unl",
    "releaseDate": "2026-05-08",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/the-unleashed-overview/",
    "status": "confirmed"
  },
  {
    "regionCode": "CN",
    "setCode": "ven",
    "releaseDate": "2026-07-31",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/the-vendetta-overview/",
    "status": "confirmed"
  },
  {
    "regionCode": "ROW",
    "setCode": "ven",
    "releaseDate": "2026-07-31",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/the-vendetta-overview/",
    "status": "confirmed"
  },
  {
    "regionCode": "CN",
    "setCode": "rad",
    "releaseDate": "2026-10-23",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/products-and-sets-into-2027/",
    "status": "confirmed"
  },
  {
    "regionCode": "ROW",
    "setCode": "rad",
    "releaseDate": "2026-10-23",
    "sourceUrl": "https://playriftbound.com/en-us/news/announcements/products-and-sets-into-2027/",
    "status": "confirmed"
  }
] as const).map(row => Object.freeze(row)));
export const CONSTRUCTED_RELEASE_SCHEDULE_DIGEST = 'sha256:8b20486766e8cbb0bed49ecf8074885413c175911b4038b32d88ab6fbcb75fe3' as const;

export function bindConstructedRegion(selection: ConstructedRegionSelection): ConstructedRegionContext {
  if (!isConstructedRegionSelection(selection) || !CONSTRUCTED_REGION_OPTIONS.some(option=>option.regionCode===selection.regionCode))
    throw new TypeError('请选择支持的赛事地区并填写有效的当地日期');
  return Object.freeze({...selection, policyVersion:CONSTRUCTED_REGIONAL_POLICY_VERSION,
    scheduleVersion:CONSTRUCTED_RELEASE_SCHEDULE_VERSION,scheduleDigest:CONSTRUCTED_RELEASE_SCHEDULE_DIGEST});
}
export function verifyConstructedRegion(context: ConstructedRegionContext): ConstructedRegionContext {
  const expected=bindConstructedRegion({regionCode:context.regionCode,eventDate:context.eventDate});
  if (context.policyVersion!==expected.policyVersion || context.scheduleVersion!==expected.scheduleVersion ||
      context.scheduleDigest!==expected.scheduleDigest) throw new TypeError('地区发售来源版本不匹配');
  return expected;
}
/** Create an isolated effective catalog policy. The original catalog and old replay bytes are untouched. */
export function catalogForConstructedRegion(catalog: CardCatalogRuntime, rawContext: ConstructedRegionContext): CardCatalogRuntime {
  const context=verifyConstructedRegion(rawContext);
  const printingPolicies={...catalog.constructedRules.policy.printingPolicies};
  const cardPolicies={...catalog.constructedRules.policy.cardPolicies};
  const definitions=new Map(catalog.publicCatalog.cards.map(card=>[card.id,card]));
  for(const [cardId,old] of Object.entries(printingPolicies)) {
    if(old.status==='banned' || old.status==='notStandard') continue;
    const card=definitions.get(cardId); if(!card) throw new TypeError('地区校验缺少源印次');
    const regional=evaluateRegionalSetAvailability({regionCode:context.regionCode,setCode:card.setCode,eventDate:context.eventDate},CONSTRUCTED_RELEASE_SCHEDULE);
    printingPolicies[cardId]={...old,available:regional.status==='available',status:regional.status==='available'?'available':'previewNotReleased'};
  }
  for(const [canonicalId,old] of Object.entries(cardPolicies)) {
    if(old.status==='banned' || old.status==='notStandard') continue;
    const available=catalog.publicCatalog.cards.some(card=>card.canonicalCardId===canonicalId && printingPolicies[card.id]?.available);
    cardPolicies[canonicalId]={...old,status:available?'legal':'unreleased',maxCopies:available?(old.maxCopies||cardTypeZoneMaxCopies(catalog.publicCatalog.cards.find(card=>card.canonicalCardId===canonicalId)!.cardType)):0};
  }
  const policy={...catalog.constructedRules.policy,checkedAt:context.eventDate,
    policyScope:`${CONSTRUCTED_REGIONAL_POLICY_VERSION}:${context.regionCode}:${context.scheduleVersion}:${context.scheduleDigest}`,
    printingPolicies,cardPolicies};
  const cards=catalog.publicCatalog.cards.map(card=>{
    const printing=printingPolicies[card.id]; const canonical=cardPolicies[card.canonicalCardId];
    const availability=evaluateRegionalSetAvailability({regionCode:context.regionCode,setCode:card.setCode,eventDate:context.eventDate},CONSTRUCTED_RELEASE_SCHEDULE);
    return {...card,available:printing?.available ?? false,maxCopies:canonical?.maxCopies ?? card.maxCopies,
      availabilityReason:printing?.status==='banned'?'该卡牌已被禁用':printing?.status==='notStandard'?'该系列不属于当前标准构筑':
        availability.status==='available'?'':availability.status==='unknown'?'该地区发售日期尚未确认':`该地区将于 ${availability.releaseDate} 发售`};
  });
  const publicCatalog={...catalog.publicCatalog,cards,policy};
  return Object.freeze({...catalog,publicCatalog,publicCatalogJson:`${JSON.stringify(publicCatalog)}\n`,constructedRules:{...catalog.constructedRules,policy}});
}
export function validateRegionalCatalogDeck(catalog: CardCatalogRuntime,deck: DeckSubmission,context: ConstructedRegionContext) {
  const regional=catalogForConstructedRegion(catalog,context);
  const result=validateConstructedDeck(deck,regional.validationCards,regional.constructedRules);
  const issues=[...result.issues];
  for(const zone of ['mainDeck','runes','legend','champion','battlefields','sideboard'] as const) {
    for(const entry of deck[zone]??[]) {
      const card=catalog.publicCatalog.cards.find(card=>card.id===entry.cardId);
      if(!card) continue; // The base validator already rejects unknown printings.
      const availability=evaluateRegionalSetAvailability({regionCode:context.regionCode,setCode:card.setCode,eventDate:context.eventDate},CONSTRUCTED_RELEASE_SCHEDULE);
      if(availability.status!=='available') issues.push({code:'regional_availability_unconfirmed',zone,cardId:card.id,
        message:availability.status==='unknown'?`卡牌 ${card.fullName} 在该地区的发售日期尚未确认`:`卡牌 ${card.fullName} 在该地区尚未发售（${availability.releaseDate}）`});
    }
  }
  return {...result,valid:result.valid && issues.length===0,issues};
}
