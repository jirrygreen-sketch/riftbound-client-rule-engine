import type {
  CoverageDependencyGap,
  CoverageGroup,
  CoverageProgram,
  CoverageReport,
  CoverageStatus,
  CoverageStatusCounts,
  RegistryProgramInput
} from "./types.js";
import { dependencyEntries, parseJudgeReason } from "./parse-reason.js";

const STATUSES: readonly CoverageStatus[] = ["executable", "judge-required", "no-ability"];

function emptyCounts(): { executable: number; "judge-required": number; "no-ability": number } {
  return { executable: 0, "judge-required": 0, "no-ability": 0 };
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function toGroup(key: string, programs: readonly CoverageProgram[]): CoverageGroup {
  const counts = emptyCounts();
  for (const program of programs) counts[program.status] += 1;
  const totalCanonical = programs.length;
  const withAbility = totalCanonical - counts["no-ability"];
  return {
    key,
    totalCanonical,
    executable: counts.executable,
    "judge-required": counts["judge-required"],
    "no-ability": counts["no-ability"],
    coveragePercent: roundPercent((counts.executable / Math.max(totalCanonical, 1)) * 100),
    executablePercentOfWithAbility: roundPercent((counts.executable / Math.max(withAbility, 1)) * 100)
  };
}

function sortGroups(groups: readonly CoverageGroup[]): CoverageGroup[] {
  return [...groups].sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeSet(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "unknown";
}

function normalizeCardType(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "unknown";
}

function normalizeProgram(input: RegistryProgramInput): CoverageProgram {
  if (typeof input.canonicalCardId !== "string" || input.canonicalCardId.length === 0) {
    throw new Error("Coverage registry entries require canonicalCardId.");
  }
  if (!STATUSES.includes(input.status)) {
    throw new Error(`Unsupported coverage status for ${input.canonicalCardId}: ${String(input.status)}`);
  }
  return {
    canonicalCardId: input.canonicalCardId,
    status: input.status,
    ...(typeof input.judgeReason === "string" ? { judgeReason: input.judgeReason } : {}),
    set: normalizeSet(input.set ?? input.cardSet),
    cardType: normalizeCardType(input.cardType ?? input.type)
  };
}

function mergeDuplicatePrograms(programs: readonly CoverageProgram[]): CoverageProgram[] {
  const byId = new Map<string, CoverageProgram[]>();
  for (const program of programs) {
    const values = byId.get(program.canonicalCardId) ?? [];
    values.push(program);
    byId.set(program.canonicalCardId, values);
  }
  const merged: CoverageProgram[] = [];
  for (const [canonicalCardId, entries] of byId) {
    const statuses = new Set(entries.map(entry => entry.status));
    const status: CoverageStatus = statuses.has("judge-required")
      ? "judge-required"
      : statuses.has("executable")
        ? "executable"
        : "no-ability";
    const reason = entries.find(entry => entry.judgeReason)?.judgeReason;
    const sets = [...new Set(entries.map(entry => entry.set).filter(value => value !== "unknown"))].sort();
    const cardTypes = [...new Set(entries.map(entry => entry.cardType).filter(value => value !== "unknown"))].sort();
    merged.push({
      canonicalCardId,
      status,
      ...(reason === undefined ? {} : { judgeReason: reason }),
      set: sets.length === 0 ? "unknown" : sets.join("/"),
      cardType: cardTypes.length === 0 ? "unknown" : cardTypes.join("/")
    });
  }
  return merged.sort((left, right) => left.canonicalCardId.localeCompare(right.canonicalCardId));
}

export function buildCoverageReport(
  inputs: readonly RegistryProgramInput[],
  source = "card-dsl generated registry"
): CoverageReport {
  const programs = mergeDuplicatePrograms(inputs.map(normalizeProgram));
  const counts = emptyCounts();
  const bySet = new Map<string, CoverageProgram[]>();
  const byCardType = new Map<string, CoverageProgram[]>();
  const gaps = new Map<string, { kind: CoverageDependencyGap["kind"]; value: string; programs: CoverageProgram[] }>();
  const manual: CoverageProgram[] = [];

  for (const program of programs) {
    counts[program.status] += 1;
    const setPrograms = bySet.get(program.set) ?? [];
    setPrograms.push(program);
    bySet.set(program.set, setPrograms);
    const typePrograms = byCardType.get(program.cardType) ?? [];
    typePrograms.push(program);
    byCardType.set(program.cardType, typePrograms);
    if (program.status !== "judge-required") continue;

    const dependencies = dependencyEntries(parseJudgeReason(program.judgeReason));
    if (dependencies.length === 0) manual.push(program);
    for (const dependency of dependencies) {
      const key = `${dependency.kind}:${dependency.value}`;
      const existing = gaps.get(key) ?? { kind: dependency.kind, value: dependency.value, programs: [] };
      existing.programs.push(program);
      gaps.set(key, existing);
    }
  }

  const dependencyGaps = [...gaps.entries()]
    .map(([key, value]) => ({
      key,
      kind: value.kind,
      value: value.value,
      canonicalCount: new Set(value.programs.map(program => program.canonicalCardId)).size,
      sets: [...new Set(value.programs.map(program => program.set))].sort(),
      canonicalCardIds: [...new Set(value.programs.map(program => program.canonicalCardId))].sort()
    }))
    .sort((left, right) => right.canonicalCount - left.canonicalCount || left.key.localeCompare(right.key));

  const groups = (map: ReadonlyMap<string, readonly CoverageProgram[]>): CoverageGroup[] =>
    sortGroups([...map.entries()].map(([key, values]) => toGroup(key, values)));
  const totalCanonical = programs.length;
  const withAbility = totalCanonical - counts["no-ability"];
  return {
    schemaVersion: 1,
    source: { registry: source, identity: "canonical", cardType: "registry-field-or-unknown" },
    summary: {
      totalCanonical,
      counts,
      coveragePercent: roundPercent((counts.executable / Math.max(totalCanonical, 1)) * 100),
      executablePercentOfWithAbility: roundPercent((counts.executable / Math.max(withAbility, 1)) * 100),
      judgeRequiredWithoutParsedDependency: manual.length
    },
    bySet: groups(bySet),
    byCardType: groups(byCardType),
    dependencyGaps,
    manualReview: {
      canonicalCount: manual.length,
      canonicalCardIds: manual.map(program => program.canonicalCardId).sort()
    }
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace(/\.00$/, "")}%`;
}

function table(groups: readonly CoverageGroup[]): string[] {
  return [
    "| 分组 | canonical | executable | judge-required | no-ability | 覆盖率 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...groups.map(group =>
      `| ${group.key} | ${group.totalCanonical} | ${group.executable} | ${group["judge-required"]} | ${group["no-ability"]} | ${formatPercent(group.coveragePercent)} |`
    )
  ];
}

export function renderCoverageMarkdown(report: CoverageReport): string {
  const top = report.dependencyGaps.slice(0, 15);
  const lines = [
    "# Judge coverage report",
    "",
    "Generated from the card-dsl generated registry. Counts use canonical card identities.",
    "",
    `- Total canonical programs: **${report.summary.totalCanonical}**`,
    `- Executable: **${report.summary.counts.executable}**`,
    `- Judge-required: **${report.summary.counts["judge-required"]}**`,
    `- No ability: **${report.summary.counts["no-ability"]}**`,
    `- Coverage (executable / all canonical): **${formatPercent(report.summary.coveragePercent)}**`,
    `- Coverage (executable / canonical identities with ability): **${formatPercent(report.summary.executablePercentOfWithAbility)}**`,
    `- Judge-required cards needing manual classification: **${report.summary.judgeRequiredWithoutParsedDependency}**`,
    "",
    "The registry does not currently expose card type metadata. The card-type table therefore reports `unknown` until that field is added to the CardProgram contract.",
    "",
    "## By set",
    "",
    ...table(report.bySet),
    "",
    "## By card type",
    "",
    ...table(report.byCardType),
    "",
    "## Top 15 missing dependencies",
    "",
    "Sorted by the number of affected canonical identities. A card can occur in multiple dependency rows when its reason names multiple gaps.",
    "",
    "| Rank | Dependency | Kind | Canonical cards | Sets |",
    "| ---: | --- | --- | ---: | --- |",
    ...top.map((gap, index) => `| ${index + 1} | \`${gap.value}\` | ${gap.kind} | ${gap.canonicalCount} | ${gap.sets.join(", ")} |`),
    "",
    "## Manual classification",
    "",
    `**${report.manualReview.canonicalCount}** canonical identities have a judge-required status but no parseable dependency clue. Their IDs are retained in report.json for follow-up review.`,
    ""
  ];
  return `${lines.join("\n")}\n`;
}
