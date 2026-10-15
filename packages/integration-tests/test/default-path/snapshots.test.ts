import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_PROFILE, DefaultPathDriver, ProjectionNormalizer, digest } from "../../src/default-path/driver.js";
import { DECK_FIXTURE, realDecks } from "../../src/default-path/decks.js";
import { scenarios } from "../../src/default-path/scenarios.js";

const directory = fileURLToPath(new URL("./snapshots/", import.meta.url));
const update = process.env.UPDATE_DEFAULT_PATH_SNAPSHOTS === "1";

describe("CLI default room path snapshots", () => {
  it("pins the CLI fallback and exact existing real deck submissions", async () => {
    const cli = await readFile(new URL("../../../../apps/game-server/src/index.ts", import.meta.url), "utf8");
    expect(cli).toContain('process.env.RIFTBOUND_DUEL_PROFILE ?? "p4"');
    expect(cli).toMatch(/duelRoomProfile === "p4" && requestedRuntimeProfile !== "public-chain-v1"\s*\? DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK : undefined/);
    const owner = await readFile(new URL("../../../../apps/game-server/src/duel/authoritative-runtime-p4.ts", import.meta.url), "utf8");
    expect(owner).toMatch(new RegExp(`DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK\\s*=\\s*["']${DEFAULT_RUNTIME_PROFILE}["']`));
    const fixture = await readFile(new URL(`../../../../${DECK_FIXTURE}`, import.meta.url), "utf8");
    const literal = fixture.match(/export const fury77RealDecks = (\{[\s\S]*\}) as const satisfies/);
    expect(literal, "The selected upstream fixture must still be a plain JSON deck literal").not.toBeNull();
    expect(realDecks).toEqual(JSON.parse(literal![1]!));
  });

  it("normalizes opaque identity consistently without dropping observable changes", () => {
    const first = "11111111-2222-4333-8444-555555555555";
    const second = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const normalize = (uid: string, readied = true) => new ProjectionNormalizer().normalize({
      unit: { uid, readied }, window: JSON.stringify([uid, 12]), references: [uid, uid]
    });
    expect(normalize(first)).toEqual(normalize(second));
    expect(digest(normalize(first))).not.toBe(digest(normalize(first, false)));
    expect(new ProjectionNormalizer().normalize([first, second, first])).toEqual(["uid-001", "uid-002", "uid-001"]);
  });

  for (const scenario of scenarios) {
    it(scenario.id, async () => {
      const driver = await DefaultPathDriver.create(scenario.seed);
      scenario.run(driver);
      const actual = driver.snapshot(scenario.id, scenario.coverage, scenario.stop);
      const path = `${directory}${scenario.id}.json`;
      const evidenceDirectory = process.env.DEFAULT_PATH_EVIDENCE_DIRECTORY;
      if (evidenceDirectory) {
        await mkdir(evidenceDirectory, { recursive: true });
        await writeFile(join(evidenceDirectory, `${scenario.id}.json`), `${JSON.stringify(actual, null, 2)}\n`);
      }
      if (update) {
        expect(process.env.DEFAULT_PATH_SNAPSHOT_REASON, "Snapshot updates require a review reason; semantic updates must cite CR v1.5 clauses").toBeTruthy();
        await mkdir(directory, { recursive: true });
        await writeFile(path, `${JSON.stringify(actual, null, 2)}\n`);
      } else {
        expect(actual).toEqual(JSON.parse(await readFile(path, "utf8")));
      }
    });
  }
});
