import type { V2Projection } from "../../../protocol/src/v2/index.js";

export interface PrivacyAudit {
  readonly checkedProjections: number;
  readonly violations: readonly string[];
}

function identity(object: V2Projection["objects"][number]): string | null {
  const parts = [object.objectId, object.cardId, object.name].filter((value): value is string =>
    typeof value === "string" && value.length > 0);
  return parts.length === 0 ? null : parts.join(":");
}

export function auditProjectionPrivacy(
  projection: V2Projection,
  otherPlayerId: string,
  audited: PrivacyAudit
): PrivacyAudit {
  const violations = [...audited.violations];
  for (const zone of projection.zones) {
    if ((zone.zone === "deck" || zone.zone === "rune-deck" || zone.zone === "hand") &&
        zone.ownerPlayerId === otherPlayerId && zone.objects !== undefined) {
      violations.push(`opponent ${zone.zone} identities were listed at state ${projection.stateVersion}`);
    }
    if (zone.zone === "deck" && zone.order !== undefined) {
      violations.push(`deck order was listed at state ${projection.stateVersion}`);
    }
    if (zone.zone === "rune-deck" && zone.order !== undefined) {
      violations.push(`rune deck order was listed at state ${projection.stateVersion}`);
    }
  }
  for (const object of projection.objects) {
    if (object.ownerPlayerId !== otherPlayerId || (object.zone !== "hand" && object.zone !== "deck" && object.zone !== "rune-deck")) {
      continue;
    }
    if (object.cardId !== undefined || object.name !== undefined) {
      violations.push(`opponent hidden identity ${identity(object) ?? object.objectId} was listed at state ${projection.stateVersion}`);
    }
  }
  return { checkedProjections: audited.checkedProjections + 1, violations };
}
