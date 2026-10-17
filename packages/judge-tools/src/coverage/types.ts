export const COVERAGE_REPORT_SCHEMA_VERSION = 1 as const;

export type CoverageStatus = "executable" | "judge-required" | "no-ability";
export type CoverageDependencyKind = "op" | "keyword" | "timing" | "task" | "rule";

export interface CoverageProgram {
  readonly canonicalCardId: string;
  readonly status: CoverageStatus;
  readonly judgeReason?: string;
  readonly set: string;
  readonly cardType: string;
}

export interface RegistryProgramInput {
  readonly canonicalCardId: string;
  readonly status: CoverageStatus;
  readonly judgeReason?: string;
  readonly set?: string;
  readonly cardSet?: string;
  readonly cardType?: string;
  readonly type?: string;
  readonly [key: string]: unknown;
}

export interface RegistryEntryMetadata {
  readonly set?: string;
  readonly cardType?: string;
}

export interface JudgeReasonDependencies {
  readonly ops: readonly string[];
  readonly keywords: readonly string[];
  readonly timings: readonly string[];
  readonly tasks: readonly string[];
  readonly rules: readonly string[];
}

export interface CoverageStatusCounts {
  readonly executable: number;
  readonly "judge-required": number;
  readonly "no-ability": number;
}

export interface CoverageGroup extends CoverageStatusCounts {
  readonly key: string;
  readonly totalCanonical: number;
  readonly coveragePercent: number;
  readonly executablePercentOfWithAbility: number;
}

export interface CoverageDependencyGap {
  readonly key: string;
  readonly kind: CoverageDependencyKind | "manual";
  readonly value: string;
  readonly canonicalCount: number;
  readonly sets: readonly string[];
  readonly canonicalCardIds: readonly string[];
}

export interface CoverageReport {
  readonly schemaVersion: typeof COVERAGE_REPORT_SCHEMA_VERSION;
  readonly source: {
    readonly registry: string;
    readonly identity: "canonical";
    readonly cardType: "registry-field-or-unknown";
  };
  readonly summary: {
    readonly totalCanonical: number;
    readonly counts: CoverageStatusCounts;
    readonly coveragePercent: number;
    readonly executablePercentOfWithAbility: number;
    readonly judgeRequiredWithoutParsedDependency: number;
  };
  readonly bySet: readonly CoverageGroup[];
  readonly byCardType: readonly CoverageGroup[];
  readonly dependencyGaps: readonly CoverageDependencyGap[];
  readonly manualReview: {
    readonly canonicalCount: number;
    readonly canonicalCardIds: readonly string[];
  };
}

export interface LoadedRegistry {
  readonly programs: readonly RegistryProgramInput[];
  readonly source: string;
}
