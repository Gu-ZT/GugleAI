import type {StoredResultImage} from "../../domain/models";

const DB_NAME = "gugle-ai-history";
const STORE_NAME = "images";
const DB_VERSION = 1;

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
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("无法打开预览历史数据库"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("预览历史数据库被其他窗口占用"));
    };
  });
  return databasePromise;
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("预览历史事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("预览历史事务已取消"));
  });
}

export async function loadStoredResultImages(): Promise<StoredResultImage[]> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const completed = waitForTransaction(transaction);
  const request = transaction.objectStore(STORE_NAME).getAll();
  await completed;
  return (request.result as StoredResultImage[])
      .filter((item) => item && typeof item.id === "string" && item.blob instanceof Blob)
      .sort((a, b) =>
        (Number.isFinite(a.createdAt) ? a.createdAt : 0) -
        (Number.isFinite(b.createdAt) ? b.createdAt : 0)
      );
}

export async function putStoredResultImage(image: StoredResultImage): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(STORE_NAME).put(image);
  await completed;
}

export async function deleteStoredResultImage(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(STORE_NAME).delete(id);
  await completed;
}

export async function clearStoredResultImages(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(STORE_NAME).clear();
  await completed;
}
