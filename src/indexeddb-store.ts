import type { TerminologySnapshotRecord, TerminologySnapshotStore } from './browser-client.js';

const STORE_NAME = 'snapshots';

/** Atomic IndexedDB adapter; applications may inject a different store for Expo or tests. */
export class TerminologySnapshotStoreIndexedDb implements TerminologySnapshotStore {
  readonly #databaseName: string;
  readonly #indexedDb: IDBFactory;

  public constructor(options: Readonly<{
    databaseName?: string;
    indexedDb?: IDBFactory;
  }> = {}) {
    this.#databaseName = options.databaseName?.trim() || 'connecthealth-terminology';
    const factory = options.indexedDb ?? globalThis.indexedDB;
    if (!factory) throw new Error('terminology_indexeddb_unavailable');
    this.#indexedDb = factory;
  }

  public async get(snapshotId: string): Promise<TerminologySnapshotRecord | undefined> {
    const database = await this.#open();
    try {
      const value = await requestResult<StoredRecord | undefined>(
        database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(snapshotId),
      );
      return value ? Object.freeze({
        snapshotId: value.snapshotId,
        sha256: value.sha256,
        bytes: new Uint8Array(value.bytes),
      }) : undefined;
    } finally {
      database.close();
    }
  }

  public async put(record: TerminologySnapshotRecord): Promise<void> {
    const database = await this.#open();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        snapshotId: record.snapshotId,
        sha256: record.sha256,
        bytes: new Uint8Array(record.bytes).slice().buffer,
      } satisfies StoredRecord);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  #open(): Promise<IDBDatabase> {
    const request = this.#indexedDb.open(this.#databaseName, 1);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'snapshotId' });
      }
    });
    return requestResult(request);
  }
}

type StoredRecord = Readonly<{ snapshotId: string; sha256: string; bytes: ArrayBuffer }>;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('terminology_indexeddb_request_failed')));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('terminology_indexeddb_transaction_aborted')));
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('terminology_indexeddb_transaction_failed')));
  });
}
