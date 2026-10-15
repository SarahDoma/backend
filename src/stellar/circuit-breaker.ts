export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerMetrics {
  state: CircuitState;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  rejectedCalls: number;
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Soroban RPC circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = false;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private rejectedCalls = 0;

  constructor(
    private readonly failureThreshold = 3,
    private readonly resetTimeoutMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.prepareAttempt();

    try {
      const result = await operation();
      this.totalSuccesses += 1;
      this.consecutiveFailures = 0;
      this.state = 'CLOSED';
      this.halfOpenInFlight = false;
      return result;
    } catch (error) {
      this.totalFailures += 1;
      this.consecutiveFailures += 1;
      this.halfOpenInFlight = false;
      if (
        this.state === 'HALF_OPEN' ||
        this.consecutiveFailures >= this.failureThreshold
      ) {
        this.state = 'OPEN';
        this.openedAt = this.now();
      }
      throw error;
    }
  }

  metrics(): CircuitBreakerMetrics {
    return {
      state: this.currentState(),
      consecutiveFailures: this.consecutiveFailures,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      rejectedCalls: this.rejectedCalls,
    };
  }

  private prepareAttempt(): void {
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt < this.resetTimeoutMs) {
        this.rejectedCalls += 1;
        throw new CircuitOpenError();
      }
      this.state = 'HALF_OPEN';
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenInFlight) {
        this.rejectedCalls += 1;
        throw new CircuitOpenError();
      }
      this.halfOpenInFlight = true;
    }
  }

  private currentState(): CircuitState {
    if (
      this.state === 'OPEN' &&
      this.now() - this.openedAt >= this.resetTimeoutMs
    ) {
      return 'HALF_OPEN';
    }
    return this.state;
  }
}
