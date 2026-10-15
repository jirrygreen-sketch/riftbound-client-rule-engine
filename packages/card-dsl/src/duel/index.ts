/**
 * Duel subpath barrel. These exports are strict source-bound metadata/IR only:
 * they do not execute official abilities, create units, resolve costs or claim
 * that the Core executor is wired. See the individual modules for boundaries.
 */
export * from "./ability-bindings.js";
export * from "./official-programs.js";
export * from './optional-play-cost-v1.js';

export * from './assault-description-v1.js';
