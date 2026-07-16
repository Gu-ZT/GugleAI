<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from "vue";
import {fetch as httpFetch, type ClientOptions} from "@tauri-apps/plugin-http";
import {save} from "@tauri-apps/plugin-dialog";
import {invoke} from "@tauri-apps/api/core";
import {openUrl} from "@tauri-apps/plugin-opener";
import {getVersion} from "@tauri-apps/api/app";

interface RefImage {
  file: File;
  previewUrl: string;
}

interface ResultImage {
  id: string;
  blob: Blob;
  mime: string;
  prompt: string;
  previewUrl: string;
  createdAt: number;
}

interface StoredResultImage {
  id: string;
  blob: Blob;
  mime: string;
  prompt?: string;
  createdAt: number;
}

interface ResultContextMenuState {
  image: ResultImage;
  x: number;
  y: number;
}

interface RetryConfig {
  statusCodes: Set<number>;
  maxRetries: number;
}

interface ConnectionProfile {
  id: string;
  endpoint: string;
  apiKey: string;
}

const SETTINGS_KEY = "gugle-ai-settings";
const RESULT_HISTORY_DB_NAME = "gugle-ai-history";
const RESULT_HISTORY_STORE_NAME = "images";
const RESULT_HISTORY_DB_VERSION = 1;
const DEFAULT_ENDPOINT = "https://api.openai.com/v1";
const DEFAULT_CONNECTION_ID = "default-openai";
const DEFAULT_MODEL_OPTIONS = [
  "gpt-image-2",
  "grok-imagine",
  "grok-imagine-edit",
  "grok-imagine-image",
  "grok-imagine-image-quality"
];
const DEFAULT_RETRY_STATUS_CODE_OPTIONS = [408, 409, 429, 500, 502, 503, 504, 524];

// 插件底层的 reqwest 不读 Windows 系统代理;每次请求前都取一次,
// 这样改系统代理后无需重启应用即可生效(注册表读取开销可忽略)
let lastLoggedProxy: string | null | undefined;

async function fetch(input: string, init?: RequestInit & ClientOptions): Promise<Response> {
  const opts = {...init};
  if (!opts.proxy) {
    let proxy: string | null = null;
    try {
      proxy = await invoke<string | null>("get_system_proxy");
    } catch {
    }
    if (proxy !== lastLoggedProxy) {
      lastLoggedProxy = proxy;
      log("INFO", proxy ? `使用系统代理: ${sanitizeUrlForLog(proxy)}` : "系统代理已关闭,直连");
    }
    if (proxy) opts.proxy = {all: proxy};
  }
  return httpFetch(input, opts);
}

const endpoint = ref(DEFAULT_ENDPOINT);
const apiKey = ref("");
const connectionProfiles = ref<ConnectionProfile[]>([
  {id: DEFAULT_CONNECTION_ID, endpoint: DEFAULT_ENDPOINT, apiKey: ""},
]);
const activeConnectionId = ref(DEFAULT_CONNECTION_ID);
const connectionMenuOpen = ref(false);
const connectionPicker = ref<HTMLElement>();
const connectionModalOpen = ref(false);
const connectionDraftEndpoint = ref("");
const connectionDraftApiKey = ref("");
const connectionDraftError = ref("");
const model = ref("gpt-image-2");
const modelOptions = ref([...DEFAULT_MODEL_OPTIONS]);
const modelMenuOpen = ref(false);
const modelShowAll = ref(true);
const modelPicker = ref<HTMLElement>();
// auto: 多参考图自动改走 chat 接口(部分中转的 edits 接口只支持单图)
const apiMode = ref<"auto" | "images" | "chat">("auto");
const retryEnabled = ref(false);
const retryStatusCodes = ref<number[]>([504]);
const retryStatusCodeOptions = ref([...DEFAULT_RETRY_STATUS_CODE_OPTIONS]);
const retryStatusCodeInput = ref("");
const retryStatusCodeMenuOpen = ref(false);
const retryStatusCodePicker = ref<HTMLElement>();
const retryCount = ref(5);
const autoCheckUpdate = ref(true);
const size = ref("auto");
const count = ref(1);

const prompt = ref("");
const refImages = ref<RefImage[]>([]);
const results = ref<ResultImage[]>([]);
const historyLoading = ref(true);
const loading = ref(false);
const stopping = ref(false);
const error = ref("");
const fileInput = ref<HTMLInputElement>();
const dragOver = ref(false);
const resultContextMenu = ref<ResultContextMenuState | null>(null);
const resultContextMenuElement = ref<HTMLElement>();
const enlargedResult = ref<ResultImage | null>(null);
const previewNotice = ref("");

const logs = ref<string[]>([]);
const showLogs = ref(false);
const logFilePath = ref("");
let generationSequence = 0;
let generationAbortController: AbortController | null = null;
let activeGenerationId: number | null = null;
let resultHistoryDbPromise: Promise<IDBDatabase> | null = null;
let previewNoticeTimer: number | null = null;

function redactSensitiveText(value: unknown): string {
  let text = String(value ?? "");
  const savedKeys = connectionProfiles.value.map((profile) => profile.apiKey);
  for (const savedKey of new Set([apiKey.value, ...savedKeys])) {
    if (!savedKey) continue;
    if (savedKey.length >= 8) {
      text = text.split(savedKey).join("[已隐藏 API Key]");
    } else {
      const escapedKey = savedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(
          new RegExp(`(^|[^A-Za-z0-9])${escapedKey}(?=$|[^A-Za-z0-9])`, "g"),
          "$1[已隐藏 API Key]"
      );
    }
  }
  return text
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [已隐藏]")
      .replace(
          /((?:["']?(?:api[_-]?key|authorization|password|passwd|secret|token|access[_-]?token)["']?)\s*[:=]\s*["']?)[^"',;\s}]+/gi,
          "$1[已隐藏]"
      )
      .replace(/([?&](?:api_?key|key|token|access_token|authorization)=)[^&#\s)]*/gi, "$1[已隐藏]")
      .replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/gi, "$1?[已隐藏查询参数]")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, "$1[已隐藏]@")
      .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, "[已隐藏长数据]");
}

function sanitizeUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactSensitiveText(value).replace(/([?#]).*$/, "$1[已隐藏]");
  }
}

function errorMessage(errorValue: unknown): string {
  if (errorValue && typeof errorValue === "object") {
    const message = (errorValue as Record<string, unknown>).message;
    if (typeof message === "string") return redactSensitiveText(message);
  }
  return redactSensitiveText(errorValue);
}

function formatErrorDetails(errorValue: unknown, depth = 0): string {
  if (!errorValue || typeof errorValue !== "object") return errorMessage(errorValue);

  const record = errorValue as Record<string, unknown>;
  const details: string[] = [];
  for (const field of [
    "name",
    "message",
    "code",
    "kind",
    "errno",
    "status",
    "type",
    "reason",
    "error",
    "details",
  ] as const) {
    const value = record[field];
    if (typeof value === "string" || typeof value === "number") {
      details.push(`${field}=${redactSensitiveText(value)}`);
    }
  }
  if (depth < 2 && record.cause !== undefined) {
    details.push(`cause=(${formatErrorDetails(record.cause, depth + 1)})`);
  }
  if (typeof record.url === "string") details.push(`url=${sanitizeUrlForLog(record.url)}`);
  if (depth === 0 && typeof record.stack === "string") {
    const stack = record.stack.split("\n").slice(1, 7).map((line) => line.trim()).join(" <- ");
    if (stack) details.push(`stack=${redactSensitiveText(stack)}`);
  }
  return details.length > 0 ? details.join(" | ") : errorMessage(errorValue);
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function describeRequestBody(body: BodyInit | null | undefined): string {
  if (!body) return "无";
  if (body instanceof FormData) {
    let fileCount = 0;
    let fileBytes = 0;
    for (const value of body.values()) {
      if (value instanceof Blob) {
        fileCount++;
        fileBytes += value.size;
      }
    }
    return `multipart,文件=${fileCount},文件总大小=${formatByteSize(fileBytes)}`;
  }
  if (typeof body === "string") {
    return `JSON/文本,大小=${formatByteSize(new TextEncoder().encode(body).byteLength)}`;
  }
  if (body instanceof Blob) return `Blob,大小=${formatByteSize(body.size)}`;
  return Object.prototype.toString.call(body).slice(8, -1);
}

function proxyForLog(): string {
  if (lastLoggedProxy === undefined) return "未知";
  return lastLoggedProxy ? sanitizeUrlForLog(lastLoggedProxy) : "直连";
}

function log(level: "INFO" | "ERROR", msg: string) {
  const line = `[${new Date().toLocaleString()}] [${level}] ${redactSensitiveText(msg)}`;
  logs.value.push(line);
  if (logs.value.length > 500) logs.value.splice(0, logs.value.length - 500);
  invoke("append_log", {line}).catch(() => {
  });
}

async function openLogFile() {
  try {
    logFilePath.value = await invoke<string>("show_log_file");
  } catch (e: any) {
    error.value = `打开日志失败: ${e?.message ?? e}`;
  }
}

// --- 检查更新 ---
const RELEASES_PAGE = "https://github.com/Gu-ZT/GugleAI/releases";
const UPDATE_API = "https://api.github.com/repos/Gu-ZT/GugleAI/releases?per_page=1";
// gh-proxy 不代理 api.github.com,回退用它拉 main 分支的 tauri.conf.json 读版本号
const UPDATE_FALLBACK =
    "https://gh-proxy.com/https://raw.githubusercontent.com/Gu-ZT/GugleAI/main/src-tauri/tauri.conf.json";

const updateStatus = ref("");
const updateUrl = ref("");
const checkingUpdate = ref(false);

function parseVer(v: string): number[] {
  return v.replace(/^v/, "").split("+")[0].split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote: string, current: string): boolean {
  const r = parseVer(remote);
  const c = parseVer(current);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) !== (c[i] ?? 0)) return (r[i] ?? 0) > (c[i] ?? 0);
  }
  return false;
}

async function fetchLatestVersion(): Promise<{ version: string; url: string }> {
  try {
    const resp = await fetch(UPDATE_API, {
      headers: {Accept: "application/vnd.github+json"},
    });
    if (resp.ok) {
      const releases = await resp.json();
      if (Array.isArray(releases) && releases[0]?.tag_name) {
        return {version: releases[0].tag_name, url: releases[0].html_url ?? RELEASES_PAGE};
      }
    }
    throw new Error(`GitHub API ${resp.status}`);
  } catch (e) {
    log("INFO", `GitHub API 不可达(${e}),改用 gh-proxy 回退`);
    const resp = await fetch(UPDATE_FALLBACK);
    if (!resp.ok) throw new Error(`代理请求失败 (${resp.status})`);
    const conf = await resp.json();
    if (!conf.version) throw new Error("代理响应中没有版本号");
    return {version: conf.version, url: RELEASES_PAGE};
  }
}

async function checkUpdate(manual: boolean) {
  if (checkingUpdate.value) return;
  checkingUpdate.value = true;
  updateUrl.value = "";
  if (manual) updateStatus.value = "检查中...";
  try {
    const current = await getVersion();
    const latest = await fetchLatestVersion();
    log("INFO", `检查更新: 当前=${current} 最新=${latest.version}`);
    if (isNewer(latest.version, current)) {
      updateStatus.value = `发现新版本 ${latest.version}（当前 ${current}）`;
      updateUrl.value = latest.url;
    } else {
      updateStatus.value = manual ? `已是最新版本（${current}）` : "";
    }
  } catch (e: any) {
    const msg = `检查更新失败: ${e?.message ?? e}`;
    log("ERROR", msg);
    if (manual) updateStatus.value = msg;
  } finally {
    checkingUpdate.value = false;
  }
}

async function openDownloadPage() {
  try {
    await openUrl(updateUrl.value || RELEASES_PAGE);
  } catch (e: any) {
    error.value = `打开浏览器失败: ${e?.message ?? e}`;
  }
}

const hintText = computed(() => {
  const n = refImages.value.length;
  const useChat = apiMode.value === "chat" || (apiMode.value === "auto" && n > 1);
  const api = useChat ? "Chat 接口" : n > 0 ? "图像编辑接口" : "文生图接口";
  return n > 0 ? `${n} 张参考图 · ${api}` : `无参考图 · ${api}`;
});

const filteredModelOptions = computed(() => {
  const query = model.value.trim().toLowerCase();
  if (modelShowAll.value || !query) return modelOptions.value;
  return modelOptions.value.filter((option) => option.toLowerCase().includes(query));
});

const canAddModelOption = computed(() => {
  const value = model.value.trim();
  return value.length > 0 && !modelOptions.value.includes(value);
});

const retryStatusCodeInputValue = computed(() => {
  const value = retryStatusCodeInput.value.trim();
  if (!/^\d{3}$/.test(value)) return null;
  const code = Number(value);
  return code >= 100 && code <= 599 ? code : null;
});

const filteredRetryStatusCodeOptions = computed(() => {
  const query = retryStatusCodeInput.value.trim();
  if (!query) return retryStatusCodeOptions.value;
  return retryStatusCodeOptions.value.filter((code) => String(code).includes(query));
});

const showRetryStatusCodeInputAction = computed(() => {
  const code = retryStatusCodeInputValue.value;
  return code !== null && !retryStatusCodes.value.includes(code);
});

function maskApiKey(value: string): string {
  const key = value.trim();
  if (!key) return "未设置";
  if (key.length <= 8) return "••••••••";
  const prefix = key.startsWith("sk-") ? "sk-" : "";
  return `${prefix}••••${key.slice(-4)}`;
}

function openResultHistoryDb(): Promise<IDBDatabase> {
  if (resultHistoryDbPromise) return resultHistoryDbPromise;
  resultHistoryDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(RESULT_HISTORY_DB_NAME, RESULT_HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESULT_HISTORY_STORE_NAME)) {
        db.createObjectStore(RESULT_HISTORY_STORE_NAME, {keyPath: "id"});
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        resultHistoryDbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      resultHistoryDbPromise = null;
      reject(request.error ?? new Error("无法打开预览历史数据库"));
    };
    request.onblocked = () => {
      resultHistoryDbPromise = null;
      reject(new Error("预览历史数据库被其他窗口占用"));
    };
  });
  return resultHistoryDbPromise;
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("预览历史事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("预览历史事务已取消"));
  });
}

async function loadStoredResultImages(): Promise<StoredResultImage[]> {
  const db = await openResultHistoryDb();
  const transaction = db.transaction(RESULT_HISTORY_STORE_NAME, "readonly");
  const completed = waitForTransaction(transaction);
  const request = transaction.objectStore(RESULT_HISTORY_STORE_NAME).getAll();
  await completed;
  const records = request.result as StoredResultImage[];
  return records
      .filter((item) => item && typeof item.id === "string" && item.blob instanceof Blob)
      .sort(
          (a, b) =>
              (Number.isFinite(a.createdAt) ? a.createdAt : 0) -
              (Number.isFinite(b.createdAt) ? b.createdAt : 0)
      );
}

async function putStoredResultImage(image: StoredResultImage): Promise<void> {
  const db = await openResultHistoryDb();
  const transaction = db.transaction(RESULT_HISTORY_STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(RESULT_HISTORY_STORE_NAME).put(image);
  await completed;
}

async function deleteStoredResultImage(id: string): Promise<void> {
  const db = await openResultHistoryDb();
  const transaction = db.transaction(RESULT_HISTORY_STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(RESULT_HISTORY_STORE_NAME).delete(id);
  await completed;
}

async function clearStoredResultImages(): Promise<void> {
  const db = await openResultHistoryDb();
  const transaction = db.transaction(RESULT_HISTORY_STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(RESULT_HISTORY_STORE_NAME).clear();
  await completed;
}

function reportHistoryError(action: string, errorValue: unknown) {
  const message = `预览历史${action}失败: ${errorMessage(errorValue)}`;
  log("ERROR", `${message}；当前会话中的图片不会被丢弃`);
  if (!error.value) error.value = message;
}

function normalizeImageMime(mime: string | null | undefined): string {
  const normalized = mime?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return normalized.startsWith("image/") ? normalized : "image/png";
}

function createResultId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `result-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type: normalizeImageMime(mime)});
}

async function addResultImage(
    blob: Blob,
    mime: string,
    promptText: string,
    generatedResultIds?: Set<string>
): Promise<ResultImage> {
  const normalizedMime = normalizeImageMime(mime || blob.type);
  const normalizedBlob = blob.type === normalizedMime ? blob : blob.slice(0, blob.size, normalizedMime);
  const image: ResultImage = {
    id: createResultId(),
    blob: normalizedBlob,
    mime: normalizedMime,
    prompt: promptText,
    previewUrl: URL.createObjectURL(normalizedBlob),
    createdAt: Date.now(),
  };
  results.value.push(image);
  generatedResultIds?.add(image.id);
  try {
    await putStoredResultImage({
      id: image.id,
      blob: image.blob,
      mime: image.mime,
      prompt: image.prompt,
      createdAt: image.createdAt,
    });
  } catch (e: unknown) {
    reportHistoryError("保存", e);
  }
  return image;
}

async function restoreResultHistory() {
  historyLoading.value = true;
  try {
    const records = await loadStoredResultImages();
    const currentIds = new Set(results.value.map((image) => image.id));
    const restored = records
        .filter((record) => !currentIds.has(record.id))
        .map((record): ResultImage => {
          const mime = normalizeImageMime(record.mime || record.blob.type);
          return {
            id: record.id,
            blob: record.blob,
            mime,
            prompt: typeof record.prompt === "string" ? record.prompt : "",
            previewUrl: URL.createObjectURL(record.blob),
            createdAt: Number.isFinite(record.createdAt) ? record.createdAt : 0,
          };
        });
    results.value = [...restored, ...results.value];
    if (restored.length > 0) log("INFO", `已恢复 ${restored.length} 张预览图片`);
  } catch (e: unknown) {
    reportHistoryError("加载", e);
  } finally {
    historyLoading.value = false;
  }
}

async function deleteResultImage(image: ResultImage) {
  if (resultContextMenu.value?.image.id === image.id) closeResultContextMenu();
  if (enlargedResult.value?.id === image.id) closeResultLightbox();
  try {
    await deleteStoredResultImage(image.id);
    const index = results.value.findIndex((item) => item.id === image.id);
    if (index >= 0) {
      URL.revokeObjectURL(results.value[index].previewUrl);
      results.value.splice(index, 1);
    }
  } catch (e: unknown) {
    reportHistoryError("删除", e);
  }
}

async function clearResultHistory() {
  if (historyLoading.value || results.value.length === 0) return;
  if (!window.confirm(`确定清空全部 ${results.value.length} 张预览图片吗？此操作无法撤销。`)) return;
  closeResultContextMenu();
  closeResultLightbox();
  try {
    await clearStoredResultImages();
    for (const image of results.value) URL.revokeObjectURL(image.previewUrl);
    results.value = [];
    log("INFO", "已清空预览历史");
  } catch (e: unknown) {
    reportHistoryError("清空", e);
  }
}

function openResultContextMenu(event: MouseEvent, image: ResultImage) {
  const menuWidth = 176;
  const menuHeight = 202;
  const viewportPadding = 8;
  resultContextMenu.value = {
    image,
    x: Math.max(viewportPadding, Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding)),
    y: Math.max(viewportPadding, Math.min(event.clientY, window.innerHeight - menuHeight - viewportPadding)),
  };
}

function closeResultContextMenu() {
  resultContextMenu.value = null;
}

function openResultLightbox(image: ResultImage) {
  closeResultContextMenu();
  enlargedResult.value = image;
}

function closeResultLightbox() {
  enlargedResult.value = null;
}

function showPreviewNotice(message: string) {
  previewNotice.value = message;
  if (previewNoticeTimer !== null) window.clearTimeout(previewNoticeTimer);
  previewNoticeTimer = window.setTimeout(() => {
    previewNotice.value = "";
    previewNoticeTimer = null;
  }, 2000);
}

function copyTextFallback(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

async function copyResultPrompt(image: ResultImage) {
  closeResultContextMenu();
  if (!image.prompt) {
    error.value = "这张图片由旧版本生成，没有保存可复制的提示词";
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(image.prompt);
    copied = true;
  } catch {
    try {
      copied = copyTextFallback(image.prompt);
    } catch {
    }
  }
  if (!copied) {
    error.value = "复制提示词失败，请检查系统剪贴板权限";
    return;
  }
  showPreviewNotice("提示词已复制");
  log("INFO", "已复制预览图片的提示词");
}

async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片转换画布");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
          (pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error("无法将图片转换为 PNG")),
          "image/png"
      );
    });
  } finally {
    bitmap.close();
  }
}

async function copyResultImage(image: ResultImage) {
  closeResultContextMenu();
  try {
    if (typeof ClipboardItem === "undefined" || typeof navigator.clipboard?.write !== "function") {
      throw new Error("当前系统 WebView 不支持复制图片");
    }
    const pngBlob = convertImageBlobToPng(image.blob);
    await navigator.clipboard.write([new ClipboardItem({"image/png": pngBlob})]);
    showPreviewNotice("图片已复制到剪贴板");
    log("INFO", "已复制预览图片到剪贴板");
  } catch (e: unknown) {
    error.value = `复制图片失败: ${errorMessage(e)}`;
    log("ERROR", `复制预览图片到剪贴板失败: ${formatErrorDetails(e)}`);
  }
}

function setResultAsReference(image: ResultImage) {
  closeResultContextMenu();
  const extension = image.mime.includes("jpeg")
      ? "jpg"
      : image.mime.includes("webp")
          ? "webp"
          : "png";
  try {
    const file = new File([image.blob], `generated-${image.createdAt}.${extension}`, {
      type: image.mime,
      lastModified: image.createdAt,
    });
    addFile(file);
    showPreviewNotice("已添加为参考图");
    log("INFO", "已将预览图片添加为参考图");
  } catch (e: unknown) {
    error.value = `添加参考图失败: ${errorMessage(e)}`;
  }
}

async function saveResultFromContextMenu(image: ResultImage) {
  closeResultContextMenu();
  await saveImage(image);
}

async function deleteResultFromContextMenu(image: ResultImage) {
  closeResultContextMenu();
  await deleteResultImage(image);
}

function createConnectionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeConnectionProfiles(value: unknown): ConnectionProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: ConnectionProfile[] = [];
  const usedIds = new Set<string>();
  const usedPairs = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const profileEndpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
    const profileApiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
    if (!profileEndpoint) continue;
    const pair = `${profileEndpoint}\u0000${profileApiKey}`;
    if (usedPairs.has(pair)) continue;
    let id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : createConnectionId();
    if (usedIds.has(id)) id = createConnectionId();
    profiles.push({id, endpoint: profileEndpoint, apiKey: profileApiKey});
    usedIds.add(id);
    usedPairs.add(pair);
  }
  return profiles;
}

function connectionOptionNumber(profile: ConnectionProfile): number {
  return connectionProfiles.value.findIndex((item) => item.id === profile.id) + 1;
}

function selectConnection(profile: ConnectionProfile) {
  activeConnectionId.value = profile.id;
  endpoint.value = profile.endpoint;
  apiKey.value = profile.apiKey;
  connectionMenuOpen.value = false;
}

function addAndSelectConnection(endpointValue: string, apiKeyValue: string) {
  const profileEndpoint = endpointValue.trim();
  const profileApiKey = apiKeyValue.trim();
  if (!profileEndpoint) return false;
  const existing = connectionProfiles.value.find(
      (profile) => profile.endpoint === profileEndpoint && profile.apiKey === profileApiKey
  );
  if (existing) {
    selectConnection(existing);
    return true;
  }
  const profile: ConnectionProfile = {
    id: createConnectionId(),
    endpoint: profileEndpoint,
    apiKey: profileApiKey,
  };
  connectionProfiles.value = [...connectionProfiles.value, profile];
  selectConnection(profile);
  return true;
}

function openConnectionModal() {
  connectionDraftEndpoint.value = "";
  connectionDraftApiKey.value = "";
  connectionDraftError.value = "";
  connectionMenuOpen.value = false;
  connectionModalOpen.value = true;
}

function closeConnectionModal() {
  connectionModalOpen.value = false;
  connectionDraftEndpoint.value = "";
  connectionDraftApiKey.value = "";
  connectionDraftError.value = "";
}

function saveConnectionDraft() {
  if (!connectionDraftEndpoint.value.trim()) {
    connectionDraftError.value = "请输入 API 端点";
    return;
  }
  addAndSelectConnection(connectionDraftEndpoint.value, connectionDraftApiKey.value);
  closeConnectionModal();
}

function removeConnection(profile: ConnectionProfile) {
  if (connectionProfiles.value.length <= 1) return;
  const remaining = connectionProfiles.value.filter((item) => item.id !== profile.id);
  connectionProfiles.value = remaining;
  if (activeConnectionId.value === profile.id) selectConnection(remaining[0]);
}

function normalizeModelOptions(value: unknown): string[] {
  const saved = Array.isArray(value)
      ? value.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      : [];
  return [...new Set([...DEFAULT_MODEL_OPTIONS, ...saved.map((option) => option.trim())])];
}

function normalizeStatusCodes(value: unknown): number[] | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const codes = parsed.filter(
      (code): code is number => Number.isInteger(code) && code >= 100 && code <= 599
  );
  if (codes.length !== parsed.length) return null;
  return [...new Set(codes)].sort((a, b) => a - b);
}

function selectModelOption(option: string) {
  model.value = option;
  modelMenuOpen.value = false;
  modelShowAll.value = true;
}

function addModelOption() {
  const value = model.value.trim();
  if (!value) return;
  model.value = value;
  if (!modelOptions.value.includes(value)) {
    modelOptions.value = [...modelOptions.value, value];
  }
  modelMenuOpen.value = false;
  modelShowAll.value = true;
}

function removeModelOption(option: string) {
  if (DEFAULT_MODEL_OPTIONS.includes(option)) return;
  modelOptions.value = modelOptions.value.filter((item) => item !== option);
}

function toggleRetryStatusCode(code: number) {
  retryStatusCodes.value = retryStatusCodes.value.includes(code)
      ? retryStatusCodes.value.filter((item) => item !== code)
      : [...retryStatusCodes.value, code].sort((a, b) => a - b);
}

function addRetryStatusCode() {
  const code = retryStatusCodeInputValue.value;
  if (code === null) return;
  if (!retryStatusCodeOptions.value.includes(code)) {
    retryStatusCodeOptions.value = [...retryStatusCodeOptions.value, code].sort((a, b) => a - b);
  }
  if (!retryStatusCodes.value.includes(code)) {
    retryStatusCodes.value = [...retryStatusCodes.value, code].sort((a, b) => a - b);
  }
  retryStatusCodeInput.value = "";
}

function removeRetryStatusCodeOption(code: number) {
  if (DEFAULT_RETRY_STATUS_CODE_OPTIONS.includes(code)) return;
  retryStatusCodeOptions.value = retryStatusCodeOptions.value.filter((item) => item !== code);
  retryStatusCodes.value = retryStatusCodes.value.filter((item) => item !== code);
}

function closePickerMenus(e: PointerEvent) {
  const target = e.target as Node;
  if (!connectionPicker.value?.contains(target)) connectionMenuOpen.value = false;
  if (!modelPicker.value?.contains(target)) {
    modelMenuOpen.value = false;
    modelShowAll.value = true;
  }
  if (!retryStatusCodePicker.value?.contains(target)) {
    retryStatusCodeMenuOpen.value = false;
  }
  if (!resultContextMenuElement.value?.contains(target)) closeResultContextMenu();
}

function closeResultOverlaysOnEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  closeResultContextMenu();
  closeResultLightbox();
}

onMounted(async () => {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    try {
      const s = JSON.parse(saved);
      const savedEndpoint = typeof s.endpoint === "string" && s.endpoint.trim()
          ? s.endpoint.trim()
          : DEFAULT_ENDPOINT;
      const savedApiKey = typeof s.apiKey === "string" ? s.apiKey.trim() : "";
      const restoredProfiles = normalizeConnectionProfiles(s.connectionProfiles);
      if (restoredProfiles.length === 0) {
        restoredProfiles.push({
          id: savedEndpoint === DEFAULT_ENDPOINT && !savedApiKey ? DEFAULT_CONNECTION_ID : createConnectionId(),
          endpoint: savedEndpoint,
          apiKey: savedApiKey,
        });
      }
      connectionProfiles.value = restoredProfiles;
      const savedActiveId = typeof s.activeConnectionId === "string" ? s.activeConnectionId : "";
      const activeProfile = restoredProfiles.find((profile) => profile.id === savedActiveId)
          ?? restoredProfiles.find(
              (profile) => profile.endpoint === savedEndpoint && profile.apiKey === savedApiKey
          )
          ?? restoredProfiles[0];
      selectConnection(activeProfile);
      model.value = s.model ?? model.value;
      modelOptions.value = normalizeModelOptions(s.modelOptions);
      const savedModel = model.value.trim();
      if (savedModel && !modelOptions.value.includes(savedModel)) {
        modelOptions.value = [...modelOptions.value, savedModel];
      }
      apiMode.value = s.apiMode ?? "auto";
      retryEnabled.value = s.retryEnabled ?? false;
      retryStatusCodes.value = normalizeStatusCodes(s.retryStatusCodes) ?? [504];
      retryStatusCodeOptions.value = [
        ...new Set([
          ...DEFAULT_RETRY_STATUS_CODE_OPTIONS,
          ...(normalizeStatusCodes(s.retryStatusCodeOptions) ?? []),
          ...retryStatusCodes.value,
        ]),
      ].sort((a, b) => a - b);
      retryCount.value = s.retryCount ?? 5;
      autoCheckUpdate.value = s.autoCheckUpdate ?? true;
    } catch {
    }
  }
  window.addEventListener("paste", onPaste);
  window.addEventListener("blur", closeResultContextMenu);
  window.addEventListener("resize", closeResultContextMenu);
  window.addEventListener("scroll", closeResultContextMenu, true);
  document.addEventListener("pointerdown", closePickerMenus);
  document.addEventListener("keydown", closeResultOverlaysOnEscape);
  await restoreResultHistory();
  if (autoCheckUpdate.value) checkUpdate(false);
});

onUnmounted(() => {
  generationAbortController?.abort();
  for (const image of results.value) URL.revokeObjectURL(image.previewUrl);
  if (previewNoticeTimer !== null) window.clearTimeout(previewNoticeTimer);
  window.removeEventListener("paste", onPaste);
  window.removeEventListener("blur", closeResultContextMenu);
  window.removeEventListener("resize", closeResultContextMenu);
  window.removeEventListener("scroll", closeResultContextMenu, true);
  document.removeEventListener("pointerdown", closePickerMenus);
  document.removeEventListener("keydown", closeResultOverlaysOnEscape);
});

watch(
    [
      endpoint,
      apiKey,
      connectionProfiles,
      activeConnectionId,
      model,
      modelOptions,
      apiMode,
      retryEnabled,
      retryStatusCodes,
      retryStatusCodeOptions,
      retryCount,
      autoCheckUpdate,
    ],
    () => {
      localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({
            endpoint: endpoint.value,
            apiKey: apiKey.value,
            connectionProfiles: connectionProfiles.value,
            activeConnectionId: activeConnectionId.value,
            model: model.value,
            modelOptions: modelOptions.value,
            apiMode: apiMode.value,
            retryEnabled: retryEnabled.value,
            retryStatusCodes: retryStatusCodes.value,
            retryStatusCodeOptions: retryStatusCodeOptions.value,
            retryCount: retryCount.value,
            autoCheckUpdate: autoCheckUpdate.value,
          })
      );
    }
);

function addFile(file: File) {
  if (!file.type.startsWith("image/")) return;
  refImages.value.push({file, previewUrl: URL.createObjectURL(file)});
}

function addImages(e: Event) {
  const input = e.target as HTMLInputElement;
  for (const file of input.files ?? []) {
    addFile(file);
  }
  input.value = "";
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  for (const file of e.dataTransfer?.files ?? []) {
    addFile(file);
  }
}

// 识别粘贴的连接配置,支持:
// 1. {"_type":"newapi_channel_conn","key":"...","url":"..."}
// 2. Codex CLI config.toml(取 [model_providers.*] 里的 base_url,无 key)
function tryApplyConnConfig(text: string): boolean {
  if (text.startsWith("{") && text.includes("newapi_channel_conn")) {
    try {
      const conn = JSON.parse(text);
      if (typeof conn.url === "string" && conn.url && typeof conn.key === "string" && conn.key) {
        return addAndSelectConnection(conn.url, conn.key);
      }
    } catch {
    }
  }
  if (/^\[model_providers\.[^\]]+\]/m.test(text)) {
    const m = text.match(/^\[model_providers\.[^\]]+\][^[]*?^\s*base_url\s*=\s*"([^"]+)"/ms);
    if (m) {
      return addAndSelectConnection(m[1], "");
    }
  }
  return false;
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
  if (text && tryApplyConnConfig(text)) {
    error.value = "";
    e.preventDefault();
    return;
  }
  for (const item of e.clipboardData?.items ?? []) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) addFile(file);
    }
  }
}

function removeImage(index: number) {
  URL.revokeObjectURL(refImages.value[index].previewUrl);
  refImages.value.splice(index, 1);
}

function generationAbortError(): DOMException {
  return new DOMException("生成已停止", "AbortError");
}

function throwIfGenerationAborted(signal: AbortSignal) {
  if (signal.aborted) throw generationAbortError();
}

function waitForRetryDelay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfGenerationAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(generationAbortError());
    };
    signal.addEventListener("abort", onAbort, {once: true});
  });
}

function stopGeneration() {
  if (!loading.value || !generationAbortController || generationAbortController.signal.aborted) return;
  stopping.value = true;
  log("INFO", `任务=#${activeGenerationId ?? "?"} 用户请求停止生成`);
  generationAbortController.abort();
}

async function generate() {
  if (loading.value) return;
  const generationPrompt = prompt.value;
  if (!generationPrompt.trim()) {
    error.value = "请输入提示词";
    return;
  }
  const generationId = ++generationSequence;
  const abortController = new AbortController();
  const generatedResultIds = new Set<string>();
  generationAbortController = abortController;
  activeGenerationId = generationId;
  loading.value = true;
  stopping.value = false;
  error.value = "";

  // 允许填裸域名(如 https://ai.example.cn),没有版本路径时自动补 /v1
  let base = endpoint.value.trim().replace(/\/+$/, "");
  if (!/\/v\d+(\/|$)/.test(base)) base += "/v1";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey.value}`,
  };

  try {
    const retryConfig = getRetryConfig();
    const useChat =
        apiMode.value === "chat" || (apiMode.value === "auto" && refImages.value.length > 1);
    log(
        "INFO",
        `任务=#${generationId} 开始生成: 端点=${sanitizeUrlForLog(base)} 模型=${model.value} 模式=${useChat ? "chat" : "images"} 参考图=${refImages.value.length} 数量=${count.value} 尺寸=${size.value} 重试=${retryConfig ? `[${[...retryConfig.statusCodes].join(",")}],最多${retryConfig.maxRetries}次` : "关闭"}`
    );
    if (useChat) {
      await generateViaChat(
          base,
          headers,
          retryConfig,
          generationId,
          abortController.signal,
          generatedResultIds,
          generationPrompt
      );
    } else {
      await generateViaImages(
          base,
          headers,
          retryConfig,
          generationId,
          abortController.signal,
          generatedResultIds,
          generationPrompt
      );
    }
    throwIfGenerationAborted(abortController.signal);
    if (generatedResultIds.size === 0) {
      throw new Error("响应中没有图片数据");
    }
    log("INFO", `任务=#${generationId} 生成成功: ${generatedResultIds.size} 张图片`);
  } catch (e: unknown) {
    if (abortController.signal.aborted) {
      error.value = "";
      log("INFO", `任务=#${generationId} 生成已停止`);
    } else {
      error.value = errorMessage(e);
      log("ERROR", `任务=#${generationId} 生成失败: ${formatErrorDetails(e)}`);
    }
  } finally {
    if (generationAbortController === abortController) {
      generationAbortController = null;
      activeGenerationId = null;
    }
    stopping.value = false;
    loading.value = false;
  }
}

function getRetryConfig(): RetryConfig | null {
  if (!retryEnabled.value) return null;

  if (
      retryStatusCodes.value.length === 0 ||
      retryStatusCodes.value.some((code) => !Number.isInteger(code) || code < 100 || code > 599)
  ) {
    throw new Error("请至少选择一个 100 到 599 之间的重试错误码");
  }

  const maxRetries = Number(retryCount.value);
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 20) {
    throw new Error("重试次数必须是 1 到 20 之间的整数");
  }
  return {statusCodes: new Set(retryStatusCodes.value), maxRetries};
}

async function fetchGeneration(
    input: string,
    init: RequestInit & ClientOptions,
    retryConfig: RetryConfig | null,
    generationId: number,
    signal: AbortSignal
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const address = sanitizeUrlForLog(input);
  const bodyDescription = describeRequestBody(init.body);
  for (let retries = 0; ; retries++) {
    throwIfGenerationAborted(signal);
    const startedAt = Date.now();
    log(
        "INFO",
        `任务=#${generationId} 发送生成请求: 方法=${method} 地址=${address} 尝试=${retries + 1} HTTP状态重试=${retries}/${retryConfig?.maxRetries ?? 0} 请求体=${bodyDescription}`
    );
    let resp: Response;
    try {
      resp = await fetch(input, {...init, signal});
    } catch (requestError: unknown) {
      const elapsedMs = Date.now() - startedAt;
      if (signal.aborted) {
        log(
            "INFO",
            `任务=#${generationId} 生成请求已取消: 方法=${method} 地址=${address} 用时=${(elapsedMs / 1000).toFixed(1)}s`
        );
        throw requestError;
      }
      const timeoutHint = elapsedMs >= 55_000
          ? "；耗时接近或超过 60 秒,优先检查上游响应超时、代理连接和网络链路"
          : "";
      log(
          "ERROR",
          `任务=#${generationId} 生成请求传输失败: 方法=${method} 地址=${address} 尝试=${retries + 1} 用时=${(elapsedMs / 1000).toFixed(1)}s 请求体=${bodyDescription} 代理=${proxyForLog()} WebView网络状态=${navigator.onLine ? "在线" : "离线"} 错误=${formatErrorDetails(requestError)}${timeoutHint}`
      );
      throw requestError;
    }
    throwIfGenerationAborted(signal);
    const elapsedMs = Date.now() - startedAt;
    log(
        "INFO",
        `任务=#${generationId} 收到生成响应: 状态=${resp.status} 用时=${(elapsedMs / 1000).toFixed(1)}s 地址=${sanitizeUrlForLog(resp.url || input)}`
    );
    if (!retryConfig || !retryConfig.statusCodes.has(resp.status) || retries >= retryConfig.maxRetries) {
      return resp;
    }

    // 读取并丢弃本次响应，确保连接能在下一次请求前被释放。
    try {
      await resp.text();
    } catch (readError: unknown) {
      if (signal.aborted) throw readError;
      log("ERROR", `任务=#${generationId} 释放重试响应失败: ${formatErrorDetails(readError)}`);
    }
    log(
        "INFO",
        `任务=#${generationId} 生成请求返回 ${resp.status}，1 秒后进行第 ${retries + 1}/${retryConfig.maxRetries} 次重试`
    );
    await waitForRetryDelay(1000, signal);
  }
}

// 标准 OpenAI 图像接口: 无参考图走 generations,有参考图走 edits
async function generateViaImages(
    base: string,
    headers: Record<string, string>,
    retryConfig: RetryConfig | null,
    generationId: number,
    signal: AbortSignal,
    generatedResultIds: Set<string>,
    generationPrompt: string
) {
  throwIfGenerationAborted(signal);
  let resp: Response;
  if (refImages.value.length > 0) {
    const form = new FormData();
    form.append("model", model.value);
    form.append("prompt", generationPrompt);
    form.append("n", String(count.value));
    if (size.value !== "auto") form.append("size", size.value);
    for (const img of refImages.value) {
      form.append("image[]", img.file, img.file.name);
    }
    resp = await fetchGeneration(
        `${base}/images/edits`,
        {method: "POST", headers, body: form},
        retryConfig,
        generationId,
        signal
    );
  } else {
    resp = await fetchGeneration(
        `${base}/images/generations`,
        {
          method: "POST",
          headers: {...headers, "Content-Type": "application/json"},
          body: JSON.stringify({
            model: model.value,
            prompt: generationPrompt,
            n: count.value,
            ...(size.value !== "auto" ? {size: size.value} : {}),
          }),
        },
        retryConfig,
        generationId,
        signal
    );
  }

  const data = await parseResponse(resp);
  throwIfGenerationAborted(signal);
  for (const item of data.data ?? []) {
    throwIfGenerationAborted(signal);
    if (item.b64_json) {
      await addResultImage(
          base64ToBlob(item.b64_json, "image/png"),
          "image/png",
          generationPrompt,
          generatedResultIds
      );
    } else if (item.url) {
      await downloadResult(base, item.url, signal, generatedResultIds, generationPrompt);
    }
  }
}

// chat/completions 兼容链路: 参考图作为 image_url 放入消息,
// 生成的图从返回内容里的 data URL 或 http URL 中提取
async function generateViaChat(
    base: string,
    headers: Record<string, string>,
    retryConfig: RetryConfig | null,
    generationId: number,
    signal: AbortSignal,
    generatedResultIds: Set<string>,
    generationPrompt: string
) {
  const content: any[] = [{type: "text", text: generationPrompt}];
  for (const img of refImages.value) {
    throwIfGenerationAborted(signal);
    const buf = await img.file.arrayBuffer();
    throwIfGenerationAborted(signal);
    content.push({
      type: "image_url",
      image_url: {url: `data:${img.file.type || "image/png"};base64,${bufToBase64(buf)}`},
    });
  }

  const resp = await fetchGeneration(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: {...headers, "Content-Type": "application/json"},
        body: JSON.stringify({
          model: model.value,
          messages: [{role: "user", content}],
        }),
      },
      retryConfig,
      generationId,
      signal
  );

  const data = await parseResponse(resp);
  throwIfGenerationAborted(signal);
  for (const choice of data.choices ?? []) {
    throwIfGenerationAborted(signal);
    const choiceResultCount = generatedResultIds.size;
    const msg = choice.message ?? {};
    // 部分服务把图放在 message.images 数组里
    for (const img of msg.images ?? []) {
      const url = img?.image_url?.url ?? img?.url;
      if (url) await collectChatImage(base, url, signal, generatedResultIds, generationPrompt);
    }
    const text: string = typeof msg.content === "string" ? msg.content : "";
    for (const m of text.matchAll(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
      throwIfGenerationAborted(signal);
      await addResultImage(base64ToBlob(m[2], m[1]), m[1], generationPrompt, generatedResultIds);
    }
    // 内容里没有内嵌 base64 时,再找 markdown 图片链接
    if (generatedResultIds.size === choiceResultCount) {
      for (const m of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)) {
        await collectChatImage(base, m[1], signal, generatedResultIds, generationPrompt);
      }
    }
  }
}

async function collectChatImage(
    base: string,
    url: string,
    signal: AbortSignal,
    generatedResultIds: Set<string>,
    generationPrompt: string
) {
  throwIfGenerationAborted(signal);
  const dataUrl = url.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (dataUrl) {
    await addResultImage(
        base64ToBlob(dataUrl[2], dataUrl[1]),
        dataUrl[1],
        generationPrompt,
        generatedResultIds
    );
  } else {
    await downloadResult(base, url, signal, generatedResultIds, generationPrompt);
  }
}

async function downloadResult(
    base: string,
    url: string,
    signal: AbortSignal,
    generatedResultIds: Set<string>,
    generationPrompt: string
) {
  throwIfGenerationAborted(signal);
  // 相对路径先拼完整端点,404 再回退到域名根(不同中转的挂载位置不一样)
  const candidates: string[] = [];
  if (/^https?:\/\//i.test(url)) {
    candidates.push(url);
  } else {
    const path = url.startsWith("/") ? url : "/" + url;
    candidates.push(base + path);
    try {
      const origin = new URL(base).origin;
      if (origin + path !== base + path) candidates.push(origin + path);
    } catch {
    }
  }
  let lastStatus = 0;
  for (const imgUrl of candidates) {
    throwIfGenerationAborted(signal);
    log("INFO", `下载图片: ${sanitizeUrlForLog(imgUrl)}`);
    const imgResp = await fetch(imgUrl, {signal});
    if (imgResp.ok) {
      const buf = await imgResp.arrayBuffer();
      throwIfGenerationAborted(signal);
      const mime = normalizeImageMime(imgResp.headers.get("content-type"));
      await addResultImage(new Blob([buf], {type: mime}), mime, generationPrompt, generatedResultIds);
      return;
    }
    lastStatus = imgResp.status;
    log("ERROR", `下载失败 (${imgResp.status}): ${sanitizeUrlForLog(imgUrl)}`);
  }
  throw new Error(`下载图片失败 (${lastStatus}): ${candidates.map(sanitizeUrlForLog).join(" 或 ")}`);
}

async function parseResponse(resp: Response): Promise<any> {
  const text = await resp.text();
  log("INFO", `响应: ${resp.status} ${sanitizeUrlForLog(resp.url)} 长度=${text.length}`);
  if (!resp.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text)?.error?.message ?? text;
    } catch {
    }
    const safeBody = redactSensitiveText(text.slice(0, 500));
    const safeMessage = redactSensitiveText(msg);
    log("ERROR", `响应体: ${safeBody}`);
    throw new Error(`请求失败 (${resp.status}): ${safeMessage}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    // 返回了 HTML 等非 JSON 内容,通常是端点地址不对(如缺少 /v1 或路径错误)
    throw new Error(`响应不是 JSON(收到 ${text.slice(0, 50)}...),请检查 API 端点是否正确`);
  }
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function saveImage(img: ResultImage) {
  const ext = img.mime.includes("jpeg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
  const path = await save({
    defaultPath: `generated-${Date.now()}.${ext}`,
    filters: [{name: "图片", extensions: [ext]}],
  });
  if (!path) return;
  try {
    const buffer = await img.blob.arrayBuffer();
    await invoke("save_file", {path, base64Data: bufToBase64(buffer)});
  } catch (e: any) {
    error.value = `保存失败: ${e?.message ?? e}`;
  }
}
</script>

<template>
  <main class="app">
    <aside class="sidebar">
      <h2>连接设置</h2>
      <div class="field">
        <label id="connection-picker-label">API 连接</label>
        <div ref="connectionPicker" class="combo-picker">
          <button
              type="button"
              class="connection-control"
              :class="{ open: connectionMenuOpen }"
              aria-haspopup="listbox"
              aria-controls="connection-option-list"
              :aria-expanded="connectionMenuOpen"
              aria-labelledby="connection-picker-label"
              @click="connectionMenuOpen = !connectionMenuOpen"
          >
            <span class="connection-summary">
              <span class="connection-endpoint" :title="endpoint">{{ endpoint }}</span>
              <span class="connection-key">Key {{ maskApiKey(apiKey) }}</span>
            </span>
            <span class="connection-chevron" aria-hidden="true">
              <span class="chevron"></span>
            </span>
          </button>
          <div v-if="connectionMenuOpen" id="connection-option-list" class="combo-menu" role="listbox">
            <div
                v-for="profile in connectionProfiles"
                :key="profile.id"
                class="combo-option-row connection-option-row"
                :class="{ selected: activeConnectionId === profile.id }"
            >
              <button
                  type="button"
                  class="combo-option-main connection-option"
                  role="option"
                  :aria-selected="activeConnectionId === profile.id"
                  :aria-label="`选择连接 ${connectionOptionNumber(profile)}，${profile.endpoint}，Key ${maskApiKey(profile.apiKey)}`"
                  @click="selectConnection(profile)"
              >
                <span class="connection-option-content">
                  <span class="connection-endpoint" :title="profile.endpoint">{{ profile.endpoint }}</span>
                  <span class="connection-key">Key {{ maskApiKey(profile.apiKey) }}</span>
                </span>
                <span v-if="activeConnectionId === profile.id" class="combo-check" aria-hidden="true">✓</span>
              </button>
              <button
                  v-if="connectionProfiles.length > 1"
                  type="button"
                  class="combo-remove-option"
                  :aria-label="`删除连接 ${connectionOptionNumber(profile)}，${profile.endpoint}`"
                  title="删除连接"
                  @click="removeConnection(profile)"
              >
                ×
              </button>
            </div>
            <button type="button" class="combo-add" @click="openConnectionModal">
              <span aria-hidden="true">＋</span>
              <span>添加连接</span>
            </button>
          </div>
        </div>
      </div>
      <div class="field">
        <label for="model-input">模型 ID</label>
        <div ref="modelPicker" class="combo-picker">
          <div class="combo-control" :class="{ open: modelMenuOpen }">
            <input
                id="model-input"
                v-model="model"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="model-option-list"
                :aria-expanded="modelMenuOpen"
                autocomplete="off"
                placeholder="gpt-image-2"
                @focus="modelMenuOpen = true; modelShowAll = true"
                @input="modelMenuOpen = true; modelShowAll = false"
                @keydown.enter.prevent="addModelOption"
                @keydown.esc="modelMenuOpen = false"
            />
            <button
                type="button"
                class="combo-toggle"
                aria-label="展开模型选项"
                :aria-expanded="modelMenuOpen"
                @click="modelMenuOpen = !modelMenuOpen; modelShowAll = true"
            >
              <span class="chevron" aria-hidden="true"></span>
            </button>
          </div>
          <div v-if="modelMenuOpen" id="model-option-list" class="combo-menu" role="listbox">
            <div
                v-for="option in filteredModelOptions"
                :key="option"
                class="combo-option-row"
                :class="{ selected: model === option }"
            >
              <button
                  type="button"
                  class="combo-option-main"
                  role="option"
                  :aria-selected="model === option"
                  :title="option"
                  @click="selectModelOption(option)"
              >
                <span class="combo-option-text">{{ option }}</span>
                <span v-if="model === option" class="combo-check" aria-hidden="true">✓</span>
              </button>
              <button
                  v-if="!DEFAULT_MODEL_OPTIONS.includes(option)"
                  type="button"
                  class="combo-remove-option"
                  :aria-label="`删除模型选项 ${option}`"
                  title="删除自定义选项"
                  @click="removeModelOption(option)"
              >
                ×
              </button>
            </div>
            <button v-if="canAddModelOption" type="button" class="combo-add" @click="addModelOption">
              <span aria-hidden="true">＋</span>
              <span class="combo-option-text">添加“{{ model.trim() }}”</span>
            </button>
          </div>
        </div>
      </div>
      <label>
        接口模式
        <select v-model="apiMode">
          <option value="auto">自动（多参考图走 Chat）</option>
          <option value="images">Images 接口</option>
          <option value="chat">Chat 接口</option>
        </select>
      </label>

      <h2>请求重试</h2>
      <label class="checkbox-row">
        <input v-model="retryEnabled" type="checkbox"/>
        <span>自动重试</span>
      </label>
      <div class="field">
        <label for="retry-status-code-input">重试错误码</label>
        <div ref="retryStatusCodePicker" class="combo-picker">
          <div
              class="combo-control combo-control-multi"
              :class="{ open: retryStatusCodeMenuOpen, disabled: !retryEnabled }"
          >
            <div class="combo-values">
              <button
                  v-for="code in retryStatusCodes"
                  :key="code"
                  type="button"
                  class="status-code-chip"
                  :disabled="!retryEnabled"
                  :aria-label="`取消选择错误码 ${code}`"
                  :title="`取消选择 ${code}`"
                  @click="toggleRetryStatusCode(code)"
              >
                {{ code }}<span aria-hidden="true">×</span>
              </button>
              <input
                  id="retry-status-code-input"
                  v-model="retryStatusCodeInput"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="retry-status-code-option-list"
                  :aria-expanded="retryStatusCodeMenuOpen"
                  :disabled="!retryEnabled"
                  inputmode="numeric"
                  maxlength="3"
                  autocomplete="off"
                  placeholder="输入错误码"
                  @focus="retryStatusCodeMenuOpen = true"
                  @input="retryStatusCodeMenuOpen = true"
                  @keydown.enter.prevent="addRetryStatusCode"
                  @keydown.esc="retryStatusCodeMenuOpen = false"
              />
            </div>
            <button
                type="button"
                class="combo-toggle"
                aria-label="展开错误码选项"
                :aria-expanded="retryStatusCodeMenuOpen"
                :disabled="!retryEnabled"
                @click="retryStatusCodeMenuOpen = !retryStatusCodeMenuOpen"
            >
              <span class="chevron" aria-hidden="true"></span>
            </button>
          </div>
          <div
              v-if="retryStatusCodeMenuOpen && retryEnabled"
              id="retry-status-code-option-list"
              class="combo-menu"
          >
            <div
                v-for="code in filteredRetryStatusCodeOptions"
                :key="code"
                class="combo-option-row"
                :class="{ selected: retryStatusCodes.includes(code) }"
            >
              <label class="combo-checkbox-option">
                <input
                    type="checkbox"
                    :checked="retryStatusCodes.includes(code)"
                    @change="toggleRetryStatusCode(code)"
                />
                <span>{{ code }}</span>
              </label>
              <button
                  v-if="!DEFAULT_RETRY_STATUS_CODE_OPTIONS.includes(code)"
                  type="button"
                  class="combo-remove-option"
                  :aria-label="`删除错误码选项 ${code}`"
                  title="删除自定义选项"
                  @click="removeRetryStatusCodeOption(code)"
              >
                ×
              </button>
            </div>
            <button
                v-if="showRetryStatusCodeInputAction"
                type="button"
                class="combo-add"
                @click="addRetryStatusCode"
            >
              <span aria-hidden="true">＋</span>
              <span>添加并选择 {{ retryStatusCodeInputValue }}</span>
            </button>
            <p
                v-if="filteredRetryStatusCodeOptions.length === 0 && !showRetryStatusCodeInputAction"
                class="combo-empty"
            >
              无匹配项
            </p>
          </div>
        </div>
      </div>
      <label>
        重试次数
        <input v-model.number="retryCount" :disabled="!retryEnabled" type="number" min="1" max="20"/>
      </label>

      <h2>生成参数</h2>
      <label>
        尺寸
        <select v-model="size">
          <option value="auto">自动</option>
          <option value="1024x1024">1024×1024</option>
          <option value="1536x1024">1536×1024 (横)</option>
          <option value="1024x1536">1024×1536 (竖)</option>
        </select>
      </label>
      <label>
        数量
        <input v-model.number="count" type="number" min="1" max="10"/>
      </label>

      <h2>更新</h2>
      <label class="checkbox-row">
        <input v-model="autoCheckUpdate" type="checkbox"/>
        <span>启动时自动检查更新</span>
      </label>
      <button class="log-btn" :disabled="checkingUpdate" @click="checkUpdate(true)">
        {{ checkingUpdate ? "检查中..." : "检查更新" }}
      </button>
      <p v-if="updateStatus" class="update-status">
        {{ updateStatus }}
        <a v-if="updateUrl" href="#" @click.prevent="openDownloadPage">前往下载</a>
      </p>

      <button class="log-btn view-log" @click="showLogs = !showLogs">
        {{ showLogs ? "隐藏日志" : "查看日志" }}
      </button>
    </aside>

    <section class="content">
      <div class="prompt-area">
        <textarea
            v-model="prompt"
            rows="4"
            placeholder="描述你想生成的图片..."
            @keydown.ctrl.enter="generate"
        ></textarea>

        <div class="ref-images">
          <div v-for="(img, i) in refImages" :key="img.previewUrl" class="ref-thumb">
            <img :src="img.previewUrl" :alt="img.file.name" :title="img.file.name"/>
            <button class="remove" @click="removeImage(i)">×</button>
          </div>
          <button
              class="add-ref"
              :class="{ 'drag-over': dragOver }"
              title="添加参考图（可拖拽文件或 Ctrl+V 粘贴）"
              @click="fileInput?.click()"
              @dragover.prevent="dragOver = true"
              @dragleave="dragOver = false"
              @drop.prevent="onDrop"
          >＋
          </button>
          <input
              ref="fileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              @change="addImages"
          />
        </div>

        <div class="actions">
          <span class="hint">{{ hintText }}</span>
          <div class="action-buttons">
            <button
                v-if="loading"
                type="button"
                class="stop-generation"
                :disabled="stopping"
                @click="stopGeneration"
            >
              <span class="stop-icon" aria-hidden="true"></span>
              {{ stopping ? "停止中..." : "停止" }}
            </button>
            <button class="generate" :disabled="loading" @click="generate">
              {{ loading ? "生成中..." : "生成 (Ctrl+Enter)" }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="showLogs" class="log-panel">
        <div class="log-header">
          <span>运行日志（本次会话 {{ logs.length }} 条）</span>
          <button @click="openLogFile">打开日志文件</button>
        </div>
        <p v-if="logFilePath" class="log-path">{{ logFilePath }}</p>
        <pre class="log-body">{{ logs.length ? logs.join("\n") : "暂无日志" }}</pre>
      </div>

      <section class="preview-panel" aria-label="预览区域">
        <div class="preview-toolbar">
          <span>{{ historyLoading ? "正在加载预览..." : `预览图片 ${results.length} 张` }}</span>
          <span v-if="loading" class="preview-status">{{ stopping ? "正在停止..." : "正在生成..." }}</span>
          <span v-if="previewNotice" class="preview-notice" role="status">{{ previewNotice }}</span>
          <button
              type="button"
              class="clear-results"
              :disabled="historyLoading || results.length === 0"
              @click="clearResultHistory"
          >
            清空预览
          </button>
        </div>
        <div v-if="results.length" class="results">
          <div v-for="img in results" :key="img.id" class="result-card">
            <img
                :src="img.previewUrl"
                alt="生成结果"
                @dblclick.prevent="openResultLightbox(img)"
                @contextmenu.prevent="openResultContextMenu($event, img)"
            />
            <div class="result-actions">
              <button type="button" @click="saveImage(img)">保存</button>
              <button type="button" class="delete-result" @click="deleteResultImage(img)">删除</button>
            </div>
          </div>
        </div>
        <div v-else class="placeholder">
          {{ historyLoading ? "正在加载预览..." : loading ? "正在生成,请稍候..." : "生成的图片将显示在这里" }}
        </div>
      </section>

      <div
          v-if="resultContextMenu"
          ref="resultContextMenuElement"
          class="result-context-menu"
          role="menu"
          :style="{ left: `${resultContextMenu.x}px`, top: `${resultContextMenu.y}px` }"
          @pointerdown.stop
          @contextmenu.prevent
      >
        <button
            type="button"
            role="menuitem"
            :disabled="!resultContextMenu.image.prompt"
            :title="resultContextMenu.image.prompt ? '' : '旧版本预览未保存提示词'"
            @click="copyResultPrompt(resultContextMenu.image)"
        >
          复制提示词
        </button>
        <button
            type="button"
            role="menuitem"
            @click="copyResultImage(resultContextMenu.image)"
        >
          复制到剪贴板
        </button>
        <button
            type="button"
            role="menuitem"
            @click="setResultAsReference(resultContextMenu.image)"
        >
          设置为参考图
        </button>
        <button
            type="button"
            role="menuitem"
            @click="saveResultFromContextMenu(resultContextMenu.image)"
        >
          保存图片
        </button>
        <button
            type="button"
            class="context-delete"
            role="menuitem"
            @click="deleteResultFromContextMenu(resultContextMenu.image)"
        >
          删除图片
        </button>
      </div>

      <div
          v-if="enlargedResult"
          class="result-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="放大预览"
          @mousedown.self="closeResultLightbox"
          @wheel.stop
      >
        <button
            type="button"
            class="lightbox-close"
            aria-label="关闭放大预览"
            title="关闭"
            @click="closeResultLightbox"
        >
          ×
        </button>
        <img
            :src="enlargedResult.previewUrl"
            alt="放大的生成结果"
            @dblclick.prevent="closeResultLightbox"
        />
      </div>
    </section>

    <div v-if="connectionModalOpen" class="modal-backdrop" @mousedown.self="closeConnectionModal">
      <form
          class="connection-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="connection-modal-title"
          @submit.prevent="saveConnectionDraft"
          @keydown.esc.prevent="closeConnectionModal"
      >
        <div class="modal-header">
          <h2 id="connection-modal-title">添加 API 连接</h2>
          <button type="button" aria-label="关闭" title="关闭" @click="closeConnectionModal">×</button>
        </div>
        <label for="connection-endpoint-input">
          API 端点
          <input
              id="connection-endpoint-input"
              v-model="connectionDraftEndpoint"
              autofocus
              autocomplete="off"
              placeholder="https://api.openai.com/v1"
              @input="connectionDraftError = ''"
          />
        </label>
        <label for="connection-api-key-input">
          API Key（可选）
          <input
              id="connection-api-key-input"
              v-model="connectionDraftApiKey"
              type="password"
              autocomplete="new-password"
              placeholder="sk-..."
          />
        </label>
        <p v-if="connectionDraftError" class="modal-error">{{ connectionDraftError }}</p>
        <div class="modal-actions">
          <button type="button" class="modal-cancel" @click="closeConnectionModal">取消</button>
          <button type="submit" class="modal-save">保存连接</button>
        </div>
      </form>
    </div>
  </main>
</template>

<style>
:root {
  font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  color: #e4e4e7;
  background-color: #18181b;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 260px;
  flex-shrink: 0;
  padding: 16px;
  background: #1f1f23;
  border-right: 1px solid #2e2e33;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar h2 {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #a1a1aa;
  margin: 8px 0 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #a1a1aa;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field > label {
  font-size: 13px;
  color: #a1a1aa;
}

input,
select,
textarea {
  font: inherit;
  color: #e4e4e7;
  background: #27272a;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  padding: 8px 10px;
  outline: none;
}

input:focus,
select:focus,
textarea:focus {
  border-color: #6366f1;
}

.combo-picker {
  position: relative;
  min-width: 0;
}

.combo-control {
  display: flex;
  align-items: stretch;
  min-width: 0;
  min-height: 36px;
  color: #e4e4e7;
  background: #27272a;
  border: 1px solid #3f3f46;
  border-radius: 6px;
}

.combo-control:focus-within,
.combo-control.open {
  border-color: #6366f1;
}

.combo-control.disabled {
  opacity: 0.5;
}

.connection-control {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  min-height: 50px;
  padding: 0 0 0 10px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #e4e4e7;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.connection-control:hover,
.connection-control:focus-visible,
.connection-control.open {
  border-color: #6366f1;
  outline: none;
}

.connection-summary,
.connection-option-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  min-width: 0;
}

.connection-endpoint {
  min-width: 0;
  overflow: hidden;
  color: #e4e4e7;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-key {
  overflow: hidden;
  color: #71717a;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-chevron {
  display: flex;
  width: 32px;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  color: #a1a1aa;
}

.connection-control.open .chevron {
  transform: translateY(2px) rotate(225deg);
}

.connection-option-row {
  min-height: 48px;
}

.connection-option {
  align-self: stretch;
}

.combo-control > input {
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 6px 0 0 6px;
  background: transparent;
}

.combo-control > input:focus,
.combo-values > input:focus {
  border-color: transparent;
}

.combo-toggle {
  width: 32px;
  flex: 0 0 32px;
  padding: 0;
  border: 0;
  border-radius: 0 6px 6px 0;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}

.combo-toggle:hover:not(:disabled) {
  color: #e4e4e7;
  background: #323237;
}

.combo-toggle:disabled {
  cursor: default;
}

.chevron {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translateY(-2px) rotate(45deg);
}

.combo-control.open .chevron {
  transform: translateY(2px) rotate(225deg);
}

.combo-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  width: 100%;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  box-shadow: 0 8px 24px #0008;
}

.combo-option-row {
  display: flex;
  align-items: center;
  min-width: 0;
  border-radius: 4px;
}

.combo-option-row:hover,
.combo-option-row.selected {
  background: #37373d;
}

.combo-option-main,
.combo-add {
  min-width: 0;
  border: 0;
  background: transparent;
  color: #e4e4e7;
  font: inherit;
  cursor: pointer;
}

.combo-option-main {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  text-align: left;
}

.combo-option-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.combo-check {
  flex-shrink: 0;
  color: #818cf8;
}

.combo-remove-option {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  font: inherit;
  cursor: pointer;
}

.combo-remove-option:hover {
  background: #7f1d1d66;
  color: #fca5a5;
}

.combo-add {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  border-top: 1px solid #3f3f46;
  color: #a5b4fc;
  text-align: left;
}

.combo-add:hover {
  background: #37373d;
}

.combo-control-multi {
  align-items: stretch;
}

.combo-values {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 2px 4px 6px;
}

.combo-values > input {
  flex: 1 0 78px;
  width: 78px;
  min-width: 0;
  height: 26px;
  padding: 3px 4px;
  border: 0;
  background: transparent;
}

.status-code-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 5px 0 7px;
  border: 1px solid #52525b;
  border-radius: 4px;
  background: #3f3f46;
  color: #e4e4e7;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.status-code-chip:hover:not(:disabled) {
  border-color: #71717a;
  background: #52525b;
}

.status-code-chip:disabled {
  cursor: default;
}

.combo-checkbox-option {
  flex: 1;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 8px;
  color: #e4e4e7;
  cursor: pointer;
}

.combo-checkbox-option input {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  padding: 0;
  accent-color: #6366f1;
}

.combo-empty {
  margin: 0;
  padding: 7px 8px;
  color: #71717a;
  font-size: 12px;
}

.modal-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #09090bb8;
}

.connection-modal {
  display: flex;
  width: min(400px, 100%);
  max-height: calc(100vh - 32px);
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 16px;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  background: #1f1f23;
  box-shadow: 0 16px 48px #000a;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-header h2 {
  margin: 0;
  color: #e4e4e7;
  font-size: 15px;
  letter-spacing: 0;
}

.modal-header button {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #a1a1aa;
  font: inherit;
  font-size: 18px;
  cursor: pointer;
}

.modal-header button:hover {
  background: #323237;
  color: #e4e4e7;
}

.connection-modal input {
  width: 100%;
}

.modal-error {
  margin: -4px 0 0;
  color: #fca5a5;
  font-size: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-actions button {
  min-height: 34px;
  padding: 6px 14px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.modal-cancel {
  border: 1px solid #3f3f46;
  background: #27272a;
  color: #d4d4d8;
}

.modal-save {
  border: 1px solid #6366f1;
  background: #6366f1;
  color: #fff;
}

.modal-cancel:hover {
  border-color: #71717a;
}

.modal-save:hover {
  background: #818cf8;
}

.content {
  flex: 1;
  min-width: 0;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.prompt-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

textarea {
  resize: vertical;
  min-height: 80px;
}

.ref-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ref-thumb {
  position: relative;
  width: 72px;
  height: 72px;
}

.ref-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #3f3f46;
}

.ref-thumb .remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: #ef4444;
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.add-ref {
  width: 72px;
  height: 72px;
  border: 1px dashed #52525b;
  border-radius: 6px;
  background: transparent;
  color: #a1a1aa;
  font-size: 24px;
  cursor: pointer;
}

.add-ref:hover,
.add-ref.drag-over {
  border-color: #6366f1;
  color: #6366f1;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hint {
  flex: 1 1 140px;
  min-width: 0;
  font-size: 12px;
  color: #71717a;
}

.action-buttons {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  max-width: 100%;
  margin-left: auto;
}

.generate {
  min-width: 150px;
  font: inherit;
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  background: #6366f1;
  color: #fff;
  cursor: pointer;
}

.stop-generation {
  display: inline-flex;
  min-width: 88px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 14px;
  border: 1px solid #b91c1c;
  border-radius: 6px;
  background: #7f1d1d55;
  color: #fca5a5;
  font: inherit;
  cursor: pointer;
}

.stop-generation:hover:not(:disabled) {
  background: #7f1d1d99;
  color: #fecaca;
}

.stop-generation:disabled {
  opacity: 0.6;
  cursor: default;
}

.stop-icon {
  width: 9px;
  height: 9px;
  flex: 0 0 9px;
  border-radius: 1px;
  background: currentColor;
}

.generate:hover:not(:disabled) {
  background: #818cf8;
}

.generate:disabled {
  opacity: 0.5;
  cursor: default;
}

.error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: #7f1d1d55;
  border: 1px solid #b91c1c;
  color: #fca5a5;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-btn {
  font: inherit;
  padding: 8px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #a1a1aa;
  cursor: pointer;
}

.log-btn.view-log {
  margin-top: auto;
}

.log-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.checkbox-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.checkbox-row input {
  width: 16px;
  height: 16px;
  accent-color: #6366f1;
}

.update-status {
  margin: 0;
  font-size: 12px;
  color: #a1a1aa;
  word-break: break-all;
}

.update-status a {
  color: #818cf8;
}

.log-btn:hover {
  border-color: #6366f1;
  color: #e4e4e7;
}

.log-panel {
  border: 1px solid #3f3f46;
  border-radius: 8px;
  background: #1f1f23;
  display: flex;
  flex-direction: column;
  max-height: 320px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #2e2e33;
  font-size: 13px;
  color: #a1a1aa;
}

.log-header button {
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #e4e4e7;
  cursor: pointer;
}

.log-header button:hover {
  border-color: #6366f1;
}

.log-path {
  margin: 0;
  padding: 4px 12px;
  font-size: 12px;
  color: #71717a;
  word-break: break-all;
}

.log-body {
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #d4d4d8;
  white-space: pre-wrap;
  word-break: break-all;
}

.preview-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
}

.preview-toolbar {
  display: flex;
  min-height: 32px;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  color: #a1a1aa;
  font-size: 13px;
}

.preview-status {
  color: #818cf8;
}

.preview-notice {
  color: #86efac;
}

.clear-results {
  margin-left: auto;
  padding: 5px 10px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #d4d4d8;
  font: inherit;
  cursor: pointer;
}

.clear-results:hover:not(:disabled) {
  border-color: #ef4444;
  color: #fca5a5;
}

.clear-results:disabled {
  opacity: 0.45;
  cursor: default;
}

.results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  gap: 16px;
}

.result-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-card img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid #3f3f46;
  background: #111113;
  cursor: zoom-in;
}

.result-actions {
  display: flex;
  gap: 8px;
}

.result-actions button {
  flex: 1;
  font: inherit;
  padding: 6px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #e4e4e7;
  cursor: pointer;
}

.result-actions button:hover {
  border-color: #6366f1;
}

.result-actions .delete-result:hover {
  border-color: #ef4444;
  color: #fca5a5;
}

.result-context-menu {
  position: fixed;
  z-index: 100;
  display: flex;
  width: 168px;
  max-width: calc(100vw - 16px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #52525b;
  border-radius: 6px;
  background: #27272a;
  box-shadow: 0 10px 28px #0009;
}

.result-context-menu button {
  min-height: 38px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid #3f3f46;
  background: transparent;
  color: #e4e4e7;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.result-context-menu button:last-child {
  border-bottom: 0;
}

.result-context-menu button:hover:not(:disabled) {
  background: #3f3f46;
}

.result-context-menu button:disabled {
  color: #71717a;
  cursor: default;
}

.result-context-menu .context-delete:hover {
  background: #7f1d1d99;
  color: #fecaca;
}

.result-lightbox {
  position: fixed;
  z-index: 120;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #09090be8;
  overscroll-behavior: contain;
}

.result-lightbox img {
  display: block;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 16px 48px #000c;
  cursor: zoom-out;
}

.lightbox-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #52525b;
  border-radius: 6px;
  background: #27272a;
  color: #f4f4f5;
  font: inherit;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.lightbox-close:hover {
  border-color: #a1a1aa;
  background: #3f3f46;
}

.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #52525b;
  border: 1px dashed #3f3f46;
  border-radius: 8px;
  min-height: 200px;
}
</style>
