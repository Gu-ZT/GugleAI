<script setup lang="ts">
import {computed, onMounted, onUnmounted, reactive, ref, watch} from "vue";
import {fetch as httpFetch, type ClientOptions} from "@tauri-apps/plugin-http";
import {save} from "@tauri-apps/plugin-dialog";
import {invoke} from "@tauri-apps/api/core";
import {openUrl} from "@tauri-apps/plugin-opener";
import {getVersion} from "@tauri-apps/api/app";
import {RouterView, useRoute, useRouter} from "vue-router";
import {
  IconImage,
  IconMessage,
  IconMindMapping,
  IconSettings,
} from "@arco-design/web-vue/es/icon";
import {OpenAIConnection} from "./api";
import {CanvasGraph, type CanvasImageAsset, type CanvasNode, type CanvasNodeData} from "./canvas";
import {ChatSession} from "./chat";
import {workspaceModeFromRoute, type WorkspaceMode} from "./router";
import SettingsModal from "./components/modals/SettingsModal.vue";
import ConnectionModal from "./components/modals/ConnectionModal.vue";
import ResultOverlays from "./components/modals/ResultOverlays.vue";

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
  models: string[];
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
const DEFAULT_TEXT_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "deepseek-chat",
  "claude-3-5-sonnet"
];
const DEFAULT_CONNECTION_MODELS = [...new Set([
  ...DEFAULT_MODEL_OPTIONS,
  ...DEFAULT_TEXT_MODEL_OPTIONS,
])];
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
  {id: DEFAULT_CONNECTION_ID, endpoint: DEFAULT_ENDPOINT, apiKey: "", models: [...DEFAULT_CONNECTION_MODELS]},
]);
const activeConnectionId = ref(DEFAULT_CONNECTION_ID);
const connectionMenuOpen = ref(false);
const connectionModalOpen = ref(false);
const connectionDraftId = ref("");
const connectionDraftEndpoint = ref("");
const connectionDraftApiKey = ref("");
const connectionDraftModels = ref<string[]>([]);
const connectionDraftModelInput = ref("");
const connectionDraftError = ref("");
const model = ref("gpt-image-2");
const modelOptions = ref([...DEFAULT_MODEL_OPTIONS]);
const modelMenuOpen = ref(false);
const modelShowAll = ref(true);
const route = useRoute();
const workspaceRouter = useRouter();
const appMode = computed(() => workspaceModeFromRoute(route.name));
const textModel = ref("gpt-4o-mini");
const textModelOptions = ref([...DEFAULT_TEXT_MODEL_OPTIONS]);
// auto: 多参考图自动改走 chat 接口(部分中转的 edits 接口只支持单图)
const apiMode = ref<"auto" | "images" | "chat">("auto");
const retryEnabled = ref(false);
const retryStatusCodes = ref<number[]>([504]);
const retryStatusCodeOptions = ref([...DEFAULT_RETRY_STATUS_CODE_OPTIONS]);
const retryStatusCodeInput = ref("");
const retryStatusCodeMenuOpen = ref(false);
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
const dragOver = ref(false);
const resultContextMenu = ref<ResultContextMenuState | null>(null);
const enlargedResult = ref<ResultImage | null>(null);
const previewNotice = ref("");
const settingsModalOpen = ref(false);

const chatSession = new ChatSession();
const chatMessages = chatSession.messages;
const chatDraft = chatSession.draft;
const chatLoading = chatSession.loading;
const chatStopping = chatSession.stopping;
const chatError = chatSession.error;

const canvasGraph = new CanvasGraph();
const canvasNodes = canvasGraph.nodes;
const canvasEdges = canvasGraph.edges;
const canvasBusyCount = ref(0);
const canvasControllers = new Map<string, AbortController>();

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

function normalizeConnectionModels(value: unknown, fallback = DEFAULT_CONNECTION_MODELS): string[] {
  const models = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  return [...new Set((models.length > 0 ? models : fallback).map((item) => item.trim()))];
}

function normalizeConnectionProfiles(
    value: unknown,
    fallbackModels = DEFAULT_CONNECTION_MODELS
): ConnectionProfile[] {
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
    profiles.push({
      id,
      endpoint: profileEndpoint,
      apiKey: profileApiKey,
      models: normalizeConnectionModels(record.models, fallbackModels),
    });
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

function addAndSelectConnection(
    endpointValue: string,
    apiKeyValue: string,
    modelsValue: string[] = DEFAULT_CONNECTION_MODELS
) {
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
    models: normalizeConnectionModels(modelsValue),
  };
  connectionProfiles.value = [...connectionProfiles.value, profile];
  selectConnection(profile);
  return true;
}

function openConnectionModal(profile?: ConnectionProfile) {
  connectionDraftId.value = profile?.id ?? "";
  connectionDraftEndpoint.value = profile?.endpoint ?? "";
  connectionDraftApiKey.value = profile?.apiKey ?? "";
  connectionDraftModels.value = [...(profile?.models ?? DEFAULT_CONNECTION_MODELS)];
  connectionDraftModelInput.value = "";
  connectionDraftError.value = "";
  connectionMenuOpen.value = false;
  connectionModalOpen.value = true;
}

function closeConnectionModal() {
  connectionModalOpen.value = false;
  connectionDraftId.value = "";
  connectionDraftEndpoint.value = "";
  connectionDraftApiKey.value = "";
  connectionDraftModels.value = [];
  connectionDraftModelInput.value = "";
  connectionDraftError.value = "";
}

function addConnectionDraftModel() {
  const draft = connectionDraftModelInput.value.trim();
  if (!draft) return;
  if (!connectionDraftModels.value.includes(draft)) {
    connectionDraftModels.value = [...connectionDraftModels.value, draft];
  }
  connectionDraftModelInput.value = "";
  connectionDraftError.value = "";
}

function removeConnectionDraftModel(modelName: string) {
  connectionDraftModels.value = connectionDraftModels.value.filter((item) => item !== modelName);
}

function saveConnectionDraft() {
  if (!connectionDraftEndpoint.value.trim()) {
    connectionDraftError.value = "请输入 API 端点";
    return;
  }
  addConnectionDraftModel();
  if (connectionDraftModels.value.length === 0) {
    connectionDraftError.value = "请至少添加一个可用模型";
    return;
  }
  const profileEndpoint = connectionDraftEndpoint.value.trim();
  const profileApiKey = connectionDraftApiKey.value.trim();
  const duplicate = connectionProfiles.value.find(
      (profile) => profile.id !== connectionDraftId.value &&
          profile.endpoint === profileEndpoint && profile.apiKey === profileApiKey
  );
  if (duplicate) {
    connectionDraftError.value = "相同端点和 API Key 的连接已存在";
    return;
  }
  if (connectionDraftId.value) {
    const updated: ConnectionProfile = {
      id: connectionDraftId.value,
      endpoint: profileEndpoint,
      apiKey: profileApiKey,
      models: [...connectionDraftModels.value],
    };
    connectionProfiles.value = connectionProfiles.value.map(
        (profile) => profile.id === updated.id ? updated : profile
    );
    if (activeConnectionId.value === updated.id) selectConnection(updated);
    for (const node of canvasNodes.value) {
      if (node.data.connectionId !== updated.id || updated.models.includes(node.data.model)) continue;
      updateCanvasNodeData(node.id, {model: updated.models[0]});
    }
  } else {
    addAndSelectConnection(profileEndpoint, profileApiKey, connectionDraftModels.value);
  }
  closeConnectionModal();
}

function removeConnection(profile: ConnectionProfile) {
  if (connectionProfiles.value.length <= 1) return;
  const remaining = connectionProfiles.value.filter((item) => item.id !== profile.id);
  connectionProfiles.value = remaining;
  if (activeConnectionId.value === profile.id) selectConnection(remaining[0]);
  for (const node of canvasNodes.value) {
    if (node.data.connectionId !== profile.id) continue;
    updateCanvasNodeData(node.id, {
      connectionId: remaining[0].id,
      model: remaining[0].models[0] ?? "",
    });
  }
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

function normalizeTextModelOptions(value: unknown): string[] {
  const saved = Array.isArray(value)
      ? value.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      : [];
  return [...new Set([...DEFAULT_TEXT_MODEL_OPTIONS, ...saved.map((option) => option.trim())])];
}

function addTextModelOption() {
  const value = textModel.value.trim();
  if (!value) return;
  textModel.value = value;
  if (!textModelOptions.value.includes(value)) {
    textModelOptions.value = [...textModelOptions.value, value];
  }
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
      const fallbackConnectionModels = normalizeConnectionModels([
        ...(Array.isArray(s.modelOptions) ? s.modelOptions : []),
        ...(Array.isArray(s.textModelOptions) ? s.textModelOptions : []),
        ...(typeof s.model === "string" ? [s.model] : []),
        ...(typeof s.textModel === "string" ? [s.textModel] : []),
      ]);
      const restoredProfiles = normalizeConnectionProfiles(
          s.connectionProfiles,
          fallbackConnectionModels
      );
      if (restoredProfiles.length === 0) {
        restoredProfiles.push({
          id: savedEndpoint === DEFAULT_ENDPOINT && !savedApiKey ? DEFAULT_CONNECTION_ID : createConnectionId(),
          endpoint: savedEndpoint,
          apiKey: savedApiKey,
          models: fallbackConnectionModels,
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
      textModel.value = typeof s.textModel === "string" && s.textModel.trim() ? s.textModel.trim() : textModel.value;
      textModelOptions.value = normalizeTextModelOptions(s.textModelOptions);
      if (textModel.value && !textModelOptions.value.includes(textModel.value)) {
        textModelOptions.value = [...textModelOptions.value, textModel.value];
      }
    } catch {
    }
  }
  window.addEventListener("paste", onPaste);
  window.addEventListener("blur", closeResultContextMenu);
  window.addEventListener("resize", closeResultContextMenu);
  window.addEventListener("scroll", closeResultContextMenu, true);
  document.addEventListener("keydown", closeResultOverlaysOnEscape);
  await restoreResultHistory();
  if (appMode.value === "canvas") seedCanvas();
  if (autoCheckUpdate.value) checkUpdate(false);
});

onUnmounted(() => {
  generationAbortController?.abort();
  chatSession.abort();
  for (const controller of canvasControllers.values()) controller.abort();
  canvasGraph.dispose();
  for (const image of results.value) URL.revokeObjectURL(image.previewUrl);
  if (previewNoticeTimer !== null) window.clearTimeout(previewNoticeTimer);
  window.removeEventListener("paste", onPaste);
  window.removeEventListener("blur", closeResultContextMenu);
  window.removeEventListener("resize", closeResultContextMenu);
  window.removeEventListener("scroll", closeResultContextMenu, true);
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
      textModel,
      textModelOptions,
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
            textModel: textModel.value,
            textModelOptions: textModelOptions.value,
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

function apiConnection(): OpenAIConnection {
  return new OpenAIConnection(endpoint.value, apiKey.value);
}

function extractTextContent(value: unknown): string {
  return OpenAIConnection.extractTextContent(value);
}

async function requestTextCompletion(
    messages: any[],
    signal: AbortSignal,
    taskId: number,
    modelName = textModel.value,
    connection = apiConnection()
): Promise<string> {
  const retryConfig = getRetryConfig();
  const resp = await fetchGeneration(
      `${connection.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: connection.jsonHeaders,
        body: JSON.stringify({model: modelName, messages}),
      },
      retryConfig,
      taskId,
      signal
  );
  const data = await parseResponse(resp);
  const content = extractTextContent(data.choices?.[0]?.message?.content);
  if (!content.trim()) throw new Error("响应中没有文字内容");
  return content;
}

async function sendChatMessage() {
  if (chatLoading.value || !chatDraft.value.trim()) return;
  const taskId = ++generationSequence;
  await chatSession.send({
    request: ({messages, signal}) => requestTextCompletion(
        messages.map((message) => ({role: message.role, content: message.content})),
        signal,
        taskId
    ),
    onStart: (messageCount) => log(
        "INFO",
        `任务=#${taskId} 开始文字聊天: 模型=${textModel.value} 消息数=${messageCount}`
    ),
    onSuccess: () => log("INFO", `任务=#${taskId} 文字聊天完成`),
    onStop: () => log("INFO", `任务=#${taskId} 文字聊天已停止`),
    onError: (chatRequestError) => {
      chatError.value = errorMessage(chatRequestError);
      log("ERROR", `任务=#${taskId} 文字聊天失败: ${formatErrorDetails(chatRequestError)}`);
    },
  });
}

function stopChat() {
  chatSession.stop();
}

function clearChat() {
  chatSession.clear();
}

const appBusy = computed(() => loading.value || chatLoading.value || canvasBusyCount.value > 0);

async function setAppMode(mode: WorkspaceMode) {
  if (appBusy.value) return;
  closeResultContextMenu();
  closeResultLightbox();
  if (mode === "canvas") seedCanvas();
  await workspaceRouter.push({name: mode});
}

function seedCanvas() {
  canvasGraph.seed(canvasNodeDefaults("text"), canvasNodeDefaults("image"));
}

function addCanvasTextNode() {
  canvasGraph.add("text", canvasNodeDefaults("text"));
}

function addCanvasImageNode() {
  canvasGraph.add("image", canvasNodeDefaults("image"));
}

function canvasNodeDefaults(type: "text" | "image") {
  const profile = connectionProfiles.value.find((item) => item.id === activeConnectionId.value)
      ?? connectionProfiles.value[0];
  const preferredModel = type === "text" ? textModel.value : model.value;
  return {
    connectionId: profile?.id ?? "",
    model: profile?.models.includes(preferredModel) ? preferredModel : profile?.models[0] ?? preferredModel,
  };
}

function canvasConnectionModels(connectionId: string): string[] {
  return connectionProfiles.value.find((profile) => profile.id === connectionId)?.models ?? [];
}

function updateCanvasNodeConnection(nodeId: string, connectionId: string) {
  const profile = connectionProfiles.value.find((item) => item.id === connectionId);
  if (!profile) return;
  const node = canvasGraph.findNode(nodeId);
  const nextModel = node && profile.models.includes(node.data.model)
      ? node.data.model
      : profile.models[0] ?? "";
  updateCanvasNodeData(nodeId, {connectionId, model: nextModel, error: ""});
}

function onCanvasNodeConnectionChange(nodeId: string, event: Event) {
  updateCanvasNodeConnection(nodeId, (event.target as HTMLSelectElement).value);
}

function connectionForCanvasNode(node: CanvasNode): OpenAIConnection {
  const profile = connectionProfiles.value.find((item) => item.id === node.data.connectionId);
  if (!profile) throw new Error("节点选择的 API 连接不存在，请重新选择");
  if (!node.data.model.trim()) throw new Error("请为节点选择模型");
  return new OpenAIConnection(profile.endpoint, profile.apiKey);
}

function updateCanvasNodeData(id: string, patch: Partial<CanvasNodeData>) {
  canvasGraph.updateData(id, patch);
}

function onCanvasConnect(connection: Parameters<CanvasGraph["connect"]>[0]) {
  canvasGraph.connect(connection);
}

function onCanvasNodesUpdate(nodes: Parameters<CanvasGraph["replaceNodes"]>[0]) {
  canvasGraph.replaceNodes(nodes);
}

function onCanvasEdgesUpdate(edges: Parameters<CanvasGraph["replaceEdges"]>[0]) {
  canvasGraph.replaceEdges(edges);
}

function deleteCanvasNode(id: string) {
  for (const removedId of canvasGraph.deleteNode(id)) {
    canvasControllers.get(removedId)?.abort();
    canvasControllers.delete(removedId);
  }
}

function canvasPrompt(node: CanvasNode): string {
  return canvasGraph.prompt(node);
}

function canvasReferenceAssets(node: CanvasNode): CanvasImageAsset[] {
  return canvasGraph.referenceAssets(node);
}

function assetToFile(asset: CanvasImageAsset): File {
  return new File([asset.blob], asset.name, {type: asset.mime});
}

function onCanvasImageFiles(nodeId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  canvasGraph.addFiles(nodeId, [...(input.files ?? [])]);
  input.value = "";
}

function openCanvasImagePicker(nodeId: string) {
  document.getElementById(`canvas-image-input-${nodeId}`)?.click();
}

function removeCanvasReference(nodeId: string, assetId: string) {
  canvasGraph.removeReference(nodeId, assetId);
}

async function assetDataUrl(asset: CanvasImageAsset): Promise<string> {
  return `data:${asset.mime};base64,${bufToBase64(await asset.blob.arrayBuffer())}`;
}

async function requestCanvasText(node: CanvasNode, signal: AbortSignal, taskId: number): Promise<string> {
  const promptText = canvasPrompt(node);
  if (!promptText) throw new Error("请先在节点或父节点中填写文字内容");
  const content: any[] = [{type: "text", text: promptText}];
  for (const asset of canvasReferenceAssets(node)) {
    content.push({type: "image_url", image_url: {url: await assetDataUrl(asset)}});
  }
  return requestTextCompletion(
      [{role: "user", content}],
      signal,
      taskId,
      node.data.model,
      connectionForCanvasNode(node)
  );
}

async function generateCanvasText(nodeId: string) {
  const node = canvasGraph.findNode(nodeId);
  if (!node || node.type !== "text" || node.data.readOnly || canvasControllers.has(nodeId)) return;
  const controller = new AbortController();
  canvasControllers.set(nodeId, controller);
  canvasBusyCount.value += 1;
  updateCanvasNodeData(nodeId, {status: "running", error: ""});
  try {
    const output = await requestCanvasText(node, controller.signal, ++generationSequence);
    canvasGraph.addGeneratedTextChild(nodeId, output);
    updateCanvasNodeData(nodeId, {status: "success"});
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      updateCanvasNodeData(nodeId, {status: "idle"});
    } else {
      updateCanvasNodeData(nodeId, {status: "error", error: errorMessage(e)});
    }
  } finally {
    canvasBusyCount.value -= 1;
    canvasControllers.delete(nodeId);
  }
}

async function downloadCanvasImageBlob(base: string, url: string, signal: AbortSignal): Promise<Blob> {
  const candidates: string[] = [];
  if (/^https?:\/\//i.test(url)) {
    candidates.push(url);
  } else {
    const path = url.startsWith("/") ? url : `/${url}`;
    candidates.push(base + path);
    try {
      const origin = new URL(base).origin;
      if (origin + path !== base + path) candidates.push(origin + path);
    } catch {
    }
  }
  let lastStatus = 0;
  for (const imageUrl of candidates) {
    throwIfGenerationAborted(signal);
    const response = await fetch(imageUrl, {signal});
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      return new Blob([buffer], {type: normalizeImageMime(response.headers.get("content-type"))});
    }
    lastStatus = response.status;
  }
  throw new Error(`下载图片失败 (${lastStatus})`);
}

async function requestCanvasImages(
    node: CanvasNode,
    promptText: string,
    references: CanvasImageAsset[],
    amount: number,
    signal: AbortSignal,
    taskId: number
): Promise<Blob[]> {
  const connection = connectionForCanvasNode(node);
  const base = connection.baseUrl;
  const retryConfig = getRetryConfig();
  const useChat = apiMode.value === "chat" || (apiMode.value === "auto" && references.length > 1);
  if (useChat) {
    const content: any[] = [{type: "text", text: promptText}];
    for (const asset of references) {
      content.push({type: "image_url", image_url: {url: await assetDataUrl(asset)}});
    }
    const response = await fetchGeneration(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: connection.jsonHeaders,
          body: JSON.stringify({model: node.data.model, messages: [{role: "user", content}], n: amount}),
        },
        retryConfig,
        taskId,
        signal
    );
    const data = await parseResponse(response);
    const blobs: Blob[] = [];
    for (const choice of data.choices ?? []) {
      const message = choice.message ?? {};
      for (const image of message.images ?? []) {
        const url = image?.image_url?.url ?? image?.url;
        if (url) blobs.push(await canvasImageUrlToBlob(base, url, signal));
      }
      const text = extractTextContent(message.content);
      for (const match of text.matchAll(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
        blobs.push(base64ToBlob(match[2], match[1]));
      }
      if (blobs.length === 0) {
        for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)) {
          blobs.push(await canvasImageUrlToBlob(base, match[1], signal));
        }
      }
    }
    return blobs.slice(0, amount);
  }

  let response: Response;
  if (references.length > 0) {
    const form = new FormData();
    form.append("model", node.data.model);
    form.append("prompt", promptText);
    form.append("n", String(amount));
    if (size.value !== "auto") form.append("size", size.value);
    for (const asset of references) form.append("image[]", assetToFile(asset), asset.name);
    response = await fetchGeneration(
        `${base}/images/edits`,
        {method: "POST", headers: connection.authHeaders, body: form},
        retryConfig,
        taskId,
        signal
    );
  } else {
    response = await fetchGeneration(
        `${base}/images/generations`,
        {
          method: "POST",
          headers: connection.jsonHeaders,
          body: JSON.stringify({
            model: node.data.model,
            prompt: promptText,
            n: amount,
            ...(size.value !== "auto" ? {size: size.value} : {}),
          }),
        },
        retryConfig,
        taskId,
        signal
    );
  }
  const data = await parseResponse(response);
  const blobs: Blob[] = [];
  for (const item of data.data ?? []) {
    if (item.b64_json) blobs.push(base64ToBlob(item.b64_json, "image/png"));
    else if (item.url) blobs.push(await canvasImageUrlToBlob(base, item.url, signal));
  }
  return blobs.slice(0, amount);
}

async function canvasImageUrlToBlob(base: string, url: string, signal: AbortSignal): Promise<Blob> {
  const dataUrl = url.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (dataUrl) return base64ToBlob(dataUrl[2], dataUrl[1]);
  return downloadCanvasImageBlob(base, url, signal);
}

async function generateCanvasImage(nodeId: string) {
  const node = canvasGraph.findNode(nodeId);
  if (!node || node.type !== "image" || node.data.readOnly || canvasControllers.has(nodeId)) return;
  if (node.data.references.length > 0) {
    updateCanvasNodeData(nodeId, {status: "error", error: "参考图节点不能直接生成，请新建图像节点并连接此节点"});
    return;
  }
  const promptText = canvasPrompt(node);
  if (!promptText) {
    updateCanvasNodeData(nodeId, {status: "error", error: "请先填写提示词或连接文字节点"});
    return;
  }
  const references = canvasReferenceAssets(node);
  const amount = Math.max(1, Math.min(10, Number(node.data.count) || 1));
  const controller = new AbortController();
  canvasControllers.set(nodeId, controller);
  canvasBusyCount.value += 1;
  updateCanvasNodeData(nodeId, {status: "running", error: ""});
  try {
    const blobs = await requestCanvasImages(
        node,
        promptText,
        references,
        amount,
        controller.signal,
        ++generationSequence
    );
    if (blobs.length === 0) throw new Error("响应中没有图片数据");
    canvasGraph.addGeneratedOutputs(nodeId, blobs);
    updateCanvasNodeData(nodeId, {status: "success"});
  } catch (e: unknown) {
    if (controller.signal.aborted) updateCanvasNodeData(nodeId, {status: "idle"});
    else updateCanvasNodeData(nodeId, {status: "error", error: errorMessage(e)});
  } finally {
    canvasBusyCount.value -= 1;
    canvasControllers.delete(nodeId);
  }
}

function stopCanvasNode(nodeId: string) {
  canvasControllers.get(nodeId)?.abort();
}

function clearCanvas() {
  if (canvasNodes.value.length === 0) return;
  if (!window.confirm("确定清空无尽画布中的全部节点和连接吗？")) return;
  for (const controller of canvasControllers.values()) controller.abort();
  canvasControllers.clear();
  canvasGraph.clear();
}

const viewModel = reactive({
  appMode,
  appBusy,
  settingsModalOpen,
  endpoint,
  apiKey,
  connectionProfiles,
  activeConnectionId,
  connectionMenuOpen,
  connectionModalOpen,
  connectionDraftId,
  connectionDraftEndpoint,
  connectionDraftApiKey,
  connectionDraftModels,
  connectionDraftModelInput,
  connectionDraftError,
  model,
  modelOptions,
  modelMenuOpen,
  modelShowAll,
  filteredModelOptions,
  canAddModelOption,
  textModel,
  textModelOptions,
  apiMode,
  retryEnabled,
  retryStatusCodes,
  retryStatusCodeOptions,
  retryStatusCodeInput,
  retryStatusCodeMenuOpen,
  retryCount,
  filteredRetryStatusCodeOptions,
  retryStatusCodeInputValue,
  showRetryStatusCodeInputAction,
  autoCheckUpdate,
  size,
  count,
  checkingUpdate,
  updateStatus,
  updateUrl,
  showLogs,
  logs,
  logFilePath,
  prompt,
  refImages,
  results,
  historyLoading,
  loading,
  stopping,
  error,
  dragOver,
  previewNotice,
  hintText,
  resultContextMenu,
  enlargedResult,
  chatMessages,
  chatDraft,
  chatLoading,
  chatStopping,
  chatError,
  canvasNodes,
  canvasEdges,
  DEFAULT_MODEL_OPTIONS,
  DEFAULT_RETRY_STATUS_CODE_OPTIONS,
  setAppMode,
  maskApiKey,
  connectionOptionNumber,
  selectConnection,
  openConnectionModal,
  closeConnectionModal,
  saveConnectionDraft,
  removeConnection,
  addConnectionDraftModel,
  removeConnectionDraftModel,
  selectModelOption,
  addModelOption,
  removeModelOption,
  addTextModelOption,
  toggleRetryStatusCode,
  addRetryStatusCode,
  removeRetryStatusCodeOption,
  checkUpdate,
  openDownloadPage,
  openLogFile,
  addImages,
  removeImage,
  onDrop,
  generate,
  stopGeneration,
  clearResultHistory,
  saveImage,
  deleteResultImage,
  openResultContextMenu,
  closeResultContextMenu,
  openResultLightbox,
  closeResultLightbox,
  copyResultPrompt,
  copyResultImage,
  setResultAsReference,
  saveResultFromContextMenu,
  deleteResultFromContextMenu,
  sendChatMessage,
  stopChat,
  clearChat,
  addCanvasTextNode,
  addCanvasImageNode,
  updateCanvasNodeData,
  onCanvasConnect,
  onCanvasNodesUpdate,
  onCanvasEdgesUpdate,
  deleteCanvasNode,
  onCanvasNodeConnectionChange,
  canvasConnectionModels,
  onCanvasImageFiles,
  openCanvasImagePicker,
  removeCanvasReference,
  generateCanvasText,
  generateCanvasImage,
  stopCanvasNode,
  clearCanvas,
});
</script>

<template>
  <main class="app">
    <aside class="nav-rail" aria-label="工作区导航">
      <nav class="workspace-nav">
        <button
            type="button"
            class="nav-rail-button"
            :class="{ active: appMode === 'image' }"
            :disabled="appBusy"
            title="生图"
            @click="setAppMode('image')"
        >
          <IconImage aria-hidden="true"/>
          <span>生图</span>
        </button>
        <button
            type="button"
            class="nav-rail-button"
            :class="{ active: appMode === 'chat' }"
            :disabled="appBusy"
            title="聊天"
            @click="setAppMode('chat')"
        >
          <IconMessage aria-hidden="true"/>
          <span>聊天</span>
        </button>
        <button
            type="button"
            class="nav-rail-button"
            :class="{ active: appMode === 'canvas' }"
            :disabled="appBusy"
            title="无尽画布"
            @click="setAppMode('canvas')"
        >
          <IconMindMapping aria-hidden="true"/>
          <span>无尽画布</span>
        </button>
      </nav>
      <button
          type="button"
          class="nav-rail-button settings-button"
          :class="{ active: settingsModalOpen }"
          title="设置"
          @click="settingsModalOpen = true"
      >
        <IconSettings aria-hidden="true"/>
        <span>设置</span>
      </button>
    </aside>

    <section class="content">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :app="viewModel"/>
      </RouterView>
    </section>

    <SettingsModal :app="viewModel"/>
    <ConnectionModal :app="viewModel"/>
    <ResultOverlays :app="viewModel"/>
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

<style>
.app {
  display: flex;
  height: 100vh;
}

.nav-rail {
  position: relative;
  display: flex;
  width: 68px;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  padding: 8px 6px;
  background: #1f1f23;
  border-right: 1px solid #2e2e33;
}

.workspace-nav {
  position: absolute;
  top: 50%;
  left: 6px;
  display: flex;
  width: 56px;
  flex-direction: column;
  gap: 8px;
  transform: translateY(-50%);
}

.nav-rail-button {
  display: flex;
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 2px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #a1a1aa;
  font: inherit;
  cursor: pointer;
}

.nav-rail-button svg {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
}

.nav-rail-button span {
  width: 100%;
  overflow: hidden;
  font-size: 10px;
  line-height: 1.2;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-rail-button:hover:not(:disabled) {
  background: #323237;
  color: #f4f4f5;
}

.nav-rail-button.active {
  background: #4f46e5;
  color: #fff;
}

.nav-rail-button:disabled {
  opacity: 0.55;
  cursor: default;
}

.settings-button {
  margin-top: auto;
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

.combo-edit-option {
  min-width: 42px;
  height: 28px;
  flex: 0 0 42px;
  padding: 0 5px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #a1a1aa;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.combo-edit-option:hover {
  background: #3f3f46;
  color: #fff;
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

.settings-backdrop {
  z-index: 90;
}

.connection-backdrop {
  z-index: 110;
}

.settings-modal {
  display: flex;
  width: min(560px, 100%);
  max-height: calc(100vh - 32px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  background: #1f1f23;
  box-shadow: 0 16px 48px #000a;
}

.settings-modal > .modal-header {
  flex: 0 0 auto;
  padding: 14px 16px;
  border-bottom: 1px solid #2e2e33;
}

.settings-body {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 14px 16px 18px;
}

.settings-body h3 {
  margin: 6px 0 0;
  color: #a1a1aa;
  font-size: 12px;
  letter-spacing: 0;
}

.settings-log-panel {
  max-height: 260px;
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

.connection-model-editor {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.connection-model-input-row {
  display: flex;
  gap: 7px;
}

.connection-model-input-row input {
  min-width: 0;
  flex: 1;
}

.connection-model-input-row button {
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 1px solid #52525b;
  border-radius: 6px;
  background: #27272a;
  color: #e4e4e7;
  font: inherit;
  cursor: pointer;
}

.connection-model-list {
  display: flex;
  max-height: 138px;
  flex-wrap: wrap;
  gap: 6px;
  overflow-y: auto;
}

.connection-model-chip {
  display: inline-flex;
  max-width: 100%;
  min-height: 26px;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
  border: 1px solid #52525b;
  border-radius: 4px;
  background: #323237;
  color: #d4d4d8;
  font-size: 12px;
}

.connection-model-chip > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-model-chip button {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}

.connection-model-chip button:hover {
  color: #fca5a5;
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

.image-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 16px;
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

.workspace-toolbar .arco-btn-secondary {
  border-color: #3f3f46;
  background: #27272a;
  color: #d4d4d8;
}

.workspace-toolbar .arco-btn-secondary:hover {
  border-color: #71717a;
  color: #fff;
}

.workspace-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 36px;
}

.workspace-toolbar > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.workspace-toolbar strong {
  font-size: 14px;
  color: #f4f4f5;
}

.workspace-meta {
  max-width: min(620px, 70vw);
  overflow: hidden;
  color: #71717a;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.secondary-action {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #d4d4d8;
  font: inherit;
  cursor: pointer;
}

.secondary-action:hover:not(:disabled) {
  border-color: #71717a;
  color: #fff;
}

.secondary-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.chat-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
}

.chat-messages {
  display: flex;
  flex: 1;
  min-height: 240px;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 10px 2px;
}

.chat-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: #52525b;
}

.chat-message {
  max-width: min(780px, 88%);
}

.chat-message.user {
  align-self: flex-end;
}

.chat-message.assistant {
  align-self: flex-start;
}

.chat-role {
  margin-bottom: 5px;
  color: #71717a;
  font-size: 12px;
}

.chat-message p,
.chat-thinking {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #3f3f46;
  border-radius: 7px;
  background: #222225;
  color: #e4e4e7;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-message.user p {
  border-color: #4f46e5;
  background: #312e8155;
}

.chat-thinking {
  color: #a1a1aa;
}

.chat-composer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #2e2e33;
}

.chat-composer textarea {
  min-height: 92px;
}

.chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chat-actions .generate {
  min-width: 100px;
}

.canvas-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
}

.canvas-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.canvas-shell {
  flex: 1;
  min-height: 460px;
  overflow: hidden;
  border: 1px solid #2e2e33;
  border-radius: 7px;
}

.canvas-flow {
  width: 100%;
  height: 100%;
  background-color: #171716;
  background-image:
      linear-gradient(#282826 1px, transparent 1px),
      linear-gradient(90deg, #282826 1px, transparent 1px);
  background-size: 28px 28px;
}

.canvas-flow .vue-flow__node {
  border: 0;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
}

.canvas-flow .vue-flow__node.selected .canvas-node {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px #3b82f655;
}

.canvas-flow .vue-flow__edge-path {
  stroke: #d4d4d8;
  stroke-width: 1.6;
}

.canvas-flow .vue-flow__handle {
  width: 10px;
  height: 10px;
  border: 2px solid #18181b;
  background: #a1a1aa;
}

.canvas-node {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 220px;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px solid #52525b;
  border-radius: 8px;
  background: #272422;
  color: #e4e4e7;
  box-shadow: 0 12px 28px #0006;
}

.canvas-node-header {
  display: flex;
  min-height: 26px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.canvas-node-header strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-node-config {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 7px;
}

.canvas-node-config label {
  display: grid;
  min-width: 0;
  grid-template-columns: 66px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  color: #a1a1aa;
  font-size: 12px;
}

.canvas-node-config select {
  width: 100%;
  min-width: 0;
  padding: 5px 7px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-node-delete {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #a1a1aa;
  font-size: 18px;
  cursor: pointer;
}

.canvas-node-delete:hover {
  background: #7f1d1d88;
  color: #fecaca;
}

.canvas-node textarea {
  width: 100%;
  min-height: 78px;
  resize: vertical;
  background: #211f1e;
}

.canvas-node-output {
  max-height: 180px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #d4d4d8;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.canvas-node-actions {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  margin-top: auto;
}

.canvas-node-actions button {
  min-height: 30px;
  padding: 5px 10px;
  border-radius: 6px;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.node-generate {
  border: 1px solid #4f46e5;
  background: #4f46e5;
}

.node-stop {
  border: 1px solid #b91c1c;
  background: #7f1d1d99;
}

.canvas-node-status,
.canvas-node-success {
  margin-right: auto;
  font-size: 12px;
}

.canvas-node-status {
  color: #93c5fd;
}

.canvas-node-success {
  color: #86efac;
}

.canvas-node-error {
  margin: 0;
  color: #fca5a5;
  font-size: 12px;
  word-break: break-word;
}

.canvas-node-images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.canvas-node-image {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #18181b;
}

.canvas-node-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.canvas-node-image button {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: #18181bcc;
  color: #fff;
  cursor: pointer;
}

.canvas-empty-image {
  display: flex;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: #71717a;
}

.canvas-image-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.canvas-image-options label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.canvas-image-options input {
  width: 66px;
  padding: 5px 7px;
}

.canvas-reference-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #a1a1aa;
  font-size: 12px;
}

.canvas-image-node.readonly {
  min-height: 220px;
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

@media (max-width: 760px) {
  .content {
    padding: 12px;
    gap: 12px;
  }

  .workspace-meta {
    max-width: calc(100vw - 112px);
  }

  .chat-message {
    max-width: 96%;
  }

  .canvas-toolbar-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .canvas-shell {
    min-height: 420px;
  }
}
</style>
