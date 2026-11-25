export interface OfflineMutation {
  id?: number;
  path: string;
  method: string;
  body: unknown;
  queuedAt: string;
}

const DB_NAME = 'logisticmaster-offline';
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível neste navegador.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('mutations')) db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir armazenamento offline.'));
  });
}

export async function enqueueMutation(mutation: Omit<OfflineMutation, 'id' | 'queuedAt'>) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').add({ ...mutation, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listMutations(): Promise<OfflineMutation[]> {
  const db = await openDb();
  const result = await new Promise<OfflineMutation[]>((resolve, reject) => {
    const request = db.transaction('mutations', 'readonly').objectStore('mutations').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function queuedMutationCount(): Promise<number> {
  return (await listMutations()).length;
}

export async function flushMutations(): Promise<{ synced: number; remaining: number }> {
  if (!navigator.onLine) return { synced: 0, remaining: await queuedMutationCount() };
  const mutations = await listMutations();
  let synced = 0;
  for (const mutation of mutations) {
    try {
      const response = await fetch(mutation.path.startsWith('/api') ? mutation.path : `/api${mutation.path}`, {
        method: mutation.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mutation.body)
      });
      if (!response.ok) break;
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('mutations', 'readwrite');
        tx.objectStore('mutations').delete(mutation.id!);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      synced++;
    } catch {
      break;
    }
  }
  return { synced, remaining: await queuedMutationCount() };
}

export async function saveOfflineSnapshot(snapshot: unknown) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put({ key: 'bootstrap', value: snapshot, updatedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readOfflineSnapshot<T>(): Promise<T | null> {
  const db = await openDb();
  const value = await new Promise<any>((resolve, reject) => {
    const request = db.transaction('cache', 'readonly').objectStore('cache').get('bootstrap');
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value as T | null;
}


export interface OfflineDocument {
  key: string;
  blob: Blob;
  filename: string;
  contentType: string;
  cachedAt: string;
}

/** Guarda a NF-e oficial em IndexedDB para consulta mesmo sem conexão. */
export async function saveOfflineDocument(key: string, blob: Blob, filename: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put({ key, blob, filename, contentType: blob.type || 'application/pdf', cachedAt: new Date().toISOString() } satisfies OfflineDocument);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readOfflineDocument(key: string): Promise<OfflineDocument | null> {
  const db = await openDb();
  const value = await new Promise<OfflineDocument | null>((resolve, reject) => {
    const request = db.transaction('documents', 'readonly').objectStore('documents').get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export async function listOfflineDocumentKeys(): Promise<string[]> {
  const db = await openDb();
  const keys = await new Promise<string[]>((resolve, reject) => {
    const request = db.transaction('documents', 'readonly').objectStore('documents').getAllKeys();
    request.onsuccess = () => resolve((request.result || []).map(String));
    request.onerror = () => reject(request.error);
  });
  db.close();
  return keys;
}
