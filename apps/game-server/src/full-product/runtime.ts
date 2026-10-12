import type { PlayerId, RoomDeckSubmission } from "@riftbound/protocol";
import {
  FULL_PRODUCT_EVENT_CONTRACT,
  FULL_PRODUCT_PROJECTION_CONTRACT,
  FULL_PRODUCT_PROTOCOL_VERSION,
  FULL_PRODUCT_RULESET_ID
} from "@riftbound/protocol/full-product";
import type {
  FullProductClientCommand,
  FullProductLegalAction,
  FullProductMatchResult,
  FullProductMatchSummary,
  FullProductRuntimeCommand,
  FullProductTargetSelection
} from "./types.js";

/**
 * Opaque authority owned by the rules runtime. The room adapter never returns
 * this value to a client and never interprets private card state.
 */
export interface FullProductRuntimeAuthority {
  readonly __fullProductRuntimeAuthority: symbol;
}

export interface FullProductRuntimeSnapshot {
  readonly summary: FullProductMatchSummary;
  readonly authority: FullProductRuntimeAuthority;
}

export interface FullProductRuntimeSeat {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly deck: RoomDeckSubmission;
}

export interface FullProductRuntimeMatchConfig {
  readonly seats: readonly FullProductRuntimeSeat[];
  readonly firstPlayerId: PlayerId;
}

export interface FullProductRuntimeStartResult {
  readonly snapshot: FullProductRuntimeSnapshot;
}

export interface FullProductRuntimeError {
  readonly code: string;
  readonly message: string;
}

export interface FullProductRuntimeCommandResult {
  readonly snapshot: FullProductRuntimeSnapshot;
  readonly error: FullProductRuntimeError | null;
}

export interface FullProductRuntimeCardInstance {
  readonly instanceId: string;
  readonly cardId: string;
}

export interface FullProductRuntimePlayerProjection {
  readonly id: PlayerId;
  readonly name: string;
  readonly score: number;
  readonly energy: number;
  readonly power: Readonly<Record<string, number>>;
  readonly zoneCounts: Readonly<Record<string, number>>;
  readonly handCount: number;
  readonly hand: readonly FullProductRuntimeCardInstance[];
  readonly playableInstanceIds: readonly string[];
}

export interface FullProductRuntimeProjectionObject {
  readonly objectId: string;
  readonly cardId: string;
  readonly zone: string;
  readonly controllerId: PlayerId;
  readonly ownerPlayerId: PlayerId;
  readonly faceUp: boolean;
  readonly visibility: "public" | "private";
  readonly damage?: number;
}

export interface FullProductRuntimeEvent {
  readonly eventContract: string;
  readonly type: string;
  readonly seq: number;
  readonly [key: string]: unknown;
}

export interface FullProductRuntimePromptOption {
  readonly optionId: string;
  readonly label: string;
  readonly targetInstanceId?: string;
}

export interface FullProductRuntimePrompt {
  readonly promptId: string;
  readonly ownerPlayerId: PlayerId;
  readonly stateVersion: number;
  readonly optional: boolean;
  readonly targetPolicy: {
    readonly minTargets: number;
    readonly maxTargets: number;
    readonly allowedZones: readonly string[];
  };
  readonly options: readonly FullProductRuntimePromptOption[];
}

export interface FullProductRuntimeProjection {
  readonly projectionContract: typeof FULL_PRODUCT_PROJECTION_CONTRACT;
  readonly protocolVersion: typeof FULL_PRODUCT_PROTOCOL_VERSION;
  readonly rulesetId: typeof FULL_PRODUCT_RULESET_ID;
  readonly summary: FullProductMatchSummary;
  readonly players: readonly FullProductRuntimePlayerProjection[];
  readonly objects: readonly FullProductRuntimeProjectionObject[];
  readonly prompt: FullProductRuntimePrompt | null;
  readonly events: readonly FullProductRuntimeEvent[];
}

export interface FullProductSanitizedProjection {
  readonly projectionContract: typeof FULL_PRODUCT_PROJECTION_CONTRACT;
  readonly protocolVersion: typeof FULL_PRODUCT_PROTOCOL_VERSION;
  readonly rulesetId: typeof FULL_PRODUCT_RULESET_ID;
  readonly viewerPlayerId: PlayerId | null;
  readonly version: number;
  readonly eventSeq: number;
  readonly phase: "main" | "ended";
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId;
  readonly priorityPlayerId: PlayerId;
  readonly winnerPlayerId: PlayerId | null;
  readonly waitingForPlayerId: PlayerId | null;
  readonly prompt: FullProductRuntimePrompt | null;
  readonly players: readonly {
    readonly id: PlayerId;
    readonly name: string;
    readonly score: number;
    readonly energy: number;
    readonly power: Readonly<Record<string, number>>;
    readonly zoneCounts: Readonly<Record<string, number>>;
    readonly handCount: number;
    readonly hand: readonly FullProductRuntimeCardInstance[];
    readonly playableInstanceIds: readonly string[] | null;
  }[];
  readonly objects: readonly FullProductRuntimeProjectionObject[];
  readonly events: readonly FullProductRuntimeEvent[];
}

/**
 * The only boundary through which card effects may run. Commands are always
 * stamped with the authenticated actor by the room adapter before submission.
 */
export interface FullProductRulesRuntime {
  createMatch(
    config: FullProductRuntimeMatchConfig
  ): FullProductRuntimeStartResult;
  submitCommand(
    snapshot: FullProductRuntimeSnapshot,
    command: FullProductRuntimeCommand
  ): FullProductRuntimeCommandResult;
  listLegalActions(
    snapshot: FullProductRuntimeSnapshot,
    playerId: PlayerId
  ): readonly FullProductLegalAction[];
  project(
    snapshot: FullProductRuntimeSnapshot,
    viewerPlayerId: PlayerId | null
  ): FullProductRuntimeProjection;
  matchResult(snapshot: FullProductRuntimeSnapshot): FullProductMatchResult | null;
}

export type { FullProductClientCommand, FullProductTargetSelection };
