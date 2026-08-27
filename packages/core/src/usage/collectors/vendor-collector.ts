/** Shared vendor usage source/collector plumbing. */
import {
  UsageContractError,
  parseProviderUsageSnapshot,
  type ProviderUsageSnapshot,
  type ProviderUsageStatus,
  type UsageSourceMetadata,
} from '../contract.js';

export interface VendorUsageSource<TPayload = unknown> {
  read(): Promise<TPayload>;
}

export interface VendorUsageCollectorSpec<TPayload> {
  readonly providerId: string;
  readonly displayName: string;
  sourceMetadata(): UsageSourceMetadata;
  /** Returns the snapshot status for a recognized source error, or undefined for any other error. */
  sourceErrorCode(err: unknown): ProviderUsageStatus | undefined;
  normalize(payload: TPayload, observedAtMs: number): ProviderUsageSnapshot;
}

export class VendorUsageCollector<TPayload> {
  constructor(
    protected readonly source: VendorUsageSource<TPayload>,
    private readonly spec: VendorUsageCollectorSpec<TPayload>,
  ) {}

  async collect(observedAtMs: number): Promise<ProviderUsageSnapshot> {
    if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs) || observedAtMs < 0) {
      throw new UsageContractError(`observedAtMs must be a non-negative finite integer number (got ${observedAtMs})`);
    }
    let payload: TPayload;
    try {
      payload = await this.source.read();
    } catch (err) {
      const code = this.spec.sourceErrorCode(err);
      return parseProviderUsageSnapshot({
        providerId: this.spec.providerId,
        displayName: this.spec.displayName,
        status: code ?? 'ERROR',
        observedAtMs,
        windows: [],
        source: this.spec.sourceMetadata(),
      });
    }
    return this.spec.normalize(payload, observedAtMs);
  }
}
