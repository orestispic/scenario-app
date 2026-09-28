/**
 * Fences asynchronous authentication forms by initiation order.
 *
 * SessionManager protects token persistence, but a login request can finish in
 * a different order from the one in which the user launched it.  The UI uses
 * this tiny token-free fence before handing a returned session to the manager.
 */
export class AuthenticationAttemptFence {
  private generation = 0;

  start(): number {
    return ++this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(attempt: number): boolean {
    return attempt === this.generation;
  }
}
