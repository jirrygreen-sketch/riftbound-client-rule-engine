import { runHeadlessGames } from "./duel.js";

const gamesFlag = process.argv.find(argument => argument.startsWith("--games="));
const gamesIndex = process.argv.indexOf("--games");
const rawGames = gamesFlag?.slice("--games=".length) ?? (gamesIndex >= 0 ? process.argv[gamesIndex + 1] : undefined) ?? "100";
const games = Number(rawGames);
if (!Number.isSafeInteger(games) || games < 1) throw new RangeError("--games must be a positive integer");
const summary = runHeadlessGames(games);
console.log(JSON.stringify({
  games: summary.games,
  completed: summary.completed,
  blocked: summary.blocked,
  exceptions: summary.exceptions,
  judgeRequiredRejections: summary.judgeRequiredRejections,
  terminationReasons: summary.terminationReasons,
  totalTurns: summary.totalTurns,
  gamesWithReplayMismatch: summary.gamesWithReplayMismatch,
  gamesWithPrivacyLeak: summary.gamesWithPrivacyLeak,
}, null, 2));
