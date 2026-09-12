/** A future native provider MUST verify the Tauri signature before resolving
 * downloadAndVerify. A JSON flag is never cryptographic verification. */
export interface UpdateCandidate { version: string }
export interface PreparedUpdate { install(): Promise<void>; dispose(): Promise<void> }
export interface UpdateProvider {
  check(signal: AbortSignal): Promise<UpdateCandidate | null>;
  downloadAndVerify(candidate: UpdateCandidate, signal: AbortSignal): Promise<PreparedUpdate>;
}
export type UpdateState = 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'preparing' | 'installing' | 'finished' | 'failed';

/** Preparation only: no network, download or restart without an injected provider. */
export class UpdatePreparation {
  state: UpdateState;
  private candidate: UpdateCandidate | null = null;
  private active: AbortController | null = null;
  constructor(private readonly provider: UpdateProvider | null = null) {
    this.state = provider ? 'idle' : 'disabled';
  }
  cancel() { this.active?.abort(); }
  async check() {
    if (!this.provider || this.active || this.state === 'installing' || this.state === 'finished') return;
    const abort = new AbortController(); this.active = abort;
    const timer = setTimeout(() => abort.abort(), 15_000);
    this.state = 'checking'; this.candidate = null;
    try {
      const candidate = await this.provider.check(abort.signal);
      abort.signal.throwIfAborted();
      if (candidate && !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(candidate.version)) throw new Error('Invalid version');
      this.candidate = candidate; this.state = candidate ? 'available' : 'current';
    } catch { this.state = 'failed'; }
    finally { clearTimeout(timer); this.active = null; }
  }
  async prepareAndInstall(secureWorkspace: () => Promise<boolean>) {
    if (!this.provider || !this.candidate || this.state !== 'available' || this.active) return;
    const abort = new AbortController(); this.active = abort; this.state = 'preparing';
    let prepared: PreparedUpdate | null = null;
    // Native provider must bound its I/O and honour cancellation too.
    const timer = setTimeout(() => abort.abort(), 120_000);
    try {
      prepared = await this.provider.downloadAndVerify(this.candidate, abort.signal);
      abort.signal.throwIfAborted();
      // Freeze editing, save work and drain collaboration just before restart.
      if (!await secureWorkspace()) { this.state = 'available'; return; }
      abort.signal.throwIfAborted(); this.state = 'installing';
      await prepared.install(); this.state = 'finished';
    } catch { this.state = 'failed'; }
    finally {
      clearTimeout(timer); this.active = null;
      await prepared?.dispose().catch(() => {});
    }
  }
}
