import { runV2DuelBatch } from "./runner.js";

// Script entry point: run with the workspace TypeScript runner, e.g.
// apps/game-server/node_modules/.bin/tsx packages/integration-tests/src/v2-duel/cli.ts.

function value(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const games = Number(value("games", "100"));
if (!Number.isSafeInteger(games) || games < 1) throw new RangeError("--games must be a positive integer");
const seeds = value("seeds", "").split(",").map(seed => seed.trim()).filter(Boolean);
const outputDirectory = value("output-directory", `/tmp/${process.env.SWARM_TASK ?? "RIFT-955-v2-two-client-duel"}/v2-duel`);
const maxActions = Number(value("max-actions", "500"));
if (!Number.isSafeInteger(maxActions) || maxActions < 1) throw new RangeError("--max-actions must be a positive integer");
const summary = await runV2DuelBatch({ games, outputDirectory,
  maxActions, ...(seeds.length === 0 ? {} : { seeds }) });
const { results, ...aggregate } = summary;
console.log(JSON.stringify({ ...aggregate, resultFiles: results.map(result =>
  `${outputDirectory}/${result.seed}.ndjson`) }, null, 2));
