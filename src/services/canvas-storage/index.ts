import type {CanvasSnapshot, CanvasViewport} from "../../canvas";

const DB_NAME = "gugle-ai-canvases";
const STORE_NAME = "documents";
const DB_VERSION = 1;

export interface CanvasDocumentMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

export interface StoredCanvasDocument {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewportVersion?: number;
  snapshot: CanvasSnapshot;
  viewport: CanvasViewport;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, {keyPath: "id"});
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("无法打开画布数据库"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("画布数据库被其他窗口占用"));
    };
  });
  return databasePromise;
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("画布数据库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("画布数据库事务已取消"));
  });
}

export async function listCanvasDocuments(): Promise<CanvasDocumentMeta[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const completed = waitForTransaction(transaction);
  const request = transaction.objectStore(STORE_NAME).getAll();
  await completed;
  return (request.result as StoredCanvasDocument[])
      .filter(isStoredCanvasDocument)
      .map(({id, name, createdAt, updatedAt, snapshot}) => ({
        id,
        name,
        createdAt,
        updatedAt,
        nodeCount: snapshot.nodes.length,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getCanvasDocument(id: string): Promise<StoredCanvasDocument | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const completed = waitForTransaction(transaction);
  const request = transaction.objectStore(STORE_NAME).get(id);
  await completed;
  return isStoredCanvasDocument(request.result) ? request.result : null;
}

export async function loadAllCanvasDocuments(): Promise<StoredCanvasDocument[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const completed = waitForTransaction(transaction);
  const request = transaction.objectStore(STORE_NAME).getAll();
  await completed;
  return (request.result as StoredCanvasDocument[]).filter(isStoredCanvasDocument);
}

export async function putCanvasDocument(document: StoredCanvasDocument): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(STORE_NAME).put(document);
  await completed;
}

export async function deleteCanvasDocument(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(STORE_NAME).delete(id);
  await completed;
}

export async function replaceAllCanvasDocuments(documents: StoredCanvasDocument[]): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  const store = transaction.objectStore(STORE_NAME);
  store.clear();
  for (const document of documents) store.put(document);
  await completed;
}

function isStoredCanvasDocument(value: unknown): value is StoredCanvasDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<StoredCanvasDocument>;
  return typeof document.id === "string"
      && typeof document.name === "string"
      && Number.isFinite(document.createdAt)
      && Number.isFinite(document.updatedAt)
      && Boolean(document.snapshot)
      && Array.isArray(document.snapshot?.nodes)
      && Array.isArray(document.snapshot?.edges)
      && Boolean(document.viewport)
      && Number.isFinite(document.viewport?.x)
      && Number.isFinite(document.viewport?.y)
      && Number.isFinite(document.viewport?.zoom);
}
