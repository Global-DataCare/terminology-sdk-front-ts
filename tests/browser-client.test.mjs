// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildTerminologySnapshotKey } from 'terminology-data-utils-ts';
import { TerminologyBrowserClient, TerminologySnapshotStoreMemory } from '../dist/index.js';

const identity = { sector: 'health-care', jurisdiction: 'ES', fhirVersion: 'R4', release: '2026-09' };
const snapshotId = buildTerminologySnapshotKey(identity);
const snapshot = {
  jsonapi: { version: '1.1' }, schemaVersion: '2', id: snapshotId,
  generatedAt: '2026-09-28T12:00:00.000Z', identity,
  terminologyVersions: { 'http://loinc.org': '2.78' },
  sources: [{ id: 'LNC', system: 'http://loinc.org', version: '2.78', license: 'test', provenance: 'synthetic' }],
  data: [{
    type: 'terminology-system', id: 'http://loinc.org', language: 'es',
    attributes: { '8310-5': 'Temperatura corporal' },
    meta: { versionId: '2.78', system: 'http://loinc.org', sources: ['LNC'], flatClaims: ['Observation.code'] },
  }],
};
const bytes = Buffer.from(JSON.stringify(snapshot));
const manifest = {
  schemaVersion: '2', generatedAt: '2026-09-28T12:00:01.000Z',
  snapshots: [{
    id: snapshotId, identity,
    sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength,
    downloadUrl: 'https://portal.example/api/terminology/snapshot',
  }],
};

test('synchronizes once, verifies bytes and filters the cached grouped entry locally', async () => {
  const requests = [];
  const client = new TerminologyBrowserClient({
    manifestUrl: 'https://portal.example/api/terminology/manifest',
    store: new TerminologySnapshotStoreMemory(),
    fetchImplementation: async (url, init) => {
      requests.push({ url: String(url), credentials: init?.credentials });
      return String(url).endsWith('manifest') ? Response.json(manifest) : new Response(bytes);
    },
  });

  assert.equal(await client.synchronize(snapshotId), 'updated');
  assert.deepEqual(client.entries(snapshotId, {
    claim: 'Observation.code', language: 'es',
  })[0].attributes, { '8310-5': 'Temperatura corporal' });
  assert.deepEqual(client.search(snapshotId, {
    claim: 'Observation.code', language: 'es', text: 'temperatura',
  }).map(item => item.code), ['8310-5']);
  assert.deepEqual(requests.map(item => item.credentials), ['same-origin', 'same-origin']);
});

test('loads the cached snapshot without network and omits credentials for a foreign object origin', async () => {
  const store = new TerminologySnapshotStoreMemory();
  const foreignManifest = {
    ...manifest,
    snapshots: [{ ...manifest.snapshots[0], downloadUrl: 'https://objects.example/snapshot.json' }],
  };
  const credentials = [];
  const online = new TerminologyBrowserClient({
    manifestUrl: 'https://portal.example/api/terminology/manifest', store,
    fetchImplementation: async (url, init) => {
      credentials.push(init?.credentials);
      return String(url).endsWith('manifest') ? Response.json(foreignManifest) : new Response(bytes);
    },
  });
  await online.synchronize(snapshotId);
  assert.deepEqual(credentials, ['same-origin', 'omit']);

  const offline = new TerminologyBrowserClient({
    manifestUrl: 'https://portal.example/api/terminology/manifest', store,
    fetchImplementation: async () => { throw new Error('offline'); },
  });
  await offline.load(snapshotId);
  assert.equal(offline.search(snapshotId, {
    claim: 'Observation.code', language: 'es', text: '8310',
  })[0].value, 'Temperatura corporal');
});

test('rejects a corrupt download without replacing the active cache', async () => {
  const client = new TerminologyBrowserClient({
    manifestUrl: 'https://portal.example/api/terminology/manifest',
    store: new TerminologySnapshotStoreMemory(),
    fetchImplementation: async (url) => String(url).endsWith('manifest')
      ? Response.json(manifest)
      : new Response('{}'),
  });
  await assert.rejects(client.synchronize(snapshotId), /terminology_snapshot_(byte_length|sha256)_mismatch/);
  assert.throws(() => client.search(snapshotId, {
    claim: 'Observation.code', language: 'es', text: 'temperatura',
  }), /terminology_snapshot_not_active/);
});

test('accepts a same-origin BFF route without requiring the component to construct an absolute URL', () => {
  const client = new TerminologyBrowserClient({
    manifestUrl: '/api/terminology/manifest',
    baseUrl: 'https://portal.example/clinical',
    store: new TerminologySnapshotStoreMemory(),
  });
  assert(client);
});
