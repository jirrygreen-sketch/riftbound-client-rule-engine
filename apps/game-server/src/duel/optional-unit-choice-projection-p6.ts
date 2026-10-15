/**
 * Pure presentation adapter for a future optional-Unit owner.
 *
 * It only reshapes an already-issued, trusted `DuelOptionalPlayPromptV1` into the existing
 * P4 `DuelPendingChoiceV3Actions1` wire DTO fixed by `duel-actions-contract-v3.ts`. It does
 * not issue or answer a choice, inspect a receipt, settle payment/state, auto-decline, or
 * choose based on a balance, and it never derives a `promptId` from a private UID or source
 * program fingerprint. No profile, schema, command, authority, or production call is added
 * here; the parent task owns any owner/profile wiring.
 */
import type { DuelOptionalPlayPromptV1 } from "@riftbound/engine-core/duel";
import type { DuelPendingChoiceV3Actions1 } from "@riftbound/protocol";

export interface OptionalUnitChoiceProjectionRequestP6 {
  /** Already issued by the trusted optional-play authority; null when no window is open. */
  readonly prompt: DuelOptionalPlayPromptV1 | null;
  /** Trusted owner identity of the pending choice (the acting/priority player). */
  readonly ownerPlayerId: string;
  /** Trusted authenticated viewer identity, or null for an anonymous spectator. */
  readonly viewerPlayerId: string | null;
  /** Owner-supplied opaque per-prompt token; never derived from a private UID or program fingerprint. */
  readonly opaquePromptId: string;
}

const PAY_LABEL = "支付额外费用";
const DECLINE_LABEL = "不支付额外费用";
const PROMPT_KEYS = ["choiceId", "payOptionId", "declineOptionId"] as const;

function fail(reason: string): never {
  throw new TypeError(`Optional Unit choice projection: ${reason}`);
}
function id(value: unknown, reason: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(reason);
  return value;
}
/** Validate the known prompt DTO shape; only own data descriptors and the three allowed keys. */
function promptOf(raw: unknown): DuelOptionalPlayPromptV1 {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("invalid prompt");
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== PROMPT_KEYS.length ||
      !PROMPT_KEYS.every(key => keys.includes(key))) fail("invalid prompt shape");
  const value: Record<string, unknown> = {};
  for (const key of PROMPT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("invalid prompt field");
    value[key] = descriptor.value;
  }
  return { choiceId: id(value.choiceId, "invalid choice id"),
    payOptionId: id(value.payOptionId, "invalid pay option id"),
    declineOptionId: id(value.declineOptionId, "invalid decline option id") };
}

/**
 * Map a trusted optional-play prompt to the existing P4 pending-choice DTO.
 *
 * `null` means no pending choice. A non-owner (or anonymous spectator) sees only
 * `{ active: true }`. The owner sees the exact `play-choices` prompt carrying the caller's
 * opaque `promptId` and both opaque option tokens. Every call returns fresh, independent DATA.
 */
export function projectOptionalUnitChoiceP6(
  request: OptionalUnitChoiceProjectionRequestP6,
): DuelPendingChoiceV3Actions1 {
  if (request === null || typeof request !== "object" || Array.isArray(request)) fail("invalid request");
  const ownerPlayerId = id(request.ownerPlayerId, "invalid owner identity");
  const viewerPlayerId = request.viewerPlayerId === null
    ? null : id(request.viewerPlayerId, "invalid viewer identity");
  const opaquePromptId = id(request.opaquePromptId, "invalid opaque prompt id");
  if (request.prompt === null) return null;
  const prompt = promptOf(request.prompt);
  if (viewerPlayerId !== ownerPlayerId) return { active: true };
  return { active: true, choiceId: prompt.choiceId, kind: "play-choices",
    prompts: [{ promptId: opaquePromptId, kind: "optional-cost", minSelections: 1, maxSelections: 1,
      options: [{ id: prompt.payOptionId, label: PAY_LABEL },
        { id: prompt.declineOptionId, label: DECLINE_LABEL }] }] };
}
