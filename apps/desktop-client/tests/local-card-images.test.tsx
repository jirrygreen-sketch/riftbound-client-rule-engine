import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  cardImagePrefetchItems,
  isOfficialCardImageUrl,
  localCardImageBridge,
  parseCardImagePrefetchProgress,
  preferLocalCardImage,
  type LocalCardImageBridge
} from "../src/net/local-card-images";
import { buildV2CardLookup } from "../src/full-product/v2/V2Playmat";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/settings/display-settings";
import { SettingsPage } from "../src/settings/SettingsPage";
import type { LocalCardImagesState } from "../src/hooks/useLocalCardImages";
import type { CatalogCard } from "../src/net/CardCatalogClient";

// RIFT-1129: the desktop shell reads official card art from its local cache
// (`rbimg` scheme); a plain browser keeps the remote URL unchanged.

const CDN = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e2113-744x1039.png?accountingTag=RB";

function fakeBridge(): LocalCardImageBridge {
  return {
    convertFileSrc: (path, protocol) => `${protocol}://localhost/${encodeURIComponent(path)}`,
    invoke: vi.fn(async () => true),
    listen: vi.fn(async () => () => undefined)
  };
}

describe("local card-image bridge", () => {
  it("is absent outside the desktop shell and leaves URLs untouched", () => {
    expect(localCardImageBridge(undefined)).toBeNull();
    expect(localCardImageBridge({})).toBeNull();
    expect(localCardImageBridge({ __TAURI__: { core: { invoke: () => undefined } } })).toBeNull();
    expect(preferLocalCardImage("sfd-026-221", CDN, CDN, null)).toBe(CDN);
  });

  it("detects the Tauri global API", () => {
    const bridge = fakeBridge();
    const scope = { __TAURI__: { core: { invoke: bridge.invoke, convertFileSrc: bridge.convertFileSrc },
      event: { listen: bridge.listen } } };
    expect(localCardImageBridge(scope)).not.toBeNull();
  });

  it("routes a printing through the local scheme, always sourcing the official CDN image", () => {
    const local = `rbimg://localhost/sfd-026-221?src=${encodeURIComponent(CDN)}`;
    expect(preferLocalCardImage("sfd-026-221", CDN, CDN, fakeBridge())).toBe(local);
    // the deck builder displays the server route in the browser, but the
    // desktop cache still downloads the official image, never the server URL
    const server = "https://rift-beta.xjerryx.com/api/card-images/sfd-026-221";
    expect(preferLocalCardImage("sfd-026-221", server, CDN, fakeBridge())).toBe(local);
    expect(preferLocalCardImage("sfd-026-221", server, CDN, null)).toBe(server);
  });

  it("only treats the official CDN over HTTPS as a download source", () => {
    expect(isOfficialCardImageUrl(CDN)).toBe(true);
    expect(isOfficialCardImageUrl("http://cmsassets.rgpub.io/a.png")).toBe(false);
    expect(isOfficialCardImageUrl("https://cmsassets.rgpub.io:8443/a.png")).toBe(false);
    expect(isOfficialCardImageUrl("https://cmsassets.rgpub.io.evil.example/a.png")).toBe(false);
    expect(isOfficialCardImageUrl("https://user:pw@cmsassets.rgpub.io/a.png")).toBe(false);
    expect(isOfficialCardImageUrl("https://evil.example/api/card-images/sfd-026-221")).toBe(false);
    expect(isOfficialCardImageUrl("not a url")).toBe(false);
    expect(isOfficialCardImageUrl(null)).toBe(false);
  });

  it("keeps the display URL for unusable ids or without an official image", () => {
    const bridge = fakeBridge();
    const server = "https://rift-beta.xjerryx.com/api/card-images/sfd-026-221";
    expect(preferLocalCardImage("../etc", CDN, CDN, bridge)).toBe(CDN);
    expect(preferLocalCardImage("bad/id", CDN, CDN, bridge)).toBe(CDN);
    expect(preferLocalCardImage("sfd-026-221", server, null, bridge)).toBe(server);
    expect(preferLocalCardImage("sfd-026-221", server, "https://evil.example/a.png", bridge)).toBe(server);
    expect(preferLocalCardImage("sfd-026-221", null, null, bridge)).toBeNull();
  });

  it("prefetches each catalog printing once, from its official image", () => {
    expect(cardImagePrefetchItems([
      { id: "sfd-026-221", imageUrl: CDN },
      { id: "sfd-026-221", imageUrl: "https://cmsassets.rgpub.io/other.png" },
      { id: "sfd-110-221", imageUrl: null },
      { id: "../bad", imageUrl: CDN },
      { id: "sfd-200-221", imageUrl: "https://evil.example/a.png" },
      { id: "ogn-007-298", imageUrl: "https://cmsassets.rgpub.io/rune.png" }
    ])).toEqual([
      { id: "sfd-026-221", url: CDN },
      { id: "ogn-007-298", url: "https://cmsassets.rgpub.io/rune.png" }
    ]);
  });

  it("accepts only well-formed progress events", () => {
    const progress = { total: 1408, cached: 352, failed: 1, running: true, cancelled: false };
    expect(parseCardImagePrefetchProgress(progress)).toEqual(progress);
    expect(parseCardImagePrefetchProgress({ ...progress, cached: -1 })).toBeNull();
    expect(parseCardImagePrefetchProgress({ ...progress, running: "yes" })).toBeNull();
    expect(parseCardImagePrefetchProgress(null)).toBeNull();
  });

  it("keeps the playmat on remote URLs in the browser build", () => {
    const card = {
      id: "sfd-026-221", canonicalCardId: "canonical-rumble", name: "Rumble", fullName: "Rumble", cardType: "Unit",
      domains: ["Fury"], tags: [], setCode: "SFD", cardNumber: "026", variant: "standard", imageUrl: CDN,
      energy: 4, power: null, might: 4, ability: ""
    } as CatalogCard;
    const lookup = buildV2CardLookup([card]);
    expect(lookup.imageById.get("sfd-026-221")).toBe(CDN);
    expect(lookup.imageById.get("canonical-rumble")).toBe(CDN);
  });
});

describe("settings page local card-image card", () => {
  function state(patch: Partial<LocalCardImagesState> = {}): LocalCardImagesState {
    return { supported: true, progress: null, error: null, pause: vi.fn(), resume: vi.fn(), ...patch };
  }
  const render = (localCardImages?: LocalCardImagesState) => renderToStaticMarkup(
    <SettingsPage settings={DEFAULT_DISPLAY_SETTINGS} onChange={vi.fn()} localCardImages={localCardImages} />
  );

  it("is hidden in the browser build", () => {
    expect(render()).not.toContain("本地卡图");
    expect(render(state({ supported: false }))).not.toContain("本地卡图");
  });

  it("shows download progress with a pause control while running", () => {
    const html = render(state({ progress: { total: 1408, cached: 352, failed: 0, running: true, cancelled: false } }));
    expect(html).toContain("本地卡图");
    expect(html).toContain("已下载 352 / 1408 张");
    expect(html).toContain('max="1408"');
    expect(html).toContain(">暂停下载</button>");
  });

  it("offers resume after a pause or failures and nothing once complete", () => {
    const paused = render(state({ progress: { total: 10, cached: 4, failed: 2, running: false, cancelled: true } }));
    expect(paused).toContain("失败 2 张");
    expect(paused).toContain("已暂停");
    expect(paused).toContain(">继续下载</button>");
    const done = render(state({ progress: { total: 10, cached: 10, failed: 0, running: false, cancelled: false } }));
    expect(done).toContain("全部卡图已保存在本机");
    expect(done).not.toContain("</button>");
  });
});
