/** The animation clock. The renderer is the only place a figure requests frames. */
export interface FrameClock {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export const animationFrameClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** A clock that only moves when told to, for tests and for the probe. */
export class ManualClock implements FrameClock {
  private readonly pending = new Map<number, (now: number) => void>();
  private nextHandle = 1;
  now = 0;
  requests = 0;

  request(callback: (now: number) => void): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    this.requests++;
    return handle;
  }

  cancel(handle: number): void {
    this.pending.delete(handle);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Runs the callbacks pending now, as one animation frame `ms` later. */
  advance(ms = 1000 / 60): void {
    this.now += ms;
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(this.now);
  }

  /** Advances frame by frame until nothing is pending or `max` frames ran. */
  runUntilIdle(max = 1000, ms = 1000 / 60): number {
    let frames = 0;
    while (this.pending.size > 0 && frames < max) {
      this.advance(ms);
      frames++;
    }
    return frames;
  }
}
