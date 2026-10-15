import {
  inspectDuelResourceCommandV2,
  inspectDuelPendingPaymentV2,
  projectCanonicalDuelMatchV2,
  projectCanonicalDuelMatchV3,
  type DuelCommandSessionV2,
} from "@riftbound/engine-core/duel";
import {
  DUEL_PROJECTION_SCHEMA_V2,
  DUEL_PROJECTION_SCHEMA_V3,
  isDuelProjectionV2,
  isDuelProjectionV3,
  type DuelProjectionV2,
  type DuelProjectionV3,
  type DuelWireAction,
  type DuelWireCommand,
  type DuelWireDomain,
  type DuelWireMatchV2,
} from "@riftbound/protocol";
import type { DuelRuntimeSessionV3 } from "./session.js";

const DOMAIN_LABEL: Readonly<Record<DuelWireDomain, string>> = {
  Fury: "炽烈",
  Calm: "翠意",
  Mind: "灵光",
  Body: "摧破",
  Chaos: "混沌",
  Order: "序理",
};

/**
 * The authoritative legal commands are checked by the Core V2 read-only resource
 * inspector. It reuses the resource kernels on detached values and never allocates a
 * successor, receipt, native commit or source attestation. Mulligan is never probed
 * (it would consume real shuffle RNG). Pay-pending instead uses its dedicated inspector:
 * probing a real pay would invoke a potentially one-use source attestor.
 */
function projectActionsV2(
  session: DuelCommandSessionV2,
  viewer: string | null,
  match: DuelWireMatchV2,
  options: DuelRuntimeProjectionOptionsV2,
): readonly DuelWireAction[] {
  if (viewer === null) return [];
  const actionId = (kind: DuelWireAction["kind"], source: string): string =>
    JSON.stringify([match.matchId, viewer, match.stateVersion, kind, source]);
  if (match.stage === "setup") {
    if (match.setup.stage !== "mulligan" || match.setup.currentMulliganOwner !== viewer) return [];
    const hand = match.setup.players.find((player) => player.playerId === viewer)?.hand;
    if (!hand) throw new TypeError("Duel V2 owner hand is unavailable");
    return [{
      id: actionId("mulligan", "hand"),
      kind: "mulligan",
      label: "选择重调手牌（最多 2 张）",
      enabled: true,
      selectableUIDs: hand.map((card) => card.uid),
      maxSelections: 2,
    }];
  }
  // The public V2 guard forbids any action at the constructor handoff and once ended.
  if (match.frame.phase === "awaiting-turn-start" || match.frame.phase === "ended") return [];

  const legal = (command: Extract<DuelWireCommand,
    { readonly type: "rune-energy" | "rune-power" | "gold-power" }>): boolean => {
    return inspectDuelResourceCommandV2(session, viewer, match.stateVersion, command).status === "legal";
  };

  const base = match.resources.bases.find((item) => item.playerId === viewer);
  if (!base) throw new TypeError("Duel V2 resource base is unavailable");
  const actions: DuelWireAction[] = [];
  for (const rune of base.baseRunes) {
    const energy = legal({ type: "rune-energy", uid: rune.uid });
    actions.push({
      id: actionId("rune-energy", rune.uid), kind: "rune-energy", uid: rune.uid,
      label: `横置${DOMAIN_LABEL[rune.domain]}符文：+1 能量`, enabled: energy,
      ...(!energy ? { reason: "当前不能横置该符文" } : {}),
    });
    const power = legal({ type: "rune-power", uid: rune.uid });
    actions.push({
      id: actionId("rune-power", rune.uid), kind: "rune-power", uid: rune.uid,
      label: `回收${DOMAIN_LABEL[rune.domain]}符文：+1 ${DOMAIN_LABEL[rune.domain]}符能`, enabled: power,
      ...(!power ? { reason: "当前不能回收该符文" } : {}),
    });
  }
  for (const gold of base.goldTokens) {
    const enabled = legal({ type: "gold-power", uid: gold.uid });
    actions.push({
      id: actionId("gold-power", gold.uid), kind: "gold-power", uid: gold.uid,
      label: "横置并消灭金币：+1 任意符能", enabled,
      ...(!enabled ? { reason: "当前不能消灭该金币" } : {}),
    });
  }
  // Cost/ID are already owner-only in the canonical public projection: only the payment
  // actor sees the payment ID, so only that viewer ever builds a pay-pending action.
  const payment = match.frame.pendingPayment;
  if (payment?.paymentId !== undefined) {
    const inspection = inspectDuelPendingPaymentV2(session, viewer, match.stateVersion,
      { type: "pay-pending", paymentId: payment.paymentId });
    // Availability is a trusted server configuration hint, not an attestation or
    // payment authority. Even an enabled action can fail on real re-attestation.
    const enabled = inspection.status === "requires-reattest" &&
      options.paymentAttestationAvailable === true;
    actions.push({
      id: actionId("pay-pending", payment.paymentId), kind: "pay-pending",
      paymentId: payment.paymentId, label: "支付待结算费用", enabled,
      ...(payment.resolvedCost ? { resolvedCost: payment.resolvedCost } : {}),
      ...(!enabled ? { reason: inspection.status === "blocked"
        ? "当前费用无法支付" : "支付来源验证暂不可用" } : {}),
    });
  }
  return actions;
}

/** Trusted server availability hint; never accepts or calls the source attestor. */
export interface DuelRuntimeProjectionOptionsV2 {
  readonly paymentAttestationAvailable?: boolean;
}

/**
 * Build the V2 public projection from the trusted V2 match. Hidden-zone filtering is
 * owned by the canonical V2 projector; the strict V2 public DTO guard fails closed.
 */
export function projectDuelRuntimeV2(
  session: DuelCommandSessionV2,
  viewer: string | null,
  options: DuelRuntimeProjectionOptionsV2 = {},
): DuelProjectionV2 {
  const match = projectCanonicalDuelMatchV2(session.match, viewer);
  const candidate = {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
    viewerPlayerId: viewer,
    match,
    actions: projectActionsV2(session, viewer, match, options),
  };
  if (!isDuelProjectionV2(candidate)) throw new TypeError("Duel V2 projection violates public protocol");
  return candidate;
}

/** Trusted server availability hint; never accepts or calls the source attestor. */
export type DuelRuntimeProjectionOptionsV3 = DuelRuntimeProjectionOptionsV2;

/**
 * Build the exact `riftbound-duel-v3` (schemaVersion 3) projection.
 *
 * The authenticated `viewer` is passed directly into the genuine V3 projector; an
 * unadmitted/V1/cloned/forged authority is rejected there before any field is read
 * (the V3 projector asserts membership first). Legal actions are then taken from the
 * existing V2 action projection over the SAME session and viewer, so the five
 * existing actions stay bound to the same authority and hidden zones. The strict V3
 * public guard is run on the same-viewer DTO before it is returned.
 */
export function projectDuelRuntimeV3(
  session: DuelRuntimeSessionV3,
  viewer: string | null,
  options: DuelRuntimeProjectionOptionsV3 = {},
): DuelProjectionV3 {
  const match = projectCanonicalDuelMatchV3(session.match, viewer);
  // Discard the V2 wire match: only the viewer-bound five-action computation is reused.
  const actions = projectDuelRuntimeV2(session, viewer, options).actions;
  const candidate = {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V3,
    viewerPlayerId: viewer,
    match,
    actions,
  };
  if (!isDuelProjectionV3(candidate)) throw new TypeError("Duel V3 projection violates public protocol");
  return candidate;
}
