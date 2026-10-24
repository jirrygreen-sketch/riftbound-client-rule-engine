import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replayHeadlessJournal, runHeadlessGame, type HeadlessJournal } from "../../src/headless/duel.js";

interface ReplayJsonCodec {
  readonly revivePersistedReplayJson: (value: unknown) => unknown;
  readonly reviveLegacyJournalCounters: (value: unknown) => unknown;
  readonly stringifyPersistedReplayJson: (value: unknown) => string;
}

const {
  reviveLegacyJournalCounters,
  revivePersistedReplayJson,
  stringifyPersistedReplayJson,
} = await import(
  new URL("../../../replay-core/src/canonical-json.ts", import.meta.url).href,
) as ReplayJsonCodec;

const journalDirectory = (): string => {
  const directory = process.env.RIFT_990_EVIDENCE_DIR;
  if (!directory) throw new Error("RIFT_990_EVIDENCE_DIR must name the read-only RIFT-990 evidence directory");
  return directory;
};

describe("RIFT-1030 headless journal determinism", () => {
  it.each(["046", "058", "060"])(
    "restores legacy counter maps and reproduces seed %s integrity",
    seed => {
      const directory = journalDirectory();
      const file = readdirSync(directory).find(
        name => name.startsWith(`${seed}-`) && name.endsWith(".journal.json"),
      );
      expect(file, `missing journal for seed ${seed}`).toBeDefined();
      const archive = JSON.parse(
        readFileSync(`${directory}/${file}`, "utf8"),
      ) as { readonly integrity?: string; readonly events: readonly unknown[] };
      const restored = reviveLegacyJournalCounters(archive) as {
        readonly integrity: string;
        readonly events: readonly {
          readonly object?: { readonly counters?: unknown };
        }[];
      };
      const { integrity, ...content } = restored;
      const digest = createHash("sha256")
        .update(stringifyPersistedReplayJson(content), "utf8")
        .digest("hex");

      expect(restored.events.length).toBeGreaterThan(0);
      expect(restored.events[18]?.object?.counters).toEqual({ map: [] });
      expect(digest).toBe(integrity);
    },
  );

  it("preserves runtime counters through canonical persisted JSON", () => {
    const runtime = {
      events: [{ object: { counters: new Map([["Ready", 0]]) } }],
      omitted: undefined,
    };
    const persisted = stringifyPersistedReplayJson(runtime);
    const restored = reviveLegacyJournalCounters(JSON.parse(persisted));
    const { integrity: _integrity, ...content } = {
      integrity: "irrelevant",
      ...restored as Record<string, unknown>,
    };

    expect(JSON.parse(persisted)).toEqual({
      events: [{ object: { counters: { map: [["Ready", 0]] } } }],
    });
    expect(stringifyPersistedReplayJson(content)).toBe(persisted);
  });

  it("fails explicitly when no historical evidence directory is provided", () => {
    const previous = process.env.RIFT_990_EVIDENCE_DIR;
    delete process.env.RIFT_990_EVIDENCE_DIR;
    try {
      expect(() => journalDirectory()).toThrow(/RIFT_990_EVIDENCE_DIR/);
    } finally {
      process.env.RIFT_990_EVIDENCE_DIR = previous;
    }
  });

  it.each(["046", "058", "060"])(
    "writes, reads, and strictly replays a fresh seed %s journal",
    async seed => {
      const directory = mkdtempSync(join(tmpdir(), `rift-1030-${seed}-`));
      try {
        let journal: HeadlessJournal | undefined;
        const result = runHeadlessGame(`RIFT-990-m1-seed-${seed}`, {
          decks: seed === "046" ? ["rumble-sfd", "fiora-sfd"] : ["fiora-sfd", "rumble-sfd"],
          maxTurns: 1,
          maxActions: 1,
          onJournal: value => { journal = value; },
        });
        expect(journal).toBeDefined();
        expect(result.replayMatches).toBe(true);

        const path = join(directory, `${seed}.journal.json`);
        await writeFile(path, `${stringifyPersistedReplayJson(journal!)}\n`);
        const restored = reviveLegacyJournalCounters(
          revivePersistedReplayJson(JSON.parse(await readFile(path, "utf8"))),
        ) as HeadlessJournal;
        const { integrity: _integrity, ...content } = restored;
        expect(createHash("sha256").update(stringifyPersistedReplayJson(content)).digest("hex"))
          .toBe(restored.integrity);
        expect(replayHeadlessJournal(restored)).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
