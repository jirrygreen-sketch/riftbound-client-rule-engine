import { LayerEngine } from '../layers/engine.js';
import type { TimingEvent } from '../layers/types.js';

/** CR 317.1/317.2: Ending triggers precede the expiration special cleanup. */
export class TurnPhaseLayers extends LayerEngine {
  override advance(event: TimingEvent): readonly string[] {
    if (event.id === 'turn-end') {
      // Keep this-turn effects alive throughout the Ending Step's FEPR.
      return this.registry.expireInactive(ref => ref === undefined ? null : this.evaluate(ref));
    }
    return super.advance(event);
  }

  expireTurn(player: string): readonly string[] {
    return super.advance({ id: 'turn-end', player });
  }
}
