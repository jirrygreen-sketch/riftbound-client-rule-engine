import type {
  GameProjection,
  PlayerCommand,
  ProjectionObject,
  ProjectionZone
} from "@riftbound/protocol";

export type FullProductConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected";

export type FullProductZone =
  | "hand"
  | "deck"
  | "rune-deck"
  | "rune"
  | "board"
  | "battlefield"
  | "discard"
  | "banish"
  | "chain";

export type BoardProjectionZone =
  | FullProductZone
  | "base"
  | "champion"
  | "legend";

export interface PlayableCard {
  readonly instanceId: string;
  readonly cardId: string;
  readonly zone: FullProductZone;
  readonly title: string;
  readonly subtitle?: string;
  readonly imageUrl?: string | null;
}

export interface TargetOption {
  readonly id: string;
  readonly label: string;
  readonly objectId?: string;
  readonly playerId?: string;
  readonly cardId?: string;
  readonly disabled?: boolean;
  readonly reason?: string;
}

export interface PromptOption {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly reason?: string;
}

export interface ZoneSummary {
  readonly zone: BoardProjectionZone;
  readonly label: string;
  readonly count: number | null;
  readonly objects: readonly ProjectionObject[];
  readonly hidden: boolean;
  readonly selecting: boolean;
}

export interface LegalAction {
  readonly type: "pass" | "play-card" | "respond-to-prompt";
  readonly id: string;
  readonly label: string;
  readonly reason?: string;
  readonly disabled: boolean;
  readonly ready: boolean;
  readonly requiresCard?: boolean;
  readonly requiresTargets?: boolean;
  readonly selectedCardId?: string | null;
  readonly selectedTargetIds?: readonly string[];
  readonly command: PlayerCommand;
}

export interface ActionSelection {
  readonly actionId: string | null;
  readonly cardId: string | null;
  readonly targetIds: readonly string[];
}

export interface PlayableMatchView {
  readonly projection: GameProjection;
  readonly viewerPlayerId: string;
  readonly connectionStatus: FullProductConnectionStatus;
  readonly commandPending: boolean;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly targets?: Readonly<Record<string, readonly TargetOption[]>>;
  readonly targetRequirements?: Readonly<Record<string, readonly string[]>>;
  readonly promptOptionStates?: Readonly<
    Record<string, Readonly<Record<string, { disabled?: boolean; reason?: string }>>>
  >;
}

export interface SubmissionContext {
  readonly actionType: LegalAction["type"] | null;
  readonly cardId: string | null;
  readonly targetIds: readonly string[];
  readonly projection: GameProjection;
}

export type SubmitCommand = (
  command: PlayerCommand,
  context: SubmissionContext
) => void;
