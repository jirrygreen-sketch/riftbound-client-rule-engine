import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ReplayJsonCodec {
  readonly reviveLegacyJournalCounters: (value: unknown) => unknown;
  readonly stringifyPersistedReplayJson: (value: unknown) => string;
}

const { reviveLegacyJournalCounters, stringifyPersistedReplayJson } = await import(
  new URL("../../../replay-core/src/canonical-json.ts", import.meta.url).href,
) as ReplayJsonCodec;

const JOURNAL_DIRECTORY = "/root/swarm-rift/shared/rift990-evidence/journals";

describe("RIFT-1030 headless journal determinism", () => {
  it.each(["046", "058", "060"])(
    "restores legacy counter maps and reproduces seed %s integrity",
    seed => {
      const file = readdirSync(JOURNAL_DIRECTORY).find(
        name => name.startsWith(`${seed}-`) && name.endsWith(".journal.json"),
      );
      expect(file, `missing journal for seed ${seed}`).toBeDefined();
      const archive = JSON.parse(
        readFileSync(`${JOURNAL_DIRECTORY}/${file}`, "utf8"),
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
});
