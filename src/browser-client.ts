import {
  parseTerminologyManifest,
  parseTerminologySnapshot,
  type TerminologyManifestEntry,
  type TerminologySnapshot,
} from 'terminology-data-utils-ts';
import {
  TerminologySnapshotRegistryMemory,
  type TerminologyEntrySelection,
  type TerminologySearchInput,
} from 'terminology-sdk-core-ts';

export type TerminologySynchronizationStatus = 'current' | 'updated';

export type TerminologySnapshotRecord = Readonly<{
  snapshotId: string;
  sha256: string;
  bytes: Uint8Array;
}>;

export interface TerminologySnapshotStore {
  get(snapshotId: string): Promise<TerminologySnapshotRecord | undefined>;
  put(record: TerminologySnapshotRecord): Promise<void>;
}

export class TerminologySnapshotStoreMemory implements TerminologySnapshotStore {
  readonly #records = new Map<string, TerminologySnapshotRecord>();

  public async get(snapshotId: string): Promise<TerminologySnapshotRecord | undefined> {
    return this.#records.get(snapshotId);
  }

  public async put(record: TerminologySnapshotRecord): Promise<void> {
    this.#records.set(record.snapshotId, Object.freeze({
      ...record,
      bytes: new Uint8Array(record.bytes),
    }));
  }
}

/** High-level browser facade: synchronize once, then search entirely in memory. */
export class TerminologyBrowserClient {
  readonly #manifestUrl: URL;
  readonly #store: TerminologySnapshotStore;
  readonly #fetch: typeof fetch;
  readonly #registry = new TerminologySnapshotRegistryMemory();

  public constructor(options: Readonly<{
    manifestUrl: string;
    /** Optional SSR/test origin; browsers use globalThis.location automatically. */
    baseUrl?: string;
    store: TerminologySnapshotStore;
    fetchImplementation?: typeof fetch;
  }>) {
    const baseUrl = options.baseUrl ?? globalThis.location?.href;
    if (!URL.canParse(options.manifestUrl, baseUrl)) throw new Error('terminology_manifest_url_invalid');
    this.#manifestUrl = new URL(options.manifestUrl, baseUrl);
    if (!['https:', 'http:'].includes(this.#manifestUrl.protocol)) {
      throw new Error('terminology_manifest_url_invalid');
    }
    this.#store = options.store;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  public async synchronize(snapshotId: string): Promise<TerminologySynchronizationStatus> {
    const response = await this.#fetch(this.#manifestUrl, {
      credentials: 'same-origin',
      headers: { accept: 'application/vnd.api+json' },
    });
    if (!response.ok) throw new Error(`terminology_manifest_http_${response.status}`);
    const manifest = parseTerminologyManifest(await response.json());
    const entry = manifest.snapshots.find((candidate) => candidate.id === snapshotId);
    if (!entry) throw new Error('terminology_snapshot_not_listed');
    const existing = await this.#store.get(snapshotId);
    if (existing?.sha256 === entry.sha256) {
      this.#activate(entry, existing.bytes);
      return 'current';
    }
    const downloadUrl = new URL(entry.downloadUrl);
    if (!['https:', 'http:'].includes(downloadUrl.protocol)) {
      throw new Error('terminology_snapshot_download_url_invalid');
    }
    const snapshotResponse = await this.#fetch(downloadUrl, {
      credentials: downloadUrl.origin === this.#manifestUrl.origin ? 'same-origin' : 'omit',
      headers: { accept: 'application/vnd.api+json' },
    });
    if (!snapshotResponse.ok) throw new Error(`terminology_snapshot_http_${snapshotResponse.status}`);
    const bytes = new Uint8Array(await snapshotResponse.arrayBuffer());
    const snapshot = await this.#verify(entry, bytes);
    await this.#store.put({ snapshotId, sha256: entry.sha256, bytes });
    this.#registry.activate(snapshot);
    return 'updated';
  }

  public async load(snapshotId: string): Promise<void> {
    const record = await this.#store.get(snapshotId);
    if (!record) throw new Error('terminology_snapshot_not_cached');
    if (await sha256(record.bytes) !== record.sha256) throw new Error('terminology_snapshot_sha256_mismatch');
    const snapshot = parseSnapshotBytes(record.bytes);
    if (snapshot.id !== snapshotId) throw new Error('terminology_snapshot_id_mismatch');
    this.#registry.activate(snapshot);
  }

  public entries(snapshotId: string, input: TerminologyEntrySelection) {
    return this.#registry.entries(snapshotId, input);
  }

  public search(snapshotId: string, input: TerminologySearchInput) {
    return this.#registry.search(snapshotId, input);
  }

  async #verify(entry: TerminologyManifestEntry, bytes: Uint8Array): Promise<TerminologySnapshot> {
    if (bytes.byteLength !== entry.byteLength) throw new Error('terminology_snapshot_byte_length_mismatch');
    if (await sha256(bytes) !== entry.sha256) throw new Error('terminology_snapshot_sha256_mismatch');
    const snapshot = parseSnapshotBytes(bytes);
    if (snapshot.id !== entry.id) throw new Error('terminology_snapshot_id_mismatch');
    return snapshot;
  }

  #activate(entry: TerminologyManifestEntry, bytes: Uint8Array): void {
    const snapshot = parseSnapshotBytes(bytes);
    if (snapshot.id !== entry.id) throw new Error('terminology_snapshot_id_mismatch');
    this.#registry.activate(snapshot);
  }
}

function parseSnapshotBytes(bytes: Uint8Array): TerminologySnapshot {
  try {
    return parseTerminologySnapshot(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('terminology_snapshot_json_invalid');
    throw error;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
