#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  applyReviewedTagCorrections
} from "./reviewed-card-tags.mjs";
import {
  buildErrataIndex,
  errataAuditReport,
  galleryTokenVocabulary
} from "./errata.mjs";

export const DEFAULT_SNAPSHOT_PATH = fileURLToPath(
  new URL("../dist/cards.json", import.meta.url)
);
export const DEFAULT_OUTPUT_PATH = fileURLToPath(
  new URL("../data/deck-catalog.json", import.meta.url)
);

const SAFE_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const OFFICIAL_NAME_RULES = [
  "CR 132.3",
  "CR 132.4",
  "TR 601.2.a"
];
const LOCALIZED_STATUSES = new Set([
  "official-structured",
  "official-accessibility-supplemented",
  "english-fallback",
  "no-effect",
  "missing"
]);
const LOCALIZED_ABILITY_FIELDS = new Set([
  "cardId",
  "rulesTextHtml",
  "effectTextHtml",
  "accessibilityText",
  "sourceUrl",
  "sourceUpdatedAt",
  "syncedAt",
  "sourceLocale",
  "status"
]);
const LOCALIZED_SUPPLEMENT_FIELD = "accessibilityRulesText";
const KNOWN_GALLERY_TOKEN_PATTERN =
  /^:rb_(?:energy_[0-8]|might|exhaust|rune_(?:fury|calm|mind|body|chaos|order|rainbow)):$/u;
const GALLERY_TOKEN_PATTERN = /:rb_[a-z0-9_]+:/gu;
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const LOCALIZED_COVERAGE_FIELDS = new Set([
  "catalogPrintings",
  "effectPrintings",
  "officialStructured",
  "officialAccessibilitySupplemented",
  "displayableChinese",
  "englishFallback",
  "missing",
  "noEffect",
  "ids",
  "sets"
]);

const usage = `Usage:
  node scripts/build-deck-catalog.mjs [options]

Builds the client/server-safe deck catalog from a current cards snapshot.

Card errata are resolved from the snapshot's own annotations against each
printing's official gallery text. A printing whose printed notation cannot be
reproduced exactly keeps its printed text (and is then classified
\`judge-required\` by the effect compiler).

Options:
  --snapshot <file>     Snapshot file. Default: dist/cards.json in this
                        package.
  --output <file>       Catalog output file. Default: data/deck-catalog.json
                        in this package.
  --data-version <id>   Override the snapshot-derived data version.
  --dry-run             Build and validate without writing the catalog.
  -h, --help            Show this help.

The output contains only public catalog fields and identity provenance. Raw
official/community records are never embedded in the catalog.
`;

export class BuildDeckCatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildDeckCatalogError";
  }
}

export function parseArguments(argv) {
  const options = {
    snapshot: undefined,
    output: undefined,
    dataVersion: undefined,
    dryRun: false,
    help: false
  };

  function value(index, optionName) {
    const argument = argv[index];
    const prefix = `${optionName}=`;
    if (argument.startsWith(prefix)) {
      return { value: argument.slice(prefix.length), nextIndex: index };
    }
    const next = argv[index + 1];
    if (next === undefined || next === "-h" || next.startsWith("--")) {
      throw new BuildDeckCatalogError(`${optionName} requires a value`);
    }
    return { value: next, nextIndex: index + 1 };
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (
      argument === "--snapshot" ||
      argument.startsWith("--snapshot=")
    ) {
      const result = value(index, "--snapshot");
      if (result.value.trim() === "") {
        throw new BuildDeckCatalogError("--snapshot requires a file path");
      }
      options.snapshot = result.value;
      index = result.nextIndex;
    } else if (argument === "--output" || argument.startsWith("--output=")) {
      const result = value(index, "--output");
      if (result.value.trim() === "") {
        throw new BuildDeckCatalogError("--output requires a file path");
      }
      options.output = result.value;
      index = result.nextIndex;
    } else if (
      argument === "--data-version" ||
      argument.startsWith("--data-version=")
    ) {
      const result = value(index, "--data-version");
      if (result.value.trim() === "") {
        throw new BuildDeckCatalogError("--data-version requires a value");
      }
      options.dataVersion = result.value;
      index = result.nextIndex;
    } else {
      throw new BuildDeckCatalogError(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export function resolveSnapshotPath(snapshot) {
  return path.resolve(
    process.cwd(),
    snapshot ?? DEFAULT_SNAPSHOT_PATH
  );
}

export function resolveOutputPath(output) {
  return path.resolve(
    process.cwd(),
    output ?? DEFAULT_OUTPUT_PATH
  );
}

function isRecord(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function text(value, maximumLength, field) {
  if (typeof value !== "string" ||
      value.length === 0 ||
      value.length > maximumLength ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BuildDeckCatalogError(`${field} is not valid public text`);
  }
  return value.normalize("NFC");
}

function optionalText(value, maximumLength, field) {
  return value === undefined || value === null
    ? undefined
    : text(value, maximumLength, field);
}

function safeId(value, field) {
  const id = text(value, 128, field);
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new BuildDeckCatalogError(`${field} is not a safe id: ${id}`);
  }
  return id;
}

function numberOrNull(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 999) {
    throw new BuildDeckCatalogError(`${field} must be null or 0-999`);
  }
  return value;
}

function httpsUrlOrNull(value, field) {
  if (value === undefined || value === null) return null;
  const url = text(value, 2048, field);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new BuildDeckCatalogError(`${field} must be an HTTPS URL or null`);
  }
  if (parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "") {
    throw new BuildDeckCatalogError(`${field} must be an HTTPS URL or null`);
  }
  return url;
}

function stringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new BuildDeckCatalogError(`${field} must be an array of strings`);
  }
  return value.map((item, index) =>
    text(item, 128, `${field}[${index}]`)
  );
}

function abilityText(value, field) {
  if (typeof value !== "string" || value.length > 4096) {
    throw new BuildDeckCatalogError(`${field} must be a string of at most 4096 characters`);
  }
  const normalized = value.replace(/\r\n?/g, "\n");
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(normalized)) {
    throw new BuildDeckCatalogError(`${field} contains invalid control characters`);
  }
  return normalized;
}

function htmlText(value) {
  if (typeof value !== "string") return "";
  return abilityText(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, "\n\n"),
    "ability"
  ).trim();
}

function containHtmlText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function classifiedLocalizedText(englishCard, chineseCard, cardId) {
  const status = classifyLocalizedText(englishCard, chineseCard, cardId);
  const noTextSentinel = /^\[NO TEXT\]$/u.test(
    containHtmlText(galleryBody(englishCard, "rulesText", cardId))
  );
  return noTextSentinel ? "official-structured" : status;
}

function hasHan(value) {
  return typeof value === "string" && HAN_PATTERN.test(htmlText(value));
}

function galleryBody(card, field, cardId) {
  const source = field === "rulesText" ? card?.text : card?.effect;
  const value = source?.richText?.body;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BuildDeckCatalogError(
      `Official localized ${field} for ${cardId} must be a string or null`
    );
  }
  return abilityText(value, `localizedTexts.${field}.${cardId}`);
}

function accessibilityText(card, cardId) {
  const value = card?.cardImage?.accessibilityText;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BuildDeckCatalogError(
      `Official accessibilityText for ${cardId} must be a string or null`
    );
  }
  return abilityText(value, `localizedTexts.accessibilityText.${cardId}`);
}

function assertGalleryBodyShape(card, cardId) {
  for (const [container, value] of [
    ["text", card?.text],
    ["effect", card?.effect]
  ]) {
    if (value === undefined || value === null) continue;
    if (!isRecord(value) ||
        value.richText === undefined ||
        !isRecord(value.richText) ||
        !Object.hasOwn(value.richText, "body")) {
      throw new BuildDeckCatalogError(
        `Official ${container} for ${cardId} has a malformed richText body`
      );
    }
    galleryBody(card, container === "text" ? "rulesText" : "effectText", cardId);
  }
}

function assertKnownGalleryTokens(value, field, cardId) {
  if (typeof value !== "string") return;
  for (const token of value.match(GALLERY_TOKEN_PATTERN) ?? []) {
    if (!KNOWN_GALLERY_TOKEN_PATTERN.test(token)) {
      throw new BuildDeckCatalogError(
        `${field} for ${cardId} contains unknown gallery token ${token}`
      );
    }
  }
}

function normalizedLocalizedSource(source, label) {
  if (!isRecord(source)) {
    throw new BuildDeckCatalogError(`${label} must be an official gallery object`);
  }
  const sourceUrl = httpsUrlOrNull(source.url, `${label}.url`);
  if (sourceUrl === null) {
    throw new BuildDeckCatalogError(`${label}.url must be an HTTPS URL`);
  }
  const sourceUpdatedAt = optionalText(
    source.resultsUpdatedAt,
    128,
    `${label}.resultsUpdatedAt`
  );
  if (sourceUpdatedAt === undefined) {
    throw new BuildDeckCatalogError(
      `${label}.resultsUpdatedAt must be present for localized text provenance`
    );
  }
  if (!Array.isArray(source.cards)) {
    throw new BuildDeckCatalogError(`${label}.cards must be an array`);
  }
  const parsedTimestamp = Date.parse(sourceUpdatedAt);
  if (!Number.isFinite(parsedTimestamp)) {
    throw new BuildDeckCatalogError(
      `${label}.resultsUpdatedAt must be an ISO timestamp`
    );
  }
  return { sourceUrl, sourceUpdatedAt };
}

function blankBody(value) {
  return value === null || value === undefined || value.trim() === "";
}

/**
 * Strictly extracts a Rules Text fragment from the official accessibility
 * string for an empty-text Gear record. The English printing must itself carry
 * an Equip rule and expose exactly one rune symbol, which is the only context
 * in which the accessibility placeholder `[C]` has an unambiguous meaning.
 */
function accessibilityRulesSupplement(englishCard, chineseCard, cardId) {
  if (!isRecord(englishCard) || !isRecord(chineseCard)) return null;
  const chineseRules = galleryBody(chineseCard, "rulesText", cardId);
  const chineseEffect = galleryBody(chineseCard, "effectText", cardId);
  if (!blankBody(chineseRules) || !blankBody(chineseEffect)) return null;

  const name = chineseCard.name;
  if (typeof name !== "string" || name.trim() === "") return null;
  const mainTypes = (chineseCard.cardType?.type ?? [])
    .map((entry) => entry?.label)
    .filter((value) => typeof value === "string" && value !== "");
  if (!mainTypes.includes("Gear")) return null;

  const accessibility = accessibilityText(chineseCard, cardId);
  if (accessibility === null || accessibility === "") return null;
  const prefixes = mainTypes
    .map((type) => `Riftbound ${type}: ${name}. `)
    .filter((prefix) => accessibility.startsWith(prefix));
  if (prefixes.length !== 1) return null;
  const tail = accessibility.slice(prefixes[0].length).trim();
  const strictEquipShape =
    /^\[装配\](?:\[(?:[0-8]|C)\])+（支付(?:\[(?:[0-8]|C)\])+(?:和(?:\[(?:[0-8]|C)\])+)?：将此牌贴附到你控制的一名单位上。）$/u;
  if (!strictEquipShape.test(tail)) return null;
  const anniversaryTokens = tail.match(/\[(?:[0-8]|C)\]/gu) ?? [];
  if (anniversaryTokens.filter((token) => token === "[C]").length !== 2) {
    return null;
  }

  const englishRules = galleryBody(englishCard, "rulesText", cardId);
  if (englishRules === null || !/\[Equip\]/u.test(htmlText(englishRules))) {
    return null;
  }
  const runeTokens = htmlText(englishRules)
    .match(/:rb_rune_(?:fury|calm|mind|body|chaos|order|rainbow):/gu) ?? [];
  const distinctRunes = [...new Set(runeTokens)];
  if (distinctRunes.length !== 1 || distinctRunes[0] === ":rb_rune_rainbow:") {
    return null;
  }
  const energyCosts = htmlText(englishRules)
    .match(/:rb_energy_[0-8]:/gu) ?? [];
  const englishEnergyCosts = new Set(energyCosts);
  const accessibilityEnergyCosts = new Set(
    anniversaryTokens
      .map((token) => token.slice(1, -1))
      .filter((token) => /^[0-8]$/u.test(token))
      .map((token) => `:rb_energy_${token}:`)
  );
  if (englishEnergyCosts.size > 1 ||
      englishEnergyCosts.size !== accessibilityEnergyCosts.size ||
      [...accessibilityEnergyCosts].some(
        (token) => !englishEnergyCosts.has(token)
      )) {
    return null;
  }

  // The accessibility string does not establish a one-to-one table for the
  // gallery's rune shorthand. `[C]` is the only placeholder needed by these
  // Equip records, and its meaning is fixed by this printing's sole rune.
  const notation = new Map([
    ["C", distinctRunes[0]],
    ...Array.from({ length: 9 }, (_, energy) => [
      String(energy),
      `:rb_energy_${energy}:`
    ])
  ]);
  if ([...tail.matchAll(/\[([^\]]+)\]/gu)]
    .map((match) => match[1])
    .filter((token) => token !== "装配")
    .some((token) => !notation.has(token))) {
    return null;
  }
  const converted = tail.replace(/\[([^\]]+)\]/gu, (whole, token) =>
    token === "装配" || !notation.has(token) ? whole : notation.get(token)
  );
  assertKnownGalleryTokens(converted, "accessibilityText", cardId);
  return converted;
}

export function classifyLocalizedText(englishCard, chineseCard, cardId) {
  const englishRules = galleryBody(englishCard, "rulesText", cardId);
  const englishEffect = galleryBody(englishCard, "effectText", cardId);
  const chineseRules = galleryBody(chineseCard, "rulesText", cardId);
  const chineseEffect = galleryBody(chineseCard, "effectText", cardId);
  const hasEnglishAbility = !blankBody(englishRules) || !blankBody(englishEffect);
  const hasChineseAbility = hasHan(chineseRules) || hasHan(chineseEffect);

  if (!hasEnglishAbility) return "no-effect";
  if (/^\[NO TEXT\]$/u.test(containHtmlText(englishRules))) {
    return "english-fallback";
  }
  const noTextSentinel = (value) =>
    /^\[(?:NO TEXT|无文本)\]$/u.test(htmlText(value));
  if (noTextSentinel(chineseRules) || noTextSentinel(chineseEffect)) {
    return "english-fallback";
  }
  if (accessibilityRulesSupplement(englishCard, chineseCard, cardId) !== null) {
    return "official-accessibility-supplemented";
  }
  if (hasChineseAbility) return "official-structured";

  const rulesMatches =
    (blankBody(englishRules) && blankBody(chineseRules)) ||
    (!blankBody(englishRules) &&
      !blankBody(chineseRules) &&
      containHtmlText(chineseRules) === containHtmlText(englishRules));
  const effectMatches =
    (blankBody(englishEffect) && blankBody(chineseEffect)) ||
    (!blankBody(englishEffect) &&
      !blankBody(chineseEffect) &&
      containHtmlText(chineseEffect) === containHtmlText(englishEffect));
  return rulesMatches && effectMatches ? "english-fallback" : "missing";
}

function localizedRecord(englishCard, chineseCard, provenance) {
  if (!isRecord(chineseCard) ||
      typeof chineseCard.id !== "string" ||
      chineseCard.id === "") {
    throw new BuildDeckCatalogError("Chinese gallery contains a card without an id");
  }
  const cardId = chineseCard.id;
  if (!isRecord(englishCard) || englishCard.id !== cardId) {
    throw new BuildDeckCatalogError(
      `Localized galleries do not share a record for printing ${cardId}`
    );
  }
  assertGalleryBodyShape(englishCard, cardId);
  assertGalleryBodyShape(chineseCard, cardId);
  const rules = galleryBody(chineseCard, "rulesText", cardId);
  const effect = galleryBody(chineseCard, "effectText", cardId);
  assertKnownGalleryTokens(rules, "Chinese rulesText", cardId);
  assertKnownGalleryTokens(effect, "Chinese effectText", cardId);
  const status = classifiedLocalizedText(englishCard, chineseCard, cardId);
  const record = {
    cardId,
    rulesTextHtml: rules,
    effectTextHtml: effect,
    accessibilityText: accessibilityText(chineseCard, cardId),
    sourceUrl: provenance.sourceUrl,
    sourceUpdatedAt: provenance.sourceUpdatedAt,
    syncedAt: provenance.syncedAt,
    sourceLocale: "zh-CN",
    status
  };
  if (status === "official-accessibility-supplemented") {
    record.accessibilityRulesText = accessibilityRulesSupplement(
      englishCard,
      chineseCard,
      cardId
    );
  }
  return record;
}

export function localizedTextCoverage(englishGallery, chineseGallery) {
  normalizedLocalizedSource(englishGallery, "localizedGalleries.en-US");
  normalizedLocalizedSource(chineseGallery, "localizedGalleries.zh-CN");
  const english = rawCardIndex(englishGallery.cards);
  const chinese = rawCardIndex(chineseGallery.cards);
  if (english.size !== chinese.size ||
      [...english.keys()].some((id) => !chinese.has(id))) {
    throw new BuildDeckCatalogError(
      "Localized galleries must contain the same printing ids"
    );
  }
  const sets = {};
  let effectPrintings = 0;
  const statusIds = {
    "official-structured": [],
    "official-accessibility-supplemented": [],
    "english-fallback": [],
    missing: [],
    "no-effect": []
  };
  for (const [id, chineseCard] of chinese) {
    const englishCard = english.get(id);
    const setCode = String(
      englishCard.set?.value?.id ?? englishCard.setCode ?? "unknown"
    ).toLowerCase();
    const entry = sets[setCode] ??= {
      catalog: 0,
      effect: 0,
      officialStructured: 0,
      officialAccessibilitySupplemented: 0,
      displayableChinese: 0,
      englishFallback: 0,
      missing: 0,
      noEffect: 0
    };
    const englishRules = galleryBody(englishCard, "rulesText", id);
    const englishEffect = galleryBody(englishCard, "effectText", id);
    const status = classifiedLocalizedText(englishCard, chineseCard, id);
    entry.catalog += 1;
    if (!blankBody(englishRules) || !blankBody(englishEffect)) {
      effectPrintings += 1;
      entry.effect += 1;
    }
    if (status === "official-structured") entry.officialStructured += 1;
    if (status === "official-accessibility-supplemented") {
      entry.officialAccessibilitySupplemented += 1;
    }
    if (status === "official-structured" ||
        status === "official-accessibility-supplemented") {
      entry.displayableChinese += 1;
    }
    if (status === "english-fallback") entry.englishFallback += 1;
    if (status === "missing") entry.missing += 1;
    if (status === "no-effect") entry.noEffect += 1;
    statusIds[status].push(id);
  }
  const total = (field) => Object.values(sets).reduce(
    (sum, entry) => sum + entry[field],
    0
  );
  return {
    catalogPrintings: chinese.size,
    effectPrintings,
    officialStructured: total("officialStructured"),
    officialAccessibilitySupplemented:
      total("officialAccessibilitySupplemented"),
    displayableChinese: total("displayableChinese"),
    englishFallback: total("englishFallback"),
    missing: total("missing"),
    noEffect: total("noEffect"),
    ids: Object.fromEntries(
      Object.entries(statusIds).map(([status, ids]) => [status, ids.sort()])
    ),
    sets: Object.fromEntries(Object.entries(sets).sort())
  };
}

/**
 * Produces the versioned per-printing Chinese text audit records stored beside
 * the unchanged raw localized galleries in the sync snapshot.
 */
export function buildLocalizedTexts(englishGallery, chineseGallery, syncedAt) {
  const english = normalizedLocalizedSource(englishGallery, "localizedGalleries.en-US");
  const chinese = normalizedLocalizedSource(chineseGallery, "localizedGalleries.zh-CN");
  const syncStamp = text(syncedAt, 128, "localizedTexts.syncedAt");
  if (!Number.isFinite(Date.parse(syncStamp))) {
    throw new BuildDeckCatalogError("localizedTexts.syncedAt must be an ISO timestamp");
  }
  const englishIds = new Set();
  const englishById = new Map();
  for (const card of englishGallery.cards) {
    if (!isRecord(card) || typeof card.id !== "string" || card.id === "") {
      throw new BuildDeckCatalogError("English gallery contains a card without an id");
    }
    if (englishById.has(card.id)) {
      throw new BuildDeckCatalogError(`English gallery contains duplicate id ${card.id}`);
    }
    englishIds.add(card.id);
    englishById.set(card.id, card);
  }
  const chineseById = rawCardIndex(chineseGallery.cards);
  const onlyEnglish = [...englishIds].filter((id) => !chineseById.has(id));
  const onlyChinese = [...chineseById.keys()].filter((id) => !englishIds.has(id));
  if (onlyEnglish.length > 0 || onlyChinese.length > 0) {
    throw new BuildDeckCatalogError(
      "Localized galleries contain different printing ids: " +
      `only en-US=${onlyEnglish.slice(0, 10).join(",") || "none"}; ` +
      `only zh-CN=${onlyChinese.slice(0, 10).join(",") || "none"}`
    );
  }
  const provenance = {
    sourceUrl: chinese.sourceUrl,
    sourceUpdatedAt: chinese.sourceUpdatedAt,
    syncedAt: syncStamp
  };
  const records = chineseGallery.cards.map((card) =>
    localizedRecord(englishById.get(card.id), card, provenance)
  );
  const coverage = localizedTextCoverage(englishGallery, chineseGallery);
  return {
    sourceUrl: chinese.sourceUrl,
    sourceUpdatedAt: chinese.sourceUpdatedAt,
    syncedAt: syncStamp,
    sourceLocale: "zh-CN",
    coverage,
    cards: records
  };
}

function validatedLocalizedTexts(snapshot, englishGallery, chineseGallery) {
  const actual = snapshot.localizedTexts?.["zh-CN"];
  if (actual === undefined) return new Map();
  if (!isRecord(snapshot.localizedTexts) ||
      !isRecord(actual) ||
      !Array.isArray(actual.cards) ||
      !isRecord(actual.coverage)) {
    throw new BuildDeckCatalogError(
      'localizedTexts["zh-CN"] must contain a cards array'
    );
  }
  if (typeof actual.syncedAt !== "string") {
    throw new BuildDeckCatalogError(
      'localizedTexts["zh-CN"].syncedAt must be present'
    );
  }
  const expected = buildLocalizedTexts(
    englishGallery,
    chineseGallery,
    actual.syncedAt
  );
  if (!isDeepStrictEqual(actual, expected)) {
    throw new BuildDeckCatalogError(
      'localizedTexts["zh-CN"] provenance, status, or text does not match the official galleries'
    );
  }
  if (Object.keys(actual).some((key) =>
    key !== "sourceUrl" &&
    key !== "sourceUpdatedAt" &&
    key !== "syncedAt" &&
    key !== "sourceLocale" &&
    key !== "coverage" &&
    key !== "cards"
  ) ||
      Object.keys(actual.coverage).some((key) =>
        !LOCALIZED_COVERAGE_FIELDS.has(key)
      )) {
    throw new BuildDeckCatalogError(
      'localizedTexts["zh-CN"] contains an unsupported audit field'
    );
  }
  const byId = new Map();
  for (const record of actual.cards) {
    if (!isRecord(record) ||
        Object.keys(record).some((key) =>
          key !== LOCALIZED_SUPPLEMENT_FIELD &&
          !LOCALIZED_ABILITY_FIELDS.has(key)
        ) ||
        Object.keys(record).length !== LOCALIZED_ABILITY_FIELDS.size +
          (record.status === "official-accessibility-supplemented"
            ? Object.hasOwn(record, LOCALIZED_SUPPLEMENT_FIELD) ? 1 : -1
            : Object.hasOwn(record, LOCALIZED_SUPPLEMENT_FIELD) ? -1 : 0)) {
      throw new BuildDeckCatalogError(
        "Every localized Chinese card must contain exactly the versioned audit fields"
      );
    }
    if (!LOCALIZED_STATUSES.has(record.status) ||
        record.sourceLocale !== "zh-CN" ||
        byId.has(record.cardId)) {
      throw new BuildDeckCatalogError(
        `Invalid localized Chinese audit record for ${String(record.cardId)}`
      );
    }
    if (record.status === "official-accessibility-supplemented") {
      const supplementalRules = record[LOCALIZED_SUPPLEMENT_FIELD];
      if (typeof supplementalRules !== "string" ||
          accessibilityRulesSupplement(
            englishGallery.cards.find((card) => card.id === record.cardId),
            chineseGallery.cards.find((card) => card.id === record.cardId),
            record.cardId
          ) !== supplementalRules) {
        throw new BuildDeckCatalogError(
          `Accessibility supplement for ${record.cardId} is not reproducible`
        );
      }
    }
    byId.set(record.cardId, record);
  }
  return byId;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalId(fullName) {
  return `card.hash-${sha256(fullName)}`;
}

function printingId(card, field) {
  const base = card.cardCode ?? card.id;
  if (typeof base !== "string" || base === "") {
    throw new BuildDeckCatalogError(`${field} has no printing id`);
  }
  return safeId(base, `${field}.id`);
}

function firstLabel(values) {
  return Array.isArray(values) && values.length > 0
    ? values[0]?.label
    : undefined;
}

function officialFullName(card) {
  const name = card.fullName ?? card.name;
  if (typeof name !== "string" || name === "") {
    throw new BuildDeckCatalogError("Official card is missing an English name");
  }
  const subtitle = officialSubtitle(card);
  return (subtitle === undefined ? name : `${name}, ${subtitle}`)
    .normalize("NFC");
}

function officialSubtitle(card) {
  const value = card.subtitle;
  return typeof value === "string" && value !== ""
    ? value.normalize("NFC")
    : undefined;
}

function officialName(card) {
  const value = card.name;
  if (typeof value !== "string" || value === "") {
    throw new BuildDeckCatalogError("Official card is missing name");
  }
  return value.normalize("NFC");
}

function rawPublicCode(card) {
  return typeof card.publicCode === "string" && card.publicCode !== ""
    ? card.publicCode
    : undefined;
}

function officialCardNumber(card) {
  const explicit = rawPublicCode(card);
  if (explicit !== undefined) return text(explicit, 64, "publicCode");

  const normalized = card.cardNumber ?? card.collectorNumber;
  if (normalized === undefined || normalized === null) {
    throw new BuildDeckCatalogError("Official card is missing a card number");
  }
  return text(String(normalized), 64, "cardNumber");
}

function officialSetCode(card) {
  const value = card.setCode ?? card.set?.value?.id;
  if (typeof value !== "string" || value === "") {
    throw new BuildDeckCatalogError("Official card is missing a set code");
  }
  return safeId(value.toLowerCase(), "setCode");
}

function officialCardType(card) {
  const value = typeof card.cardType === "string"
    ? card.cardType
    : firstLabel(card.cardType?.type);
  if (typeof value !== "string" || value === "") {
    throw new BuildDeckCatalogError("Official card is missing a card type");
  }
  return text(value, 64, "cardType");
}

function mergedCardType(source, official) {
  try {
    return officialCardType(official);
  } catch {
    return officialCardType(source);
  }
}

function officialDomains(card) {
  const values = Array.isArray(card.domains)
    ? card.domains
    : (card.domain?.values ?? []).map((domain) => domain?.label);
  return stringArray(values, "domains");
}

function officialTags(card) {
  const values = Array.isArray(card.tags)
    ? card.tags
    : card.tags?.tags;
  const tags = values === undefined ? [] : stringArray(values, "tags");
  const superTypes = Array.isArray(card.cardTypeLabels)
    ? card.cardTypeLabels
    : (card.cardType?.superType ?? []).map((entry) => entry?.label);
  for (const label of superTypes) {
    if (typeof label === "string" && label !== "" && !tags.includes(label)) {
      tags.push(label);
    }
  }
  return tags;
}

function officialNumber(card, field) {
  return numberOrNull(card[field]?.value?.id ?? card[field], field);
}

/**
 * Ability text for one printing.
 *
 * The official gallery only ever carries the *printed* wording, including for
 * cards that Riot has since errata'd. The merged snapshot carries each printing's
 * errata annotation, which `errata.mjs` verifies against that same gallery text
 * before the corrected wording is used. Without a verified resolution the printed
 * text is used verbatim; the effect compiler then classifies the printing as
 * `judge-required` instead of producing an approximation.
 */
function officialAbility(card, errata) {
  const verified = errata?.resolutions.get(
    typeof card.cardCode === "string" ? card.cardCode : card.id
  );
  const effective = verified?.effectiveText ??
    card.abilityEffective ??
    card.abilityOriginal ??
    htmlText(card.text?.richText?.body);
  return abilityText(effective ?? "", "ability");
}

function officialImageUrl(card) {
  return httpsUrlOrNull(card.imageUrl ?? card.cardImage?.url, "imageUrl");
}

function explicitPublicCodeVariant(card) {
  const publicCode = rawPublicCode(card);
  if (publicCode === undefined) return { variant: "unknown", basicNumber: undefined };

  const [printed = ""] = publicCode.split("/");
  const withoutSet = printed.replace(/^[^-]*-/, "");
  if (withoutSet === "") {
    return { variant: "unknown", basicNumber: undefined };
  }

  let basic = withoutSet;
  if (/-(?:a|star)$/i.test(basic) || /[★*]$/.test(basic)) {
    basic = basic
      .replace(/-(?:a|star)$/i, "")
      .replace(/[★*]$/, "");
    return { variant: "alternate", basicNumber: basic };
  }
  if (/[aA]$/.test(basic) && !/[aA]{2,}$/.test(basic)) {
    const candidate = basic.slice(0, -1);
    if (candidate !== "") {
      return { variant: "alternate", basicNumber: candidate };
    }
  }

  return { variant: "standard", basicNumber: basic };
}

function rawCardIndex(cards) {
  const index = new Map();
  for (const card of cards) {
    if (!isRecord(card) ||
        typeof card.id !== "string" ||
        card.id === "") {
      throw new BuildDeckCatalogError("Official gallery contains a card without an id");
    }
    if (index.has(card.id)) {
      throw new BuildDeckCatalogError(`Official gallery contains duplicate id ${card.id}`);
    }
    index.set(card.id, card);
  }
  return index;
}

function localizedGalleries(snapshot) {
  const value = snapshot.localizedGalleries;
  if (value === undefined) {
    return { english: new Map(), chinese: new Map() };
  }
  if (!isRecord(value)) {
    throw new BuildDeckCatalogError("localizedGalleries must be an object");
  }
  const english = value["en-US"];
  const chinese = value["zh-CN"];
  if ((english !== undefined && !Array.isArray(english.cards)) ||
      (chinese !== undefined && !Array.isArray(chinese.cards))) {
    throw new BuildDeckCatalogError("Localized galleries must contain card arrays");
  }
  return {
    english: rawCardIndex(english?.cards ?? []),
    chinese: rawCardIndex(chinese?.cards ?? [])
  };
}

function snapshotDataVersion(snapshot, override) {
  if (override !== undefined) {
    return text(override, 128, "dataVersion");
  }

  const candidates = [
    snapshot.dataVersion,
    snapshot.bundle?.dataSet?.dataVersion,
    snapshot.source?.releaseTag,
    snapshot.sources?.officialGallery?.resultsUpdatedAt,
    snapshot.source?.downloadedAt
  ];
  const candidate = candidates.find(
    (value) => typeof value === "string" && value !== ""
  );
  return text(candidate ?? "official-snapshot-unknown", 128, "dataVersion");
}

function localizedNames(card, chineseCard) {
  if (!isRecord(chineseCard)) return {};
  return {
    ...(typeof chineseCard.name === "string" && chineseCard.name !== ""
      ? { localizedName: chineseCard.name.normalize("NFC") }
      : {}),
    ...(typeof chineseCard.subtitle === "string" && chineseCard.subtitle !== ""
      ? { localizedSubtitle: chineseCard.subtitle.normalize("NFC") }
      : {})
  };
}

function reviewedTags(id, name, fullName, imageUrl, tags, onConflict, corrections) {
  const result = applyReviewedTagCorrections(
    { id, name, fullName, imageUrl, tags },
    { onConflict }
  );
  if (corrections !== undefined && result.correction !== null) {
    corrections.push(result.correction);
  }
  return result.tags;
}

function localizedAbilityFields(record, englishCard) {
  if (record === undefined) return {};
  const printedEnglishRules = galleryBody(
    englishCard,
    "rulesText",
    englishCard.id
  ) ?? "";
  const englishEffect = galleryBody(englishCard, "effectText", englishCard.id) ?? "";
  const source = {
    url: record.sourceUrl,
    locale: "zh-CN",
    updatedAt: record.sourceUpdatedAt,
    syncedAt: record.syncedAt
  };
  const rules = record.rulesTextHtml;
  const effect = record.effectTextHtml;

  if (record.status === "english-fallback") {
    const noTextSentinel = (value) =>
      /^\[(?:NO TEXT|无文本)\]$/u.test(htmlText(value));
    return {
      ...(!blankBody(rules) &&
        (containHtmlText(rules) === containHtmlText(printedEnglishRules) ||
          noTextSentinel(rules))
        ? { localizedAbilityRulesText: rules }
        : {}),
      ...(!blankBody(effect) &&
        (containHtmlText(effect) === containHtmlText(englishEffect) ||
          noTextSentinel(effect))
        ? { localizedAbilityEffectText: effect }
        : {}),
      ...(blankBody(rules) && !blankBody(printedEnglishRules)
        ? { localizedAbilityRulesText: printedEnglishRules }
        : {}),
      ...(blankBody(effect) && !blankBody(englishEffect)
        ? { localizedAbilityEffectText: englishEffect }
        : {}),
      localizedAbilityLanguage: "en-US",
      localizedAbilityStatus: record.status,
      localizedAbilitySource: source
    };
  }
  if (record.status === "official-accessibility-supplemented") {
    const supplement = record.accessibilityRulesText;
    return {
      localizedAbilityRulesText: supplement,
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: record.status,
      localizedAbilitySource: source
    };
  }
  if (record.status === "official-structured" &&
      /^\[NO TEXT\]$/u.test(containHtmlText(printedEnglishRules))) {
    return {
      ...(!blankBody(rules) ? { localizedAbilityRulesText: rules } : {}),
      ...(!blankBody(effect) ? { localizedAbilityEffectText: effect } : {}),
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: record.status,
      localizedAbilitySource: source
    };
  }
  if (record.status === "no-effect" || record.status === "missing") {
    return {
      localizedAbilityStatus: record.status,
      localizedAbilitySource: source
    };
  }
  return {
    ...(!blankBody(rules) && hasHan(rules)
      ? { localizedAbilityRulesText: rules }
      : {}),
    ...(!blankBody(effect) && hasHan(effect)
      ? { localizedAbilityEffectText: effect }
      : {}),
    localizedAbilityLanguage: "zh-CN",
    localizedAbilityStatus: record.status,
    localizedAbilitySource: source
  };
}

function publicCard(
  id,
  source,
  official,
  chinese,
  corrections,
  errata,
  localizedText,
  requireLocalizedText
) {
  const card = official ?? source;
  const fullName = officialFullName(card);
  const name = official === undefined
    ? text(source.name ?? fullName, 256, "name")
    : officialName(card);
  const subtitle = officialSubtitle(card);
  const imageUrl = officialImageUrl(card);
  const tags = reviewedTags(
    id,
    name,
    fullName,
    imageUrl,
    officialTags(card),
    "throw",
    corrections
  );
  if (requireLocalizedText && localizedText === undefined) {
    throw new BuildDeckCatalogError(
      `localizedTexts["zh-CN"] is missing printing ${id}`
    );
  }

  return {
    id,
    canonicalCardId: canonicalId(fullName),
    name,
    ...(subtitle === undefined ? {} : { subtitle }),
    fullName,
    ...localizedNames(card, chinese),
    cardType: mergedCardType(source, card),
    domains: officialDomains(card),
    tags,
    setCode: officialSetCode(card),
    cardNumber: officialCardNumber(card),
    variant: explicitPublicCodeVariant(card).variant,
    imageUrl,
    energy: officialNumber(card, "energy"),
    power: officialNumber(card, "power"),
    might: officialNumber(card, "might"),
    ability: officialAbility(card, errata),
    ...localizedAbilityFields(localizedText, card)
  };
}

function unknownCommunityCard(id, source, corrections, errata) {
  const fullName = officialFullName(source);
  const name = text(source.name ?? fullName, 256, "name");
  const imageUrl = officialImageUrl(source);
  // Community fallbacks are only ever corrected when the reviewed printing's
  // exact guard holds; an unverified fallback is left untouched.
  const tags = reviewedTags(
    id,
    name,
    fullName,
    imageUrl,
    officialTags(source),
    "skip",
    corrections
  );
  return {
    id,
    canonicalCardId: id,
    name,
    ...(officialSubtitle(source) === undefined
      ? {}
      : { subtitle: officialSubtitle(source) }),
    fullName,
    cardType: officialCardType(source),
    domains: officialDomains(source),
    tags,
    setCode: officialSetCode(source),
    cardNumber: officialCardNumber(source),
    variant: "unknown",
    imageUrl,
    energy: officialNumber(source, "energy"),
    power: officialNumber(source, "power"),
    might: officialNumber(source, "might"),
    ability: officialAbility(source, errata)
  };
}

function compareById(left, right) {
  return left.id.localeCompare(right.id);
}

function variantRank(card) {
  if (card.variant === "standard") return 0;
  if (card.variant === "alternate") return 1;
  return 2;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function catalogDigest(catalog) {
  return `sha256:${sha256(canonicalJson({
    schemaVersion: catalog.schemaVersion,
    dataVersion: catalog.dataVersion,
    cards: catalog.cards,
    groups: catalog.groups
  }))}`;
}

export function buildDeckCatalog(snapshot, options = {}) {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.cards)) {
    throw new BuildDeckCatalogError("Snapshot must contain a cards array");
  }

  const { english, chinese } = localizedGalleries(snapshot);
  const localizedTexts = validatedLocalizedTexts(
    snapshot,
    snapshot.localizedGalleries?.["en-US"] ?? { cards: [] },
    snapshot.localizedGalleries?.["zh-CN"] ?? { cards: [] }
  );
  const hasLocalizedText = snapshot.localizedTexts?.["zh-CN"] !== undefined;
  // Optional sink for reviewed-tag correction outcomes observed during this
  // build. It never becomes part of the emitted catalog; callers use it to
  // report only corrections that were actually applied.
  const corrections = Array.isArray(options.corrections)
    ? options.corrections
    : undefined;
  const cards = [];
  const ids = new Set();
  const snapshotIds = new Set(
    snapshot.cards.map((card) => card?.cardCode ?? card?.id)
  );
  for (const cardId of localizedTexts.keys()) {
    if (!snapshotIds.has(cardId)) {
      throw new BuildDeckCatalogError(
        `localizedTexts["zh-CN"] contains an unknown printing ${cardId}`
      );
    }
  }
  // The official gallery only ever carries printed wording. Verified errata are
  // resolved from the merged snapshot's own annotations against each printing's
  // gallery text; anything that cannot be reproduced exactly stays printed.
  const errata = buildErrataIndex({
    cards: snapshot.cards,
    galleryTextById: new Map(
      [...english].map(([id, card]) => [id, htmlText(card.text?.richText?.body)])
    ),
    vocabulary: galleryTokenVocabulary(
      [...english.values()].map((card) => htmlText(card.text?.richText?.body))
    )
  });
  if (Array.isArray(options.errata)) {
    options.errata.push(errataAuditReport(errata));
  }
  for (const [index, source] of snapshot.cards.entries()) {
    if (!isRecord(source)) {
      throw new BuildDeckCatalogError(`Snapshot card ${index} is not an object`);
    }
    const id = printingId(source, `Snapshot card ${index}`);
    if (ids.has(id)) {
      throw new BuildDeckCatalogError(`Snapshot contains duplicate printing id ${id}`);
    }
    ids.add(id);

    const key = source.cardCode ?? source.id;
    const official = typeof key === "string" ? english.get(key) : undefined;
    if (official === undefined) {
      cards.push(unknownCommunityCard(id, source, corrections, errata));
    } else {
      cards.push(publicCard(
        id,
        source,
        official,
        chinese.get(key),
        corrections,
        errata,
        localizedTexts.get(id),
        hasLocalizedText
      ));
    }
  }

  cards.sort(compareById);
  const officialGroups = new Map();
  const unknownGroups = [];
  for (const card of cards) {
    if (card.canonicalCardId === card.id) {
      unknownGroups.push(card.id);
      continue;
    }
    const existing = officialGroups.get(card.canonicalCardId);
    if (existing === undefined) {
      officialGroups.set(card.canonicalCardId, [card.id]);
    } else {
      existing.push(card.id);
    }
  }

  const groups = [
    ...[...officialGroups.entries()].map(([id, printings]) => {
      const grouped = cards.filter((card) => printings.includes(card.id));
      const primary = [...grouped].sort(
        (left, right) =>
          variantRank(left) - variantRank(right) ||
          compareById(left, right)
      )[0];
      return {
        canonicalCardId: id,
        identityProvenance: "official-name-rule",
        ruleReferences: [...OFFICIAL_NAME_RULES],
        fullName: grouped[0]?.fullName,
        primaryPrintingId: primary?.id,
        printings: [...printings].sort()
      };
    }),
    ...unknownGroups.map((id) => ({
      canonicalCardId: id,
      identityProvenance: "unknown-community",
      ruleReferences: [],
      reason:
        "Official gallery provenance is unavailable; the printing is isolated.",
      primaryPrintingId: id,
      printings: [id]
    }))
  ].sort((left, right) =>
    left.canonicalCardId.localeCompare(right.canonicalCardId)
  );

  const result = {
    schemaVersion: 1,
    dataVersion: snapshotDataVersion(snapshot, options.dataVersion),
    digest: "placeholder",
    cards,
    groups
  };
  result.digest = catalogDigest(result);
  return result;
}

async function readSnapshot(filePath) {
  let contents;
  try {
    contents = await (await import("node:fs/promises")).readFile(
      filePath,
      "utf8"
    );
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      throw new BuildDeckCatalogError(
        `Card snapshot not found: ${filePath}\n` +
        "Run the card sync first to create it:\n" +
        "  pnpm --filter @riftbound/card-data sync:cards\n" +
        `  node scripts/sync-current-cards.mjs --output ${filePath}`
      );
    }
    throw error;
  }

  try {
    return JSON.parse(contents);
  } catch {
    throw new BuildDeckCatalogError(`Card snapshot is not valid JSON: ${filePath}`);
  }
}

async function writeAtomically(filePath, contents) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    const handle = await open(temporaryPath, "wx");
    try {
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function reportReviewedCorrections(corrections, log) {
  // Only corrections that this build actually applied to a printing are
  // reported. An id that merely appears in the final catalog (an already-correct
  // input, or a skipped conflict) must not be reported as corrected.
  const applied = corrections.filter(
    (correction) => correction.status === "applied"
  );
  if (applied.length === 0) return;
  const summary = applied
    .map((correction) =>
      `${correction.printingId}: ${correction.wrongTag}->${correction.correctedTag}`
    )
    .join(", ");
  log(`Reviewed tag corrections applied: ${summary}.`);
}

function reportErrata(errataReports, log) {
  const [report] = errataReports;
  if (report === undefined) return;
  const { stats, unresolved } = report;
  log(
    `Errata resolved: ${stats.changed} changed, ${stats.unchanged} already ` +
    `effective, ${stats.propagated} inherited by an identical sibling printing; ` +
    `${stats.unresolved} unresolved.`
  );
  if (unresolved.length > 0) {
    log(
      `Errata left printed (judge-required): ` +
      unresolved.map((entry) => `${entry.printingId} (${entry.reason})`).join(", ") +
      "."
    );
  }
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  try {
    const options = parseArguments(argv);
    if (options.help) {
      log(usage.trimEnd());
      return 0;
    }
    const snapshotPath = resolveSnapshotPath(options.snapshot);
    const outputPath = resolveOutputPath(options.output);
    const snapshot = await readSnapshot(snapshotPath);
    const corrections = [];
    const errataReports = [];
    const catalog = buildDeckCatalog(snapshot, { ...options, corrections, errata: errataReports });
    const contents = `${JSON.stringify(catalog, null, 2)}\n`;
    if (options.dryRun) {
      log(
        `Dry run complete: ${catalog.cards.length} cards and ` +
        `${catalog.groups.length} identity groups. Output would be ${outputPath}.`
      );
      reportReviewedCorrections(corrections, log);
      reportErrata(errataReports, log);
      return 0;
    }
    await writeAtomically(outputPath, contents);
    log(
      `Built ${catalog.cards.length} cards and ${catalog.groups.length} ` +
      `identity groups at ${outputPath}.`
    );
    reportReviewedCorrections(corrections, log);
    reportErrata(errataReports, log);
    return 0;
  } catch (caught) {
    error(
      `build-deck-catalog failed: ${caught instanceof Error ? caught.message : String(caught)}`
    );
    return 1;
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  process.exitCode = await main();
}
