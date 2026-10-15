#!/usr/bin/env node

/**
 * Evidence-bound card-errata resolution.
 *
 * The official card gallery is a *printed* record: it keeps the text as it was
 * printed on the card even after Riot publishes errata for that card. The
 * authoritative corrected wording therefore has to be merged from the published
 * errata announcement. Every errata announcement (Origins, Spiritforged,
 * Unleashed, Vendetta, Radiance) uses the same shape:
 *
 *   <card name>
 *   [NEW TEXT]
 *   <corrected ability text>
 *   ▲
 *   [OLD TEXT]
 *   <printed ability text>
 *
 * Announcements and the upstream community dataset both write ability costs with a
 * compact printed notation (`[1]`, `[A]`, `[M]`, ...), while the official gallery
 * API writes the same costs as `:rb_*:` symbols (`:rb_energy_1:`,
 * `:rb_rune_rainbow:`, `:rb_might:`, ...). Merging therefore needs a verified
 * notation translation; guessing it would silently change card meaning.
 *
 * This module refuses to emit text it cannot fully justify:
 *
 *   1. The per-printing token correspondence is *derived* from that printing's own
 *      [OLD TEXT] versus the official gallery text, and the [OLD TEXT] is then
 *      required to render back to the gallery text character for character. A
 *      printing whose OLD text does not reproduce its gallery text is unresolved.
 *   2. A [NEW TEXT] token is only accepted when it is (a) present verbatim in the
 *      printing's gallery text, (b) part of the derived correspondence, (c) a
 *      documented printed-notation symbol whose `:rb_*:` form is attested in the
 *      gallery token vocabulary, or (d) a bracket token the official gallery
 *      itself prints verbatim somewhere in the corpus. Anything else leaves the
 *      printing unresolved and
 *      keeps the printed text, i.e. judge-required rather than an approximation.
 *   3. Domain-dependent symbols (`[C]`, a single rune of the card's own Domain) are
 *      deliberately absent from the documented table: they can only resolve through
 *      the per-printing correspondence, so an ambiguous `[C]` never guesses a Domain.
 *
 * Corrected wording still has to be reviewed by a judge before it becomes
 * executable. This module only reports data provenance; it never compiles or
 * executes an effect.
 */

/** Any printed-notation or gallery symbol inside an ability text. */
export const ERRATA_TOKEN_PATTERN = /:rb_[a-z0-9_]+:|\[[^\]]+\]/gu;

/** The `▲` / `[OLD TEXT]` separator used by every errata announcement. */
export const ERRATA_SEPARATOR_PATTERN = /\n▲\n\[OLD TEXT\]\n?/u;

const ENERGY_TOKEN_PATTERN = /^\[([0-9]+)\]$/u;

/**
 * Documented printed-notation symbols shared by every errata announcement.
 *
 * Each mapping is attested by the announcement's own [OLD TEXT] -> official
 * gallery correspondence across the 2026 errata set and by the gallery's token
 * vocabulary:
 *
 *   [A]  any-Domain Power  -> :rb_rune_rainbow:  (CR 135.2.e.5)
 *   [M]  Might             -> :rb_might:
 *   [S]  Might (older sets) -> :rb_might:
 *   [E]  exhaust           -> :rb_exhaust:
 *   [T]  exhaust (older)   -> :rb_exhaust:
 *   [n]  Energy cost       -> :rb_energy_n:
 *
 * A table entry is only ever used when its `:rb_*:` form actually occurs in the
 * official gallery token vocabulary passed to the resolver.
 */
export const ERRATA_NOTATION_TABLE = new Map([
  ["[A]", ":rb_rune_rainbow:"],
  ["[M]", ":rb_might:"],
  ["[S]", ":rb_might:"],
  ["[E]", ":rb_exhaust:"],
  ["[T]", ":rb_exhaust:"]
]);

/**
 * The official errata announcements whose shape this module parses. Radiance is
 * listed first because it is the current release target (rules effective
 * 2026-10-16, product release 2026-10-23). URLs are recorded for auditability
 * only; resolution never fetches them, it works from the merged snapshot.
 */
export const ERRATA_ANNOUNCEMENTS = [
  {
    set: "Radiance",
    url: "https://playriftbound.com/en-us/news/announcements/radiance-errata-updates",
    publishedAt: "2026-10-09T16:00:00.000Z"
  },
  {
    set: "Vendetta",
    url: "https://playriftbound.com/en-us/news/announcements/vendetta-errata-updates",
    publishedAt: null
  },
  {
    set: "Unleashed",
    url: "https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/",
    publishedAt: null
  },
  {
    set: "Spiritforged",
    url: "https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/",
    publishedAt: null
  },
  {
    set: "Origins",
    url: "https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/riftbound-origins-card-errata/",
    publishedAt: null
  }
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Gallery symbol vocabulary (`:rb_*:` plus verbatim keyword tokens). */
export function galleryTokenVocabulary(texts) {
  const tokens = new Set();
  for (const text of texts ?? []) {
    if (typeof text !== "string") continue;
    for (const token of text.match(ERRATA_TOKEN_PATTERN) ?? []) {
      tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Splits an errata annotation into the corrected text and, when the annotation
 * carries the `▲ [OLD TEXT]` marker, the printed text that was replaced.
 * Returns `null` for input that carries no corrected text at all.
 */
export function splitErrataAnnotation(correctedText) {
  if (typeof correctedText !== "string" || correctedText.trim() === "") {
    return null;
  }
  const match = ERRATA_SEPARATOR_PATTERN.exec(correctedText);
  if (match === null) {
    return { effectiveText: correctedText.trim(), printedNotation: null };
  }
  return {
    effectiveText: correctedText.slice(0, match.index).trim(),
    printedNotation: correctedText.slice(match.index + match[0].length).trim()
  };
}

/**
 * Derives the printed-notation -> gallery-symbol correspondence from one
 * printing's own [OLD TEXT] and gallery text. The map is only usable when both
 * texts tokenize to the same sequence lengths and no notation token maps to two
 * different symbols.
 */
export function deriveNotationMap(printedNotation, galleryText) {
  if (typeof printedNotation !== "string" || typeof galleryText !== "string") {
    return { status: "unresolved", reason: "missing-notation-or-gallery-text" };
  }
  const galleryTokens = galleryText.match(ERRATA_TOKEN_PATTERN) ?? [];
  const printedTokens = printedNotation.match(ERRATA_TOKEN_PATTERN) ?? [];
  if (galleryTokens.length !== printedTokens.length) {
    return { status: "unresolved", reason: "printed-notation-token-count-mismatch" };
  }
  const map = new Map();
  for (const [index, galleryToken] of galleryTokens.entries()) {
    const printedToken = printedTokens[index];
    if (printedToken === galleryToken) continue;
    const existing = map.get(printedToken);
    if (existing !== undefined && existing !== galleryToken) {
      return {
        status: "unresolved",
        reason: `ambiguous-notation-token ${printedToken}`
      };
    }
    map.set(printedToken, galleryToken);
  }
  return { status: "ok", map };
}

/**
 * Renders one ability text into official gallery notation. Every token must be
 * justified by the derived correspondence, the printing's own gallery text, or
 * the documented table, otherwise the whole text is unresolved.
 */
export function resolveAbilityNotation(text, options = {}) {
  const map = options.map ?? new Map();
  const galleryText = typeof options.galleryText === "string" ? options.galleryText : "";
  const vocabulary = options.vocabulary ?? new Set();
  const unresolved = [];
  const resolved = text.replace(ERRATA_TOKEN_PATTERN, (token) => {
    const mapped = map.get(token);
    if (mapped !== undefined) return mapped;
    if (galleryText.includes(token)) return token;
    // A bracket token that the official gallery prints verbatim somewhere in
    // the corpus (keyword tags such as `[Reaction]`) is a known gallery symbol.
    if (vocabulary.has(token)) return token;
    const energy = ENERGY_TOKEN_PATTERN.exec(token);
    const tableToken = ERRATA_NOTATION_TABLE.get(token) ??
      (energy === null ? undefined : `:rb_energy_${energy[1]}:`);
    if (tableToken !== undefined && vocabulary.has(tableToken)) return tableToken;
    unresolved.push(token);
    return token;
  });
  if (unresolved.length > 0) {
    return {
      status: "unresolved",
      reason: `unresolved-notation-token ${[...new Set(unresolved)].join("")}`
    };
  }
  return { status: "ok", text: resolved };
}

/**
 * Resolves one printing's errata annotation against its own official gallery
 * text. Returns `{ status: "verified" }` only when the printed notation
 * reproduces the gallery text exactly and the corrected text renders without any
 * unresolved token.
 */
export function resolvePrintingErrata(options = {}) {
  const printingId = options.printingId;
  const galleryText = options.galleryText;
  if (typeof printingId !== "string" || printingId === "") {
    return { status: "unresolved", reason: "missing-printing-id" };
  }
  if (typeof galleryText !== "string" || galleryText === "") {
    return { status: "unresolved", reason: "missing-gallery-text" };
  }
  const split = splitErrataAnnotation(options.correctedText);
  if (split === null) {
    return { status: "unresolved", reason: "missing-corrected-text" };
  }
  // Some annotations leave the `[OLD TEXT]` section empty; the merged record's
  // own printed text is then the only available printed notation.
  const markerNotation = typeof split.printedNotation === "string"
    ? split.printedNotation.trim()
    : "";
  const printedNotation = markerNotation !== ""
    ? markerNotation
    : (typeof options.printedNotation === "string" ? options.printedNotation.trim() : "");
  if (printedNotation === "") {
    return { status: "unresolved", reason: "missing-printed-notation" };
  }
  const derived = deriveNotationMap(printedNotation, galleryText);
  if (derived.status !== "ok") {
    return { status: "unresolved", reason: derived.reason };
  }
  const notationOptions = {
    map: derived.map,
    galleryText,
    vocabulary: options.vocabulary ?? new Set()
  };
  const reproduced = resolveAbilityNotation(printedNotation, notationOptions);
  if (reproduced.status !== "ok" || reproduced.text !== galleryText) {
    return { status: "unresolved", reason: "printed-notation-does-not-reproduce-gallery-text" };
  }
  const corrected = resolveAbilityNotation(split.effectiveText, notationOptions);
  if (corrected.status !== "ok") {
    return { status: "unresolved", reason: corrected.reason };
  }
  return {
    status: "verified",
    printingId,
    errataCode: typeof options.errataCode === "string" && options.errataCode !== ""
      ? options.errataCode
      : null,
    printedText: galleryText,
    effectiveText: corrected.text,
    changed: corrected.text !== galleryText,
    method: "printing"
  };
}

/**
 * Builds the per-printing errata index for a merged snapshot.
 *
 * `cards` are the merged snapshot records (they carry `cardCode`,
 * `abilityOriginal`, `abilityCorrected`, `hasErrata`, `matchedErrataCode`).
 * `galleryTextById` maps a printing id to its official gallery printed text;
 * only printings with a gallery record can be verified.
 *
 * Errata are published per card identity, but the community dataset annotates
 * individual printings. When a printing carries no annotation of its own, the
 * resolution is inherited from a same-identity sibling only if that sibling's
 * printed text is identical to this printing's printed text and every matching
 * sibling agrees on the corrected wording. Everything else stays unresolved.
 */
export function buildErrataIndex(options = {}) {
  const cards = Array.isArray(options.cards) ? options.cards : [];
  const galleryTextById = options.galleryTextById instanceof Map
    ? options.galleryTextById
    : new Map();
  const vocabulary = options.vocabulary ?? new Set();
  const resolutions = new Map();
  const byIdentity = new Map();
  const unresolved = [];
  const stats = {
    annotations: 0,
    verified: 0,
    changed: 0,
    unchanged: 0,
    propagated: 0,
    unresolved: 0
  };

  for (const card of cards) {
    if (!isRecord(card)) continue;
    const printingId = typeof card.cardCode === "string" ? card.cardCode : card.id;
    const correctedText = typeof card.abilityCorrected === "string"
      ? card.abilityCorrected
      : null;
    const galleryText = typeof printingId === "string"
      ? galleryTextById.get(printingId)
      : undefined;
    if (correctedText === null || correctedText.trim() === "") continue;
    stats.annotations += 1;
    if (typeof printingId !== "string" || typeof galleryText !== "string") {
      stats.unresolved += 1;
      unresolved.push({
        printingId: typeof printingId === "string" ? printingId : null,
        reason: "no-official-gallery-printing"
      });
      continue;
    }
    const resolution = resolvePrintingErrata({
      printingId,
      galleryText,
      correctedText,
      printedNotation: card.abilityOriginal,
      errataCode: card.matchedErrataCode,
      vocabulary
    });
    if (resolution.status !== "verified") {
      stats.unresolved += 1;
      unresolved.push({ printingId, reason: resolution.reason });
      continue;
    }
    stats.verified += 1;
    if (resolution.changed) stats.changed += 1;
    else stats.unchanged += 1;
    resolutions.set(printingId, resolution);
    const identity = typeof card.fullName === "string" && card.fullName !== ""
      ? card.fullName
      : (typeof card.name === "string" ? card.name : printingId);
    if (!byIdentity.has(identity)) byIdentity.set(identity, []);
    byIdentity.get(identity).push(resolution);
  }

  for (const card of cards) {
    if (!isRecord(card)) continue;
    const printingId = typeof card.cardCode === "string" ? card.cardCode : card.id;
    if (typeof printingId !== "string" || resolutions.has(printingId)) continue;
    const galleryText = galleryTextById.get(printingId);
    if (typeof galleryText !== "string") continue;
    const identity = typeof card.fullName === "string" && card.fullName !== ""
      ? card.fullName
      : (typeof card.name === "string" ? card.name : printingId);
    const siblings = (byIdentity.get(identity) ?? [])
      .filter((sibling) => sibling.printedText === galleryText);
    if (siblings.length === 0) continue;
    const effectiveTexts = new Set(siblings.map((sibling) => sibling.effectiveText));
    if (effectiveTexts.size !== 1) {
      stats.unresolved += 1;
      unresolved.push({ printingId, reason: "identity-sibling-errata-conflict" });
      continue;
    }
    const [sibling] = siblings;
    if (sibling.effectiveText === galleryText) continue;
    resolutions.set(printingId, {
      ...sibling,
      printingId,
      method: "identity-sibling",
      originPrintingId: sibling.printingId
    });
    stats.propagated += 1;
    stats.changed += 1;
  }

  return {
    resolutions,
    unresolved,
    stats: { ...stats, verifiedIdentities: byIdentity.size }
  };
}

/**
 * Public audit projection of an errata index. It carries only provenance:
 * per-printing resolution status, the errata code, and the resolved text. It is
 * never written into a card record.
 */
export function errataAuditReport(index) {
  const verified = [...index.resolutions.values()]
    .map((resolution) => ({
      printingId: resolution.printingId,
      errataCode: resolution.errataCode,
      method: resolution.method,
      originPrintingId: resolution.originPrintingId ?? resolution.printingId,
      changed: resolution.changed,
      effectiveText: resolution.effectiveText
    }))
    .sort((left, right) => left.printingId.localeCompare(right.printingId));
  return {
    stats: { ...index.stats },
    verified,
    unresolved: [...index.unresolved]
      .sort((left, right) => String(left.printingId).localeCompare(String(right.printingId)))
  };
}
