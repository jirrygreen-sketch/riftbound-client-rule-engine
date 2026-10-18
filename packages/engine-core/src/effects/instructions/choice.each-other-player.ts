import type { InstructionDef, InstructionResult, ResolveContext } from "../contract.js";
import type { EachPlayerArgs } from "./choice.each-player.js";
import { argsSchema, executeEachPlayer } from "./choice.each-player.js";

/**
 * The “each other player” spelling is kept as a separate opcode so card IR
 * can preserve its printed scope. It shares the player walk and receipt shape
 * with choice.each-player, while excluding the ability controller.
 */
const definition = {
  op: "choice.each-other-player",
  argsSchema,
  execute(context: ResolveContext, args: EachPlayerArgs): InstructionResult {
    return executeEachPlayer(context, args, "each-other-player");
  }
} satisfies InstructionDef<EachPlayerArgs>;

export default definition;
