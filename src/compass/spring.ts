/**
 * A damped spring, solved exactly. The compass needle is one of these: it swings past the target a little and
 * settles, like a magnetised needle on a jewel bearing.
 *
 * The step uses the closed-form solution of x'' + 2*damping*frequency*x' + frequency^2*x = 0, so it stays stable
 * for any frame time and gives the same result whether a second passes in one step or in sixty.
 */
export interface SpringState {
  /** Current value. For the needle this is a bearing in radians and is not wrapped. */
  readonly value: number;
  /** Rate of change per second. */
  readonly velocity: number;
}

export interface SpringParams {
  /** Natural frequency in radians per second. Higher is snappier. */
  readonly frequency: number;
  /** Damping ratio. Below 1 the spring overshoots, at 1 it is critically damped, above 1 it creeps. */
  readonly damping: number;
}

/**
 * A lively needle. Small, light things in this scene are underdamped (ratio a little under 0.5) and heavy things
 * sit near critical damping. This is stiffness 64 with damping 7.5 for unit mass: about 19 % overshoot on the
 * first swing, at rest after roughly a second and a half.
 */
export const NEEDLE_SPRING: SpringParams = { frequency: 8, damping: 0.47 };

/** Converts the stiffness `k` and damping `c` of a unit-mass spring into the form used here. */
export function springFromStiffness(k: number, c: number): SpringParams {
  const frequency = Math.sqrt(Math.max(1e-8, k));
  return { frequency, damping: c / (2 * frequency) };
}

/** Advances the spring by `dt` seconds towards `target`. Pure: returns a new state. */
export function stepSpring(state: SpringState, target: number, dt: number, params: SpringParams): SpringState {
  if (!(dt > 0)) return state;
  const w = Math.max(1e-4, params.frequency);
  const z = Math.max(0, params.damping);
  const x0 = state.value - target;
  const v0 = state.velocity;

  if (z < 1 - 1e-6) {
    const wd = w * Math.sqrt(1 - z * z);
    const decay = Math.exp(-z * w * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    const x = decay * (x0 * cos + ((v0 + z * w * x0) / wd) * sin);
    const v = decay * (v0 * cos - ((z * w * v0 + w * w * x0) / wd) * sin);
    return { value: target + x, velocity: v };
  }

  if (z <= 1 + 1e-6) {
    const decay = Math.exp(-w * dt);
    const k = v0 + w * x0;
    return { value: target + decay * (x0 + k * dt), velocity: decay * (v0 - w * k * dt) };
  }

  const root = w * Math.sqrt(z * z - 1);
  const r1 = -z * w + root;
  const r2 = -z * w - root;
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  const c1 = x0 - c2;
  const e1 = Math.exp(r1 * dt);
  const e2 = Math.exp(r2 * dt);
  return { value: target + c1 * e1 + c2 * e2, velocity: c1 * r1 * e1 + c2 * r2 * e2 };
}

/** How far past the target the first swing goes, as a fraction of the distance travelled. 0 when it cannot overshoot. */
export function springOvershoot(damping: number): number {
  if (damping >= 1) return 0;
  if (damping <= 0) return 1;
  return Math.exp((-Math.PI * damping) / Math.sqrt(1 - damping * damping));
}

/** True when the spring is close enough to the target, and slow enough, to be treated as at rest. */
export function springAtRest(state: SpringState, target: number, epsilon = 1e-3): boolean {
  return Math.abs(state.value - target) < epsilon && Math.abs(state.velocity) < epsilon;
}
