import type { ObjectRef, ObjectSnapshot } from "../contract.js";
import type { ContinuousEffectSpec, Duration } from "../contract.js";
import { settlementIdentity } from "../../layers/ops/index.js";

/** A resolved source/recipient pair for one Copy Effect registration. */
export interface CopyEffectPair {
  readonly source: ObjectSnapshot;
  readonly recipient: ObjectSnapshot;
}

export interface CopyEffectRegistration {
  readonly effect: ContinuousEffectSpec;
  readonly duration: Duration;
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

/**
 * Build one copy-layer registration for an existing object. The filter carries
 * both id and zone-entry identity, so a recipient that leaves and re-enters
 * never inherits the old copy effect (CR 124.1 / 359.3.e). The target's owner,
 * controller, zone, location, state and attachments are intentionally absent
 * from the effect payload; only COPYABLE_KEYS are replaced by the layer.
 */
export function buildCopyEffectRegistration(
  actor: ObjectRef,
  pair: CopyEffectPair,
  duration: Duration,
  read: (key: string) => unknown,
  write: (key: string, value: number) => void,
  index: number,
  requestedSettlement?: string,
): CopyEffectRegistration {
  const settlement = settlementIdentity(actor, "effect.copy", read, write, requestedSettlement);
  const id = [
    "effect-copy", settlement, actor.id, String(actor.zoneEntryId),
    pair.source.ref.id, String(pair.source.ref.zoneEntryId),
    pair.recipient.ref.id, String(pair.recipient.ref.zoneEntryId), String(index)
  ].join(":");
  return {
    duration,
    effect: {
      id,
      layer: "copy",
      source: pair.source.ref,
      filter: {
        objectId: pair.recipient.ref.id,
        zoneEntryId: pair.recipient.ref.zoneEntryId,
        zone: "board",
      },
      effect: { kind: "copy-object", source: pair.source.ref },
    },
  };
}

/**
 * Pair one shared source with every recipient, or pair equally sized lists by
 * order. Any other shape is ambiguous and remains fail-closed at the caller.
 */
export function pairCopySources(
  sources: readonly ObjectSnapshot[],
  recipients: readonly ObjectSnapshot[],
): readonly CopyEffectPair[] {
  if (sources.length === 1) return recipients.map(recipient => ({ source: sources[0]!, recipient }));
  if (sources.length === recipients.length) {
    return sources.map((source, index) => ({ source, recipient: recipients[index]! }));
  }
  return [];
}

export function copyEffectReceipt(
  pairs: readonly CopyEffectPair[],
  duration: Duration,
  blockedReason?: string,
): Record<string, unknown> {
  return {
    amount: blockedReason === undefined ? pairs.length : 0,
    objects: blockedReason === undefined ? pairs.map(pair => ({ ...pair.recipient.ref })) : [],
    sources: blockedReason === undefined ? pairs.map(pair => ({ ...pair.source.ref })) : [],
    objectsComplete: blockedReason === undefined,
    duration,
    ...(blockedReason === undefined ? {} : { blockedReason }),
  };
}

export function sameCopyRef(left: ObjectRef, right: ObjectRef): boolean {
  return refKey(left) === refKey(right);
}

