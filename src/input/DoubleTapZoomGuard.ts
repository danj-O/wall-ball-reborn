type TouchPoint = { identifier: number; x: number; y: number };
type Tap = TouchPoint & { time: number };

const MAX_TAP_DURATION_MS = 300;
const MAX_TAP_TRAVEL_PX = 18;
const DOUBLE_TAP_INTERVAL_MS = 350;
const DOUBLE_TAP_SEPARATION_PX = 44;

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Tracks only isolated, stationary taps. Multi-finger input and drags never enter the guard. */
export class DoubleTapZoomGuard {
  private start: Tap | null = null;
  private previous: Tap | null = null;

  begin(activeTouches: number, point: TouchPoint | null, time: number, eligible: boolean): void {
    if (activeTouches !== 1 || !point || !eligible) { this.cancel(); return; }
    this.start = { ...point, time };
  }

  move(activeTouches: number, point: TouchPoint | null): void {
    if (activeTouches !== 1 || !point || !this.start ||
        point.identifier !== this.start.identifier || distance(point, this.start) > MAX_TAP_TRAVEL_PX) {
      this.cancel();
    }
  }

  end(activeTouches: number, point: TouchPoint | null, time: number, eligible: boolean): boolean {
    const start = this.start;
    this.start = null;
    if (activeTouches !== 0 || !point || !eligible || !start ||
        point.identifier !== start.identifier || time - start.time > MAX_TAP_DURATION_MS ||
        distance(point, start) > MAX_TAP_TRAVEL_PX) {
      this.previous = null;
      return false;
    }
    const previous = this.previous;
    if (previous && time - previous.time <= DOUBLE_TAP_INTERVAL_MS &&
        distance(point, previous) <= DOUBLE_TAP_SEPARATION_PX) {
      this.previous = null;
      return true;
    }
    this.previous = { ...point, time };
    return false;
  }

  cancel(): void {
    this.start = null;
    this.previous = null;
  }
}
