export interface OfflineMutation {
  id?: number;
  path: string;
  method: string;
  body: unknown;
  queuedAt: string;
  lastError?: string;
  httpStatus?: number;
}

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
  authExpired: boolean;
}

const DB_NAME = 'logisticmaster-offline';
const DB_VERSION = 3;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível neste navegador.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('mutations')) db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('failed_mutations')) db.createObjectStore('failed_mutations', { keyPath: 'id', autoIncrement: true });
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

export async function listFailedMutations(): Promise<OfflineMutation[]> {
  const db = await openDb();
  const result = await new Promise<OfflineMutation[]>((resolve, reject) => {
    const request = db.transaction('failed_mutations', 'readonly').objectStore('failed_mutations').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function discardFailedMutation(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('failed_mutations', 'readwrite');
    tx.objectStore('failed_mutations').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function moveMutationToFailed(mutation: OfflineMutation, httpStatus: number, lastError: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['mutations', 'failed_mutations'], 'readwrite');
    if (mutation.id != null) tx.objectStore('mutations').delete(mutation.id);
    const { id: _ignored, ...rest } = mutation;
    tx.objectStore('failed_mutations').add({ ...rest, httpStatus, lastError });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deleteMutation(id: number) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function queuedMutationCount(): Promise<number> {
  return (await listMutations()).length;
}

export async function flushMutations(
  sender?: (path: string, method: string, body: unknown) => Promise<{ ok: boolean; status: number; error?: string }>
): Promise<FlushResult> {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0, remaining: await queuedMutationCount(), authExpired: false };
  }
  const mutations = await listMutations();
  let synced = 0;
  let failed = 0;
  let authExpired = false;

  for (const mutation of mutations) {
    try {
      let ok = false;
      let status = 500;
      let errorMsg = '';

      if (sender) {
        const res = await sender(mutation.path, mutation.method, mutation.body);
        ok = res.ok;
        status = res.status;
        errorMsg = res.error || '';
      } else {
        const response = await fetch(mutation.path.startsWith('/api') ? mutation.path : `/api${mutation.path}`, {
          method: mutation.method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mutation.body)
        });
        ok = response.ok;
        status = response.status;
        if (!ok) {
          try {
            const data = await response.json();
            errorMsg = data?.error || `Erro HTTP ${status}`;
          } catch {
            errorMsg = `Erro HTTP ${status}`;
          }
        }
      }

      if (ok) {
        if (mutation.id != null) await deleteMutation(mutation.id);
        synced++;
        continue;
      }

      // 401: pausa sincronização para reautenticação sem perder os itens.
      if (status === 401) {
        authExpired = true;
        break;
      }

      // Erros definitivos 4xx (ex.: 422 geofence, 409 status incompatível): isola o item e segue a fila.
      if (status >= 400 && status < 500) {
        await moveMutationToFailed(mutation, status, errorMsg || `Rejeitado pelo servidor (${status}).`);
        failed++;
        continue;
      }

      // Erros transitórios 5xx: interrompe para tentar novamente depois.
      break;
    } catch {
      break;
    }
  }

  return { synced, failed, remaining: await queuedMutationCount(), authExpired };
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

export async function saveOfflineDocument(key: string, blob: Blob, filename: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put({
      key,
      blob,
      filename,
      contentType: blob.type || 'application/pdf',
      cachedAt: new Date().toISOString()
    } satisfies OfflineDocument);
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
