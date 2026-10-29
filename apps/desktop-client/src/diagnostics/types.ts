export type ClientLogLevel = "debug" | "info" | "warn" | "error";

export interface ClientLogEntry {
  readonly at: string;
  readonly level: ClientLogLevel;
  readonly source: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export type MatchLogKind = "projection" | "event" | "command" | "receipt" | "error" | "status";

export interface MatchLogEntry {
  readonly at: string;
  readonly kind: MatchLogKind;
  readonly stateVersion?: number;
  readonly eventSeq?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface MatchLogCapture {
  readonly roomId: string;
  readonly matchId: string | null;
  readonly protocol: "v2";
  readonly viewerPlayerId: string | null;
  readonly capturedAt: string;
  readonly entries: readonly MatchLogEntry[];
}

export type IssueReportPlatform = "desktop-macos" | "desktop-windows" | "desktop-linux" | "web";

export interface IssueReportV1 {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly createdAt: string;
  readonly title: string;
  readonly description: string;
  readonly client: {
    readonly appVersion: string;
    readonly platform: IssueReportPlatform;
    readonly userAgent: string;
    readonly serverUrl: string;
    readonly locale: string;
  };
  readonly player: { readonly name?: string; readonly roomId?: string; readonly playerId?: string };
  readonly clientLog: readonly ClientLogEntry[];
  readonly matchLog: MatchLogCapture | null;
}
