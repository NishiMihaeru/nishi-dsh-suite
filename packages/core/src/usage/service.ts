import {
  UsageContractError,
  parseProviderUsageSnapshot,
  type ProviderUsageSnapshot,
} from './contract.js';

export interface UsageSnapshotCollector {
  collect(observedAtMs: number): Promise<ProviderUsageSnapshot>;
}

export interface UsageRefreshPolicy {
  minRefreshIntervalMs: number;
  staleAfterMs: number;
}

export interface UsageProviderRegistration {
  providerId: string;
  collector: UsageSnapshotCollector;
  policy: UsageRefreshPolicy;
}

export type UsageClock = () => number;

export interface RefreshProviderOptions {
  force?: boolean;
}

function assertPlainObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageContractError(`${context} must be a non-null plain object`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UsageContractError(`${context} must be a non-empty string`);
  }
  return value.trim();
}

function assertNonNegativeSafeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new UsageContractError(`${context} must be a non-negative safe integer number`);
  }
  return value;
}

function assertPositiveSafeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new UsageContractError(`${context} must be a positive safe integer number`);
  }
  return value;
}

export class UsageLimitsService {
  private readonly registrations = new Map<string, UsageProviderRegistration>();
  private readonly registrationOrder: string[] = [];
  private readonly clock: UsageClock;
  private readonly cache = new Map<string, ProviderUsageSnapshot>();
  private readonly inFlight = new Map<string, Promise<ProviderUsageSnapshot>>();
  private readonly invalidationTokens = new Map<string, symbol>();

  constructor(registrations: readonly UsageProviderRegistration[], clock: UsageClock) {
    if (!Array.isArray(registrations)) throw new UsageContractError('registrations must be an array');
    if (typeof clock !== 'function') throw new UsageContractError('clock must be a callable function');
    this.clock = clock;

    for (let i = 0; i < registrations.length; i++) {
      this.register(registrations[i], `registrations[${i}]`);
    }
  }

  /**
   * Register one provider's collector, and return the withdrawal callback.
   *
   * Providers mount after the core does — cordis defers them until this
   * service's context exists — so the roster cannot be a constructor
   * argument. It is derived from registrations, which is also what lets a
   * provider mounted later appear in the UI and an unmounted one leave no
   * placeholder behind.
   */
  register(registration: UsageProviderRegistration, context = 'registration'): () => void {
    const obj = assertPlainObject(registration, context);
    const providerId = assertNonEmptyString(obj.providerId, `${context}.providerId`);
    if (this.registrations.has(providerId)) {
      throw new UsageContractError(`Duplicate registration for providerId "${providerId}"`);
    }
    const collector = obj.collector as UsageSnapshotCollector;
    if (!collector || typeof collector !== 'object' || typeof collector.collect !== 'function') {
      throw new UsageContractError(`${context}.collector must be an object with a callable collect method`);
    }
    const policyObj = assertPlainObject(obj.policy, `${context}.policy`);
    const minRefreshIntervalMs = assertNonNegativeSafeInteger(policyObj.minRefreshIntervalMs, `${context}.policy.minRefreshIntervalMs`);
    const staleAfterMs = assertPositiveSafeInteger(policyObj.staleAfterMs, `${context}.policy.staleAfterMs`);
    const entry: UsageProviderRegistration = {
      providerId,
      collector: { collect: collector.collect.bind(collector) },
      policy: { minRefreshIntervalMs, staleAfterMs },
    };
    this.registrations.set(providerId, entry);
    this.registrationOrder.push(providerId);

    return () => {
      if (this.registrations.get(providerId) !== entry) return;
      this.registrations.delete(providerId);
      const at = this.registrationOrder.indexOf(providerId);
      if (at >= 0) this.registrationOrder.splice(at, 1);
      this.cache.delete(providerId);
      this.inFlight.delete(providerId);
      this.invalidationTokens.delete(providerId);
    };
  }

  private sampleClock(): number {
    return assertNonNegativeSafeInteger(this.clock(), 'clock sample');
  }

  private getRegistration(providerId: string): UsageProviderRegistration {
    const reg = this.registrations.get(providerId);
    if (!reg) throw new UsageContractError(`Provider "${providerId}" is not registered`);
    return reg;
  }

  async refreshProvider(providerId: string, options?: RefreshProviderOptions): Promise<ProviderUsageSnapshot> {
    const reg = this.getRegistration(providerId);
    if (options !== undefined && options !== null) {
      if (typeof options !== 'object' || Array.isArray(options)) throw new UsageContractError('options must be a plain object');
      if (options.force !== undefined && typeof options.force !== 'boolean') throw new UsageContractError('options.force must be a boolean');
    }
    const force = options?.force === true;
    const existingInFlight = this.inFlight.get(providerId);
    if (existingInFlight) return parseProviderUsageSnapshot(await existingInFlight);

    const now = this.sampleClock();
    const cached = this.cache.get(providerId);
    const invalidationTokenAtStart = this.invalidationTokens.get(providerId);
    const isInvalidated = invalidationTokenAtStart !== undefined;

    if (cached !== undefined && !force && !isInvalidated) {
      const refreshDeadline = cached.observedAtMs + reg.policy.minRefreshIntervalMs;
      if (!Number.isSafeInteger(refreshDeadline)) throw new UsageContractError('Refresh deadline calculation overflowed safe integer range');
      if (now < refreshDeadline) return parseProviderUsageSnapshot(cached);
    }

    const refreshPromise = (async (): Promise<ProviderUsageSnapshot> => {
      const rawSnapshot = await reg.collector.collect(now);
      const validated = parseProviderUsageSnapshot(rawSnapshot);
      if (validated.providerId !== reg.providerId) {
        throw new UsageContractError(`Collector for provider "${reg.providerId}" returned snapshot with mismatched providerId "${validated.providerId}"`);
      }
      if (validated.observedAtMs !== now) {
        throw new UsageContractError(`Collector for provider "${reg.providerId}" returned snapshot with mismatched observedAtMs (${validated.observedAtMs} !== ${now})`);
      }
      let staleAtMs = validated.staleAtMs;
      if (staleAtMs === undefined) {
        const candidate = validated.observedAtMs + reg.policy.staleAfterMs;
        if (!Number.isSafeInteger(candidate) || candidate < validated.observedAtMs) {
          throw new UsageContractError('Staleness timestamp computation overflowed safe integer range');
        }
        staleAtMs = candidate;
      }
      const finalSnapshot = parseProviderUsageSnapshot({ ...validated, staleAtMs });
      this.cache.set(providerId, finalSnapshot);
      if (this.invalidationTokens.get(providerId) === invalidationTokenAtStart) this.invalidationTokens.delete(providerId);
      return finalSnapshot;
    })();

    this.inFlight.set(providerId, refreshPromise);
    try {
      return parseProviderUsageSnapshot(await refreshPromise);
    } finally {
      this.inFlight.delete(providerId);
    }
  }

  getCachedSnapshot(providerId: string): ProviderUsageSnapshot | undefined {
    this.getRegistration(providerId);
    const cached = this.cache.get(providerId);
    return cached ? parseProviderUsageSnapshot(cached) : undefined;
  }

  invalidate(providerId: string): void {
    this.getRegistration(providerId);
    this.invalidationTokens.set(providerId, Symbol());
  }

  getRegisteredProviderIds(): readonly string[] {
    return [...this.registrationOrder];
  }

  getCachedSnapshots(): ProviderUsageSnapshot[] {
    const result: ProviderUsageSnapshot[] = [];
    for (const id of this.registrationOrder) {
      const cached = this.cache.get(id);
      if (cached) result.push(parseProviderUsageSnapshot(cached));
    }
    return result;
  }
}
