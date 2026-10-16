import { describe, expect, it } from 'vitest';
import { loadCardCatalogRuntime } from '../src/card-catalog.js';
import { bindConstructedRegion, catalogForConstructedRegion, CONSTRUCTED_RELEASE_SCHEDULE,
  validateRegionalCatalogDeck } from '../src/constructed-regional-context.js';
import { evaluateRegionalSetAvailability } from '../src/constructed-regional-availability.js';
import { GameRoom } from '../src/room.js';
import { DUEL_RULESET_ID } from '@riftbound/protocol';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from './duel/fixtures/setup-adapter-catalog.js';

describe('trusted per-room regional policy and launch source pin', () => {
  it('uses different CN and ROW release days and keeps unknown facts closed', () => {
    const query=(regionCode:string,setCode:string,eventDate:string)=>evaluateRegionalSetAvailability({regionCode,setCode,eventDate},CONSTRUCTED_RELEASE_SCHEDULE);
    expect(query('CN','sfd','2026-01-01').status).toBe('available');
    expect(query('ROW','sfd','2026-01-01').status).toBe('unreleased');
    expect(query('ROW','sfd','2026-02-13').status).toBe('available');
    expect(query('CN','ogn','2026-10-14').status).toBe('unknown');
    expect(query('FR','ven','2026-10-14').status).toBe('unknown');
    expect(query('ROW','rad','2026-10-16').status).toBe('unreleased');
    expect(query('ROW','rad','2026-10-23').status).toBe('available');
    expect(()=>bindConstructedRegion({regionCode:'ROW',eventDate:'2026-02-30'})).toThrow();
    expect(()=>bindConstructedRegion({regionCode:'FR',eventDate:'2026-10-14'})).toThrow();
  });
  it('isolates effective policy from the original catalog and preserves structural/ban/domain checks', async () => {
    const catalog=await loadCardCatalogRuntime({catalog:setupAdapterFixtureCatalog,constructedPolicy:{asOf:'2026-10-14'}});
    const original=structuredClone(catalog.constructedRules.policy);
    const row=bindConstructedRegion({regionCode:'ROW',eventDate:'2026-10-14'});
    const cn=bindConstructedRegion({regionCode:'CN',eventDate:'2026-10-14'});
    expect(validateRegionalCatalogDeck(catalog,setupAdapterFixtureDecks.a.submission,row).valid).toBe(true);
    const blocked=validateRegionalCatalogDeck(catalog,setupAdapterFixtureDecks.a.submission,cn);
    expect(blocked.valid).toBe(false);
    expect(blocked.issues.some(issue=>issue.code==='regional_availability_unconfirmed')).toBe(true);
    expect(validateRegionalCatalogDeck(catalog,{...setupAdapterFixtureDecks.a.submission,runes:[]},row).valid).toBe(false);
    expect(catalogForConstructedRegion(catalog,row).constructedRules).not.toBe(catalog.constructedRules);
    expect(catalog.constructedRules.policy).toEqual(original);
  });
  it('preserves region/date/source versions in a waiting room and refuses forged source versions', async () => {
    const catalog=await loadCardCatalogRuntime({catalog:setupAdapterFixtureCatalog,constructedPolicy:{asOf:'2026-10-14'}});
    const context=bindConstructedRegion({regionCode:'ROW',eventDate:'2026-10-14'});
    const room=new GameRoom('region-pending-room',DUEL_RULESET_ID,catalog,()=>0,'p4',context);
    room.join('Alice',()=>{},'region-A');
    expect(room.roomView().constructedRegion).toEqual(context);
    const archive=room.exportArchive();
    expect(GameRoom.restore(archive,catalog).roomView().constructedRegion).toEqual(context);
    expect(()=>GameRoom.restore({...archive,constructedRegion:{...context,scheduleDigest:`sha256:${'0'.repeat(64)}`}},catalog)).toThrow(/版本|region/i);
    expect(()=>room.restoreArchive({...archive,constructedRegion:{...context,regionCode:'CN'}})).toThrow(/different room/);
  });
});
