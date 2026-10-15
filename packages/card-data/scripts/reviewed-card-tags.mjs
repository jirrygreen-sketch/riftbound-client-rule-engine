#!/usr/bin/env node

/**
 * Versioned, human-reviewed per-printing tag corrections.
 *
 * These records are tool-internal review provenance. They are consumed by
 * `build-deck-catalog.mjs` while assembling the public deck catalog, so that a
 * normal regeneration produces the corrected tags. The public catalog schema
 * (schemaVersion 1) is intentionally left unchanged: no raw source record and no
 * review record is embedded in the emitted catalog.
 *
 * Every correction is strictly guarded. It only fires for one exact printing
 * identity (printing id + name + fullName + known image asset URL) and only when
 * the known-wrong tag is present. If the guard does not hold, the correction is
 * never applied; callers may choose to surface an explicit conflict instead of a
 * silent override.
 */

/**
 * The reviewed printing whose scraped `Vi` tag is a printing defect: the official
 * card face reads "CHAMPION UNIT KARMA IONIA". Sibling printings of the same
 * canonical card (sfd-237-221, sfd-237-star-221) already carry `Karma`.
 */
const KARMA_CHANNELER_IMAGE_ASSET_URL =
  "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/aca8664b334f2fa40cc7bae2811dd4e1b4f06388-744x1039.png";

/** Recorded hash of the reviewed asset (images-manifest + downloaded PNG). */
const KARMA_CHANNELER_IMAGE_ASSET_SHA256 =
  "sha256:b7facf44b6eede169b0af3204c46d9580bfcd30d8d7ff98c4f063ef5dad7b957";

export const REVIEWED_TAG_CORRECTIONS_VERSION = "reviewed-card-tags/v1";

export const REVIEWED_TAG_CORRECTIONS = Object.freeze([
  Object.freeze({
    version: REVIEWED_TAG_CORRECTIONS_VERSION,
    printingId: "ogn-235-298",
    name: "Karma",
    fullName: "Karma, Channeler",
    imageAssetUrl: KARMA_CHANNELER_IMAGE_ASSET_URL,
    imageAssetSha256: KARMA_CHANNELER_IMAGE_ASSET_SHA256,
    // Tags observed on the defective printing (order preserved after correction).
    observedTags: ["Vi", "Ionia", "Champion"],
    wrongTag: "Vi",
    correctedTag: "Karma",
    preservedTags: ["Ionia", "Champion"],
    reviewedAt: "2026-10-12",
    reviewedBy: "claude-team/karma-printing-tag-fix",
    evidence: Object.freeze({
      imageTypeLine: "CHAMPION UNIT KARMA IONIA",
      imageAssetFile: "packages/card-data/data/images/ogn-235-298.png",
      imageManifest: "packages/card-data/data/images-manifest.json",
      constructedMetadataEvidence:
        "outputs/coordination/full-product-20261012/task-artifacts/constructed-metadata-evidence/report.md",
      championTagCrossReference:
        "outputs/coordination/full-product-20261012/task-artifacts/constructed-metadata-evidence/champion-tag-cross-reference.json",
      siblingPrintings: Object.freeze(["sfd-237-221", "sfd-237-star-221"])
    })
  })
]);

export class ReviewedTagCorrectionConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ReviewedTagCorrectionConflictError";
    this.code = "reviewed_tag_correction_conflict";
    this.printingId = details.printingId;
    this.reason = details.reason;
  }
}

/** Strip query/hash so the same asset compares equal across scrape surfaces. */
export function normalizeImageAssetUrl(value) {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function findReviewedTagCorrection(printingId) {
  return REVIEWED_TAG_CORRECTIONS.find(
    (record) => record.printingId === printingId
  );
}

/** Deep, mutable copy of every review record for tooling/audit consumers. */
export function listReviewedTagCorrections() {
  return REVIEWED_TAG_CORRECTIONS.map((record) => ({
    ...record,
    observedTags: [...record.observedTags],
    preservedTags: [...record.preservedTags],
    evidence: { ...record.evidence, siblingPrintings: [...record.evidence.siblingPrintings] }
  }));
}

function recordSummary(record, status) {
  return {
    version: record.version,
    printingId: record.printingId,
    status,
    wrongTag: record.wrongTag,
    correctedTag: record.correctedTag,
    imageAssetUrl: record.imageAssetUrl,
    imageAssetSha256: record.imageAssetSha256
  };
}

/**
 * Apply the reviewed correction (if any) to one printing's tag list.
 *
 * @param {{ id?: string, name?: string, fullName?: string, imageUrl?: string,
 *           tags?: unknown }} input
 * @param {{ onConflict?: "throw" | "skip" }} [options]
 * @returns {{ tags: string[], correction: object | null }}
 */
export function applyReviewedTagCorrections(input, options = {}) {
  const onConflict = options.onConflict ?? "throw";
  const tags = Array.isArray(input?.tags) ? [...input.tags] : [];
  const record = findReviewedTagCorrection(input?.id);
  if (record === undefined) {
    return { tags, correction: null };
  }

  const guard = {
    name: input?.name === record.name,
    fullName: input?.fullName === record.fullName,
    image:
      normalizeImageAssetUrl(input?.imageUrl) === record.imageAssetUrl
  };
  const wrongTagPresent = tags.includes(record.wrongTag);
  const correctedTagPresent = tags.includes(record.correctedTag);

  const conflict = (reason, status) => {
    if (onConflict === "throw") {
      throw new ReviewedTagCorrectionConflictError(
        `Reviewed tag correction for ${record.printingId} could not be applied ` +
          `(${reason}); refusing to override tags for an unverified printing`,
        { printingId: record.printingId, reason }
      );
    }
    return { tags, correction: recordSummary(record, status) };
  };

  if (!guard.name || !guard.fullName || !guard.image) {
    const failed = Object.entries(guard)
      .filter(([, ok]) => !ok)
      .map(([field]) => field)
      .join(",");
    return conflict(`identity-guard-mismatch:${failed}`, "skipped-guard-mismatch");
  }

  if (wrongTagPresent) {
    return {
      tags: tags.map((tag) =>
        tag === record.wrongTag ? record.correctedTag : tag
      ),
      correction: recordSummary(record, "applied")
    };
  }

  if (correctedTagPresent) {
    // Already-correct input is idempotent: no duplicate tag, no mutation.
    return { tags, correction: recordSummary(record, "already-correct") };
  }

  return conflict("unexpected-tag-set", "skipped-unexpected-tags");
}
