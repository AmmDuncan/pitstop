type Opts = { idleMs: number; hasClients: () => boolean; onShutdown: () => void };

/** Fires onShutdown after idleMs of inactivity, provided no clients are connected. */
export class IdleTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: Opts) {}

  start() {
    this.touch();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  touch() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.opts.hasClients()) {
        this.touch();
        return;
      }
      this.opts.onShutdown();
    }, this.opts.idleMs);
  }
}
