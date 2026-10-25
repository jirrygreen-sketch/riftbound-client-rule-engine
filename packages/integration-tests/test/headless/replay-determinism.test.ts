import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
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

describe("RIFT-1030 headless journal determinism", () => {
  // RIFT-1049: the RIFT-990 archives for seeds 046/058/060 were written with
  // plain JSON.stringify, which turned every empty counter Map into {}. This
  // self-contained archive reproduces that legacy shape, so the suite no
  // longer depends on an external evidence directory (RIFT_990_EVIDENCE_DIR).
  it("restores legacy empty counter maps and reproduces the archived integrity", () => {
    const content = {
      seed: "RIFT-1049-legacy",
      events: [
        { eventSeq: 1, object: { ref: { id: "unit-1", zoneEntryId: 1 }, counters: new Map<string, number>() } },
        { eventSeq: 2, object: { ref: { id: "unit-2", zoneEntryId: 1 }, counters: new Map<string, number>() } },
      ],
    };
    const integrity = createHash("sha256").update(stringifyPersistedReplayJson(content), "utf8").digest("hex");
    const legacyArchive = JSON.parse(JSON.stringify({ ...content, integrity })) as Record<string, unknown>;
    expect((legacyArchive.events as { object: { counters: unknown } }[])[0]!.object.counters).toEqual({});

    const restored = reviveLegacyJournalCounters(legacyArchive) as {
      readonly integrity: string;
      readonly events: readonly { readonly object?: { readonly counters?: unknown } }[];
    };
    const { integrity: archived, ...restoredContent } = restored;
    expect(restored.events[0]?.object?.counters).toEqual({ map: [] });
    expect(createHash("sha256").update(stringifyPersistedReplayJson(restoredContent), "utf8").digest("hex"))
      .toBe(archived);
    const revived = revivePersistedReplayJson(restoredContent) as typeof content;
    expect(revived.events[1]!.object.counters).toBeInstanceOf(Map);
  });

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
