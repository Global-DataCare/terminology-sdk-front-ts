# terminology-sdk-front-ts

Framework-neutral browser SDK for verified offline terminology catalogs.

Copyright 2026 Connecting Solution & Applications Ltd. (ConnectHealth.info).

The client downloads the manifest and snapshot once, verifies SHA-256 and byte
length, stores the exact bytes atomically, and then filters locally. It never
sends an upstream service token from the browser and never performs one request
per keystroke.

```ts
import {
  TerminologyBrowserClient,
  TerminologySnapshotStoreIndexedDb,
} from 'terminology-sdk-front-ts';

const terminology = new TerminologyBrowserClient({
  manifestUrl: '/api/terminology/manifest',
  store: new TerminologySnapshotStoreIndexedDb(),
});

await terminology.synchronize(snapshotId);

const matches = terminology.search(snapshotId, {
  claim: 'Condition.code',
  language: 'es',
  text: 'gripe',
});
```

Each cached `data[]` entry remains one CodeSystem or ValueSet in one language.
Components select entries by `meta.flatClaims`; `attributes` remains a plain
`code -> value` map.

The grouped catalog design follows an earlier portal-neutral terminology model
and consumes snapshots produced by
[`terminology-api-node-ts`](https://github.com/Global-DataCare/terminology-api-node-ts).
