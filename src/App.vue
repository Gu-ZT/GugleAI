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
import ModelModal from "./components/modals/ModelModal.vue";
import ResultOverlays from "./components/modals/ResultOverlays.vue";
import UnsavedChangesModal from "./components/modals/UnsavedChangesModal.vue";

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
  name: string;
  endpoint: string;
  apiKey: string;
  models: ProviderModel[];
}

interface ProviderModel {
  id: string;
  displayName: string;
  description: string;
  isImage: boolean;
  contextLength: number;
}

interface ResolvedModel {
  provider: ConnectionProfile;
  model: ProviderModel;
}

type ThemeMode = "light" | "dark" | "system";


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
  {
    id: DEFAULT_CONNECTION_ID,
    name: "OpenAI",
    endpoint: DEFAULT_ENDPOINT,
    apiKey: "",
    models: defaultProviderModels(),
  },
]);
const activeConnectionId = ref(DEFAULT_CONNECTION_ID);
const selectedProviderId = ref(DEFAULT_CONNECTION_ID);
const connectionMenuOpen = ref(false);
const connectionDraftId = ref("");
const connectionDraftName = ref("");
const connectionDraftEndpoint = ref("");
const connectionDraftApiKey = ref("");
const connectionDraftError = ref("");
const providerDraftIsNew = ref(false);
const providerDraftPreviousId = ref(DEFAULT_CONNECTION_ID);
const unsavedChangesModalOpen = ref(false);
const modelModalOpen = ref(false);
const modelDraftProviderId = ref("");
const modelDraftOriginalId = ref("");
const modelDraftId = ref("");
const modelDraftDisplayName = ref("");
const modelDraftDescription = ref("");
const modelDraftIsImage = ref(false);
const modelDraftContextLength = ref(256000);
const modelDraftError = ref("");
const model = ref("gpt-image-2");
const modelOptions = ref([...DEFAULT_MODEL_OPTIONS]);
const route = useRoute();
const workspaceRouter = useRouter();
const appMode = computed(() => workspaceModeFromRoute(route.name));
const textModel = ref("gpt-4o-mini");
const textModelOptions = ref([...DEFAULT_TEXT_MODEL_OPTIONS]);
const imageModelSelection = ref("");
const chatModelSelection = ref("");
const titleModelSelection = ref("current");
// auto: 多参考图自动改走 chat 接口(部分中转的 edits 接口只支持单图)
const apiMode = ref<"auto" | "images" | "chat">("auto");
const retryEnabled = ref(false);
const retryStatusCodes = ref<number[]>([504]);
const retryStatusCodeOptions = ref([...DEFAULT_RETRY_STATUS_CODE_OPTIONS]);
const retryStatusCodeInput = ref("");
const retryStatusCodeMenuOpen = ref(false);
const retryCount = ref(5);
const autoCheckUpdate = ref(true);
const themeMode = ref<ThemeMode>("system");
const size = ref("auto");
const customWidth = ref(1024);
const customHeight = ref(1024);
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

const chatSession = new ChatSession();
const chatConversations = chatSession.conversations;
const activeChatConversationId = chatSession.activeConversationId;
const activeChatConversation = computed(() => chatSession.activeConversation);
const chatMessages = chatSession.messages;
const chatDraft = chatSession.draft;
const chatLoading = chatSession.loading;
const chatStopping = chatSession.stopping;
const chatError = chatSession.error;
const chatCopiedMessageId = ref("");
const titleGenerationControllers = new Map<string, AbortController>();

const canvasGraph = new CanvasGraph();
const canvasNodes = canvasGraph.nodes;
const canvasEdges = canvasGraph.edges;
const canvasBusyCount = ref(0);
const canvasControllers = new Map<string, AbortController>();

const logs = ref<string[]>([]);
const logFilePath = ref("");
let generationSequence = 0;
let generationAbortController: AbortController | null = null;
let activeGenerationId: number | null = null;
let resultHistoryDbPromise: Promise<IDBDatabase> | null = null;
let previewNoticeTimer: number | null = null;
let chatCopyNoticeTimer: number | null = null;
const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function applyTheme() {
  const useDarkTheme = themeMode.value === "dark"
      || (themeMode.value === "system" && systemDarkQuery.matches);
  if (useDarkTheme) {
    document.body.setAttribute("arco-theme", "dark");
  } else {
    document.body.removeAttribute("arco-theme");
  }
  document.documentElement.style.colorScheme = useDarkTheme ? "dark" : "light";
}

try {
  const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
  themeMode.value = normalizeThemeMode(savedSettings?.themeMode);
} catch {
}
applyTheme();

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

function defaultProviderModels(): ProviderModel[] {
  return normalizeProviderModels(DEFAULT_CONNECTION_MODELS);
}

function normalizeProviderModels(
    value: unknown,
    fallback: string[] = DEFAULT_CONNECTION_MODELS
): ProviderModel[] {
  const source = Array.isArray(value) ? value : fallback;
  const models: ProviderModel[] = [];
  const usedIds = new Set<string>();
  for (const item of source) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const id = typeof item === "string"
        ? item.trim()
        : typeof record?.id === "string"
            ? record.id.trim()
            : "";
    if (!id || usedIds.has(id)) continue;
    const contextLengthValue = Number(record?.contextLength ?? 256000);
    models.push({
      id,
      displayName: typeof record?.displayName === "string" ? record.displayName.trim() : "",
      description: typeof record?.description === "string" ? record.description.trim() : "",
      isImage: typeof record?.isImage === "boolean"
          ? record.isImage
          : DEFAULT_MODEL_OPTIONS.includes(id),
      contextLength: Number.isInteger(contextLengthValue) && contextLengthValue > 0
          ? contextLengthValue
          : 256000,
    });
    usedIds.add(id);
  }
  return models;
}

function normalizeConnectionProfiles(
    value: unknown,
    fallbackModels = DEFAULT_CONNECTION_MODELS
): ConnectionProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: ConnectionProfile[] = [];
  const usedIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const profileEndpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
    const profileApiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
    if (!profileEndpoint) continue;
    let id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : createConnectionId();
    if (usedIds.has(id)) id = createConnectionId();
    profiles.push({
      id,
      name: typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : providerNameFromEndpoint(profileEndpoint, profiles.length + 1),
      endpoint: profileEndpoint,
      apiKey: profileApiKey,
      models: normalizeProviderModels(record.models, fallbackModels),
    });
    usedIds.add(id);
  }
  return profiles;
}

function providerNameFromEndpoint(endpointValue: string, index: number): string {
  try {
    return new URL(endpointValue).hostname || `提供商 ${index}`;
  } catch {
    return `提供商 ${index}`;
  }
}

function modelSelectionKey(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}|${encodeURIComponent(modelId)}`;
}

function resolveModelSelection(value: string): ResolvedModel | null {
  const separator = value.indexOf("|");
  if (separator < 0) return null;
  let providerId = "";
  let modelId = "";
  try {
    providerId = decodeURIComponent(value.slice(0, separator));
    modelId = decodeURIComponent(value.slice(separator + 1));
  } catch {
    return null;
  }
  const provider = connectionProfiles.value.find((item) => item.id === providerId);
  const providerModel = provider?.models.find((item) => item.id === modelId);
  return provider && providerModel ? {provider, model: providerModel} : null;
}

function modelDisplayName(modelValue: ProviderModel): string {
  return modelValue.displayName || modelValue.id;
}

function resolvedModelLabel(resolved: ResolvedModel): string {
  return `${modelDisplayName(resolved.model)} · ${resolved.provider.name}`;
}

const imageModelGroups = computed(() => connectionProfiles.value
    .map((provider) => ({
      provider,
      models: provider.models.filter((item) => item.isImage),
    }))
    .filter((group) => group.models.length > 0));

const textModelGroups = computed(() => connectionProfiles.value
    .map((provider) => ({
      provider,
      models: provider.models.filter((item) => !item.isImage),
    }))
    .filter((group) => group.models.length > 0));

function modelSelectOptions(groups: typeof imageModelGroups.value) {
  return groups.map((group) => ({
    isGroup: true as const,
    label: group.provider.name,
    options: group.models.map((providerModel) => ({
      value: modelSelectionKey(group.provider.id, providerModel.id),
      label: modelDisplayName(providerModel),
      providerName: group.provider.name,
    })),
  }));
}

const imageModelSelectOptions = computed(() => modelSelectOptions(imageModelGroups.value));
const textModelSelectOptions = computed(() => modelSelectOptions(textModelGroups.value));
const titleModelSelectOptions = computed(() => [
  {value: "current", label: "使用当前聊天模型", providerName: ""},
  {value: "none", label: "不生成标题", providerName: ""},
  ...textModelSelectOptions.value,
]);

const providerList = computed<ConnectionProfile[]>(() => {
  if (!connectionDraftId.value) return connectionProfiles.value;
  if (providerDraftIsNew.value) {
    return [
      ...connectionProfiles.value,
      {
        id: connectionDraftId.value,
        name: connectionDraftName.value.trim() || "新提供商",
        endpoint: connectionDraftEndpoint.value.trim(),
        apiKey: connectionDraftApiKey.value,
        models: [],
      },
    ];
  }
  return connectionProfiles.value.map((provider) => provider.id === connectionDraftId.value
      ? {
        ...provider,
        name: connectionDraftName.value.trim() || "未命名提供商",
        endpoint: connectionDraftEndpoint.value,
        apiKey: connectionDraftApiKey.value,
      }
      : provider);
});

const selectedProvider = computed(() => providerList.value.find(
    (provider) => provider.id === selectedProviderId.value
) ?? providerList.value[0]);

const hasUnsavedProviderChanges = computed(() => {
  if (!connectionDraftId.value) return false;
  if (providerDraftIsNew.value) return true;
  const provider = connectionProfiles.value.find((item) => item.id === connectionDraftId.value);
  if (!provider) return false;
  return (
    connectionDraftName.value !== provider.name ||
    connectionDraftEndpoint.value !== provider.endpoint ||
    connectionDraftApiKey.value !== provider.apiKey
  );
});

function firstModelSelection(image: boolean): string {
  const group = (image ? imageModelGroups.value : textModelGroups.value)[0];
  const firstModel = group?.models[0];
  return group && firstModel ? modelSelectionKey(group.provider.id, firstModel.id) : "";
}

function ensureModelSelections(): void {
  const selectedImage = resolveModelSelection(imageModelSelection.value);
  if (!selectedImage?.model.isImage) imageModelSelection.value = firstModelSelection(true);
  const selectedText = resolveModelSelection(chatModelSelection.value);
  if (!selectedText || selectedText.model.isImage) chatModelSelection.value = firstModelSelection(false);
  if (
    titleModelSelection.value !== "current" &&
    titleModelSelection.value !== "none" &&
    (!resolveModelSelection(titleModelSelection.value) ||
      resolveModelSelection(titleModelSelection.value)?.model.isImage)
  ) {
    titleModelSelection.value = "current";
  }
  const imageResolved = resolveModelSelection(imageModelSelection.value);
  const textResolved = resolveModelSelection(chatModelSelection.value);
  if (imageResolved) model.value = imageResolved.model.id;
  if (textResolved) textModel.value = textResolved.model.id;
  if (!connectionProfiles.value.some((item) => item.id === selectedProviderId.value)) {
    selectedProviderId.value = connectionProfiles.value[0]?.id ?? "";
  }
}

function selectConnection(profile: ConnectionProfile) {
  activeConnectionId.value = profile.id;
  selectedProviderId.value = profile.id;
  endpoint.value = profile.endpoint;
  apiKey.value = profile.apiKey;
  connectionMenuOpen.value = false;
}

type UnsavedChangesDecision = "save" | "discard" | "cancel";

let unsavedChangesResolver: ((decision: UnsavedChangesDecision) => void) | null = null;
let pendingUnsavedChangesDecision: Promise<UnsavedChangesDecision> | null = null;

function resetConnectionDraft(profile: ConnectionProfile) {
  connectionDraftId.value = profile.id;
  connectionDraftName.value = profile.name;
  connectionDraftEndpoint.value = profile.endpoint;
  connectionDraftApiKey.value = profile.apiKey;
  connectionDraftError.value = "";
  providerDraftIsNew.value = false;
}

function requestUnsavedChangesDecision(): Promise<UnsavedChangesDecision> {
  if (pendingUnsavedChangesDecision) return pendingUnsavedChangesDecision;
  unsavedChangesModalOpen.value = true;
  pendingUnsavedChangesDecision = new Promise((resolve) => {
    unsavedChangesResolver = resolve;
  });
  return pendingUnsavedChangesDecision;
}

function resolveUnsavedChanges(decision: UnsavedChangesDecision) {
  const resolve = unsavedChangesResolver;
  unsavedChangesResolver = null;
  pendingUnsavedChangesDecision = null;
  unsavedChangesModalOpen.value = false;
  resolve?.(decision);
}

function cancelConnectionDraft() {
  if (providerDraftIsNew.value) {
    const fallback = connectionProfiles.value.find((item) => item.id === providerDraftPreviousId.value)
        ?? connectionProfiles.value[0];
    if (fallback) {
      selectConnection(fallback);
      resetConnectionDraft(fallback);
    }
    return;
  }
  const provider = connectionProfiles.value.find((item) => item.id === connectionDraftId.value);
  if (provider) resetConnectionDraft(provider);
}

async function confirmProviderChanges(): Promise<boolean> {
  if (!hasUnsavedProviderChanges.value) return true;
  const decision = await requestUnsavedChangesDecision();
  if (decision === "cancel") return false;
  if (decision === "save") return saveConnectionDraft();
  cancelConnectionDraft();
  return true;
}

function warnAboutUnsavedProviderChanges(event: BeforeUnloadEvent) {
  if (!hasUnsavedProviderChanges.value) return;
  event.preventDefault();
  event.returnValue = "";
}

const removeProviderRouteGuard = workspaceRouter.beforeEach(async (to, from) => {
  if (to.fullPath === from.fullPath) return true;
  return confirmProviderChanges();
});

async function selectProvider(providerId: string) {
  if (providerId === selectedProviderId.value) return;
  if (!await confirmProviderChanges()) return;
  const provider = connectionProfiles.value.find((item) => item.id === providerId);
  if (!provider) return;
  selectConnection(provider);
  resetConnectionDraft(provider);
}

function addAndSelectConnection(
    endpointValue: string,
    apiKeyValue: string,
    modelsValue: Array<string | ProviderModel> = DEFAULT_CONNECTION_MODELS,
    nameValue = ""
) {
  if (hasUnsavedProviderChanges.value) return false;
  const profileEndpoint = endpointValue.trim();
  const profileApiKey = apiKeyValue.trim();
  if (!profileEndpoint) return false;
  const existing = connectionProfiles.value.find(
      (profile) => profile.endpoint === profileEndpoint && profile.apiKey === profileApiKey
  );
  if (existing) {
    selectConnection(existing);
    resetConnectionDraft(existing);
    return true;
  }
  const profile: ConnectionProfile = {
    id: createConnectionId(),
    name: nameValue.trim() || providerNameFromEndpoint(profileEndpoint, connectionProfiles.value.length + 1),
    endpoint: profileEndpoint,
    apiKey: profileApiKey,
    models: normalizeProviderModels(modelsValue),
  };
  connectionProfiles.value = [...connectionProfiles.value, profile];
  selectConnection(profile);
  resetConnectionDraft(profile);
  ensureModelSelections();
  return true;
}

async function addProviderDraft() {
  if (!await confirmProviderChanges()) return;
  providerDraftPreviousId.value = connectionProfiles.value.some(
      (item) => item.id === selectedProviderId.value
  ) ? selectedProviderId.value : connectionProfiles.value[0]?.id ?? "";
  connectionDraftId.value = createConnectionId();
  connectionDraftName.value = "";
  connectionDraftEndpoint.value = "";
  connectionDraftApiKey.value = "";
  connectionDraftError.value = "";
  connectionMenuOpen.value = false;
  providerDraftIsNew.value = true;
  selectedProviderId.value = connectionDraftId.value;
}

function saveConnectionDraft(): boolean {
  const profileEndpoint = connectionDraftEndpoint.value.trim();
  if (!connectionDraftName.value.trim()) {
    connectionDraftError.value = "请输入提供商名称";
    return false;
  }
  if (!profileEndpoint) {
    connectionDraftError.value = "请输入 API 地址";
    return false;
  }
  const profileApiKey = connectionDraftApiKey.value.trim();
  if (!providerDraftIsNew.value) {
    const current = connectionProfiles.value.find((item) => item.id === connectionDraftId.value);
    if (!current) return false;
    const updated: ConnectionProfile = {
      ...current,
      name: connectionDraftName.value.trim(),
      endpoint: profileEndpoint,
      apiKey: profileApiKey,
    };
    connectionProfiles.value = connectionProfiles.value.map(
        (profile) => profile.id === updated.id ? updated : profile
    );
    if (activeConnectionId.value === updated.id) selectConnection(updated);
    resetConnectionDraft(updated);
  } else {
    const profile: ConnectionProfile = {
      id: connectionDraftId.value,
      name: connectionDraftName.value.trim(),
      endpoint: profileEndpoint,
      apiKey: profileApiKey,
      models: [],
    };
    connectionProfiles.value = [...connectionProfiles.value, profile];
    selectConnection(profile);
    resetConnectionDraft(profile);
  }
  ensureModelSelections();
  return true;
}

function openModelModal(providerId: string, providerModel?: ProviderModel) {
  modelDraftProviderId.value = providerId;
  modelDraftOriginalId.value = providerModel?.id ?? "";
  modelDraftId.value = providerModel?.id ?? "";
  modelDraftDisplayName.value = providerModel?.displayName ?? "";
  modelDraftDescription.value = providerModel?.description ?? "";
  modelDraftIsImage.value = providerModel?.isImage ?? false;
  modelDraftContextLength.value = providerModel?.contextLength ?? 256000;
  modelDraftError.value = "";
  modelModalOpen.value = true;
}

function closeModelModal() {
  modelModalOpen.value = false;
  modelDraftProviderId.value = "";
  modelDraftOriginalId.value = "";
  modelDraftId.value = "";
  modelDraftDisplayName.value = "";
  modelDraftDescription.value = "";
  modelDraftIsImage.value = false;
  modelDraftContextLength.value = 256000;
  modelDraftError.value = "";
}

function saveModelDraft() {
  const provider = connectionProfiles.value.find((item) => item.id === modelDraftProviderId.value);
  const id = modelDraftId.value.trim();
  const contextLengthValue = Number(modelDraftContextLength.value);
  if (!provider) return;
  if (!id) {
    modelDraftError.value = "请输入模型 ID";
    return;
  }
  if (provider.models.some((item) => item.id === id && item.id !== modelDraftOriginalId.value)) {
    modelDraftError.value = "该提供商中已存在相同模型 ID";
    return;
  }
  if (!Number.isInteger(contextLengthValue) || contextLengthValue < 1) {
    modelDraftError.value = "上下文长度必须是大于 0 的整数";
    return;
  }
  const providerModel: ProviderModel = {
    id,
    displayName: modelDraftDisplayName.value.trim(),
    description: modelDraftDescription.value.trim(),
    isImage: modelDraftIsImage.value,
    contextLength: contextLengthValue,
  };
  const previousId = modelDraftOriginalId.value;
  const models = previousId
      ? provider.models.map((item) => item.id === previousId ? providerModel : item)
      : [...provider.models, providerModel];
  connectionProfiles.value = connectionProfiles.value.map(
      (item) => item.id === provider.id ? {...item, models} : item
  );
  if (previousId && previousId !== id) {
    const oldSelection = modelSelectionKey(provider.id, previousId);
    const newSelection = modelSelectionKey(provider.id, id);
    if (imageModelSelection.value === oldSelection) imageModelSelection.value = newSelection;
    if (chatModelSelection.value === oldSelection) chatModelSelection.value = newSelection;
    if (titleModelSelection.value === oldSelection) titleModelSelection.value = newSelection;
    for (const node of canvasNodes.value) {
      if (node.data.connectionId === provider.id && node.data.model === previousId) {
        updateCanvasNodeData(node.id, {model: id});
      }
    }
  }
  ensureModelSelections();
  for (const node of canvasNodes.value) {
    if (node.data.connectionId !== provider.id || node.data.model !== id) continue;
    const matchesNodeType = node.type === "image" ? providerModel.isImage : !providerModel.isImage;
    if (matchesNodeType) continue;
    const fallback = resolveModelSelection(firstModelSelection(node.type === "image"));
    if (fallback) {
      updateCanvasNodeData(node.id, {
        connectionId: fallback.provider.id,
        model: fallback.model.id,
      });
    }
  }
  closeModelModal();
}

function removeProviderModel(providerId: string, modelId: string) {
  const provider = connectionProfiles.value.find((item) => item.id === providerId);
  if (!provider) return;
  connectionProfiles.value = connectionProfiles.value.map((item) =>
    item.id === providerId
        ? {...item, models: item.models.filter((providerModel) => providerModel.id !== modelId)}
        : item
  );
  ensureModelSelections();
  for (const node of canvasNodes.value) {
    if (node.data.connectionId !== providerId || node.data.model !== modelId) continue;
    const fallback = node.type === "image"
        ? resolveModelSelection(firstModelSelection(true))
        : resolveModelSelection(firstModelSelection(false));
    if (fallback) {
      updateCanvasNodeData(node.id, {
        connectionId: fallback.provider.id,
        model: fallback.model.id,
      });
    }
  }
}

function removeConnection(profile: ConnectionProfile) {
  if (connectionProfiles.value.length <= 1) return;
  const remaining = connectionProfiles.value.filter((item) => item.id !== profile.id);
  connectionProfiles.value = remaining;
  if (activeConnectionId.value === profile.id || selectedProviderId.value === profile.id) {
    selectConnection(remaining[0]);
    resetConnectionDraft(remaining[0]);
  }
  for (const node of canvasNodes.value) {
    if (node.data.connectionId !== profile.id) continue;
    const fallback = node.type === "image"
        ? resolveModelSelection(firstModelSelection(true))
        : resolveModelSelection(firstModelSelection(false));
    updateCanvasNodeData(node.id, {
      connectionId: fallback?.provider.id ?? remaining[0].id,
      model: fallback?.model.id ?? remaining[0].models[0]?.id ?? "",
    });
  }
  ensureModelSelections();
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
      const fallbackConnectionModels = [...new Set([
        ...(Array.isArray(s.modelOptions) ? s.modelOptions : []),
        ...(Array.isArray(s.textModelOptions) ? s.textModelOptions : []),
        ...(typeof s.model === "string" ? [s.model] : []),
        ...(typeof s.textModel === "string" ? [s.textModel] : []),
      ].filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
      const restoredProfiles = normalizeConnectionProfiles(
          s.connectionProfiles,
          fallbackConnectionModels
      );
      if (restoredProfiles.length === 0) {
        restoredProfiles.push({
          id: savedEndpoint === DEFAULT_ENDPOINT && !savedApiKey ? DEFAULT_CONNECTION_ID : createConnectionId(),
          name: providerNameFromEndpoint(savedEndpoint, 1),
          endpoint: savedEndpoint,
          apiKey: savedApiKey,
          models: normalizeProviderModels(fallbackConnectionModels),
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
      themeMode.value = normalizeThemeMode(s.themeMode);
      size.value = typeof s.size === "string" && [
        "auto",
        "1024x1024",
        "1536x1024",
        "1024x1536",
        "custom",
      ].includes(s.size) ? s.size : "auto";
      customWidth.value = Number.isInteger(s.customWidth) && s.customWidth > 0 ? s.customWidth : 1024;
      customHeight.value = Number.isInteger(s.customHeight) && s.customHeight > 0 ? s.customHeight : 1024;
      count.value = Number.isInteger(s.count) && s.count >= 1 && s.count <= 10 ? s.count : 1;
      textModel.value = typeof s.textModel === "string" && s.textModel.trim() ? s.textModel.trim() : textModel.value;
      textModelOptions.value = normalizeTextModelOptions(s.textModelOptions);
      if (textModel.value && !textModelOptions.value.includes(textModel.value)) {
        textModelOptions.value = [...textModelOptions.value, textModel.value];
      }
      selectedProviderId.value = typeof s.selectedProviderId === "string"
          ? s.selectedProviderId
          : activeProfile.id;
      imageModelSelection.value = typeof s.imageModelSelection === "string"
          ? s.imageModelSelection
          : modelSelectionKey(activeProfile.id, model.value);
      chatModelSelection.value = typeof s.chatModelSelection === "string"
          ? s.chatModelSelection
          : modelSelectionKey(activeProfile.id, textModel.value);
      titleModelSelection.value = typeof s.titleModelSelection === "string"
          ? s.titleModelSelection
          : "current";
      ensureModelSelections();
    } catch {
    }
  }
  ensureModelSelections();
  const initialProvider = connectionProfiles.value.find((item) => item.id === selectedProviderId.value)
      ?? connectionProfiles.value[0];
  if (initialProvider) resetConnectionDraft(initialProvider);
  window.addEventListener("paste", onPaste);
  window.addEventListener("blur", closeResultContextMenu);
  window.addEventListener("resize", closeResultContextMenu);
  window.addEventListener("scroll", closeResultContextMenu, true);
  window.addEventListener("beforeunload", warnAboutUnsavedProviderChanges);
  systemDarkQuery.addEventListener("change", applyTheme);
  document.addEventListener("keydown", closeResultOverlaysOnEscape);
  await restoreResultHistory();
  if (appMode.value === "canvas") seedCanvas();
  if (autoCheckUpdate.value) checkUpdate(false);
});

onUnmounted(() => {
  generationAbortController?.abort();
  chatSession.abort();
  for (const controller of titleGenerationControllers.values()) controller.abort();
  titleGenerationControllers.clear();
  for (const controller of canvasControllers.values()) controller.abort();
  canvasGraph.dispose();
  for (const image of results.value) URL.revokeObjectURL(image.previewUrl);
  if (previewNoticeTimer !== null) window.clearTimeout(previewNoticeTimer);
  if (chatCopyNoticeTimer !== null) window.clearTimeout(chatCopyNoticeTimer);
  window.removeEventListener("paste", onPaste);
  window.removeEventListener("blur", closeResultContextMenu);
  window.removeEventListener("resize", closeResultContextMenu);
  window.removeEventListener("scroll", closeResultContextMenu, true);
  document.removeEventListener("keydown", closeResultOverlaysOnEscape);
  window.removeEventListener("beforeunload", warnAboutUnsavedProviderChanges);
  systemDarkQuery.removeEventListener("change", applyTheme);
  removeProviderRouteGuard();
});

watch(
    [
      endpoint,
      apiKey,
      connectionProfiles,
      activeConnectionId,
      selectedProviderId,
      model,
      modelOptions,
      apiMode,
      retryEnabled,
      retryStatusCodes,
      retryStatusCodeOptions,
      retryCount,
      autoCheckUpdate,
      themeMode,
      size,
      customWidth,
      customHeight,
      count,
      textModel,
      textModelOptions,
      imageModelSelection,
      chatModelSelection,
      titleModelSelection,
    ],
    () => {
      localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({
            endpoint: endpoint.value,
            apiKey: apiKey.value,
            connectionProfiles: connectionProfiles.value,
            activeConnectionId: activeConnectionId.value,
            selectedProviderId: connectionProfiles.value.some(
                (profile) => profile.id === selectedProviderId.value
            ) ? selectedProviderId.value : providerDraftPreviousId.value,
            model: model.value,
            modelOptions: modelOptions.value,
            apiMode: apiMode.value,
            retryEnabled: retryEnabled.value,
            retryStatusCodes: retryStatusCodes.value,
            retryStatusCodeOptions: retryStatusCodeOptions.value,
            retryCount: retryCount.value,
            autoCheckUpdate: autoCheckUpdate.value,
            themeMode: themeMode.value,
            size: size.value,
            customWidth: customWidth.value,
            customHeight: customHeight.value,
            count: count.value,
            textModel: textModel.value,
            textModelOptions: textModelOptions.value,
            imageModelSelection: imageModelSelection.value,
            chatModelSelection: chatModelSelection.value,
            titleModelSelection: titleModelSelection.value,
          })
      );
    }
);

watch(themeMode, applyTheme);

watch(imageModelSelection, (selection) => {
  const resolved = resolveModelSelection(selection);
  if (resolved?.model.isImage) model.value = resolved.model.id;
});

watch(chatModelSelection, (selection) => {
  const resolved = resolveModelSelection(selection);
  if (resolved && !resolved.model.isImage) textModel.value = resolved.model.id;
});

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

function resolvedGenerationSize(): string | null {
  if (size.value === "auto") return null;
  if (size.value !== "custom") return size.value;
  const width = Number(customWidth.value);
  const height = Number(customHeight.value);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("自定义尺寸的宽度和高度必须是大于 0 的整数");
  }
  return `${width}x${height}`;
}

async function generate() {
  if (loading.value) return;
  const selectedModel = resolveModelSelection(imageModelSelection.value);
  if (!selectedModel || !selectedModel.model.isImage) {
    error.value = "请先选择一个生图模型";
    return;
  }
  const generationPrompt = prompt.value;
  if (!generationPrompt.trim()) {
    error.value = "请输入提示词";
    return;
  }
  let requestSize: string | null;
  try {
    requestSize = resolvedGenerationSize();
  } catch (sizeError: unknown) {
    error.value = errorMessage(sizeError);
    return;
  }
  const requestCount = Math.max(1, Math.min(10, Math.trunc(Number(count.value) || 1)));
  const generationId = ++generationSequence;
  const abortController = new AbortController();
  const generatedResultIds = new Set<string>();
  generationAbortController = abortController;
  activeGenerationId = generationId;
  loading.value = true;
  stopping.value = false;
  error.value = "";

  // 允许填裸域名(如 https://ai.example.cn),没有版本路径时自动补 /v1
  const selectedConnection = new OpenAIConnection(
      selectedModel.provider.endpoint,
      selectedModel.provider.apiKey
  );
  const base = selectedConnection.baseUrl;
  const headers = selectedConnection.authHeaders;

  try {
    const retryConfig = getRetryConfig();
    const useChat =
        apiMode.value === "chat" || (apiMode.value === "auto" && refImages.value.length > 1);
    log(
        "INFO",
        `任务=#${generationId} 开始生成: 端点=${sanitizeUrlForLog(base)} 模型=${selectedModel.model.id} 模式=${useChat ? "chat" : "images"} 参考图=${refImages.value.length} 数量=${requestCount} 尺寸=${requestSize ?? "auto"} 重试=${retryConfig ? `[${[...retryConfig.statusCodes].join(",")}],最多${retryConfig.maxRetries}次` : "关闭"}`
    );
    if (useChat) {
      await generateViaChat(
          base,
          headers,
          retryConfig,
          generationId,
          abortController.signal,
          generatedResultIds,
          generationPrompt,
          selectedModel.model.id,
          requestSize,
          requestCount
      );
    } else {
      await generateViaImages(
          base,
          headers,
          retryConfig,
          generationId,
          abortController.signal,
          generatedResultIds,
          generationPrompt,
          selectedModel.model.id,
          requestSize,
          requestCount
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
    generationPrompt: string,
    modelName: string,
    requestSize: string | null,
    requestCount: number
) {
  throwIfGenerationAborted(signal);
  let resp: Response;
  if (refImages.value.length > 0) {
    const form = new FormData();
    form.append("model", modelName);
    form.append("prompt", generationPrompt);
    form.append("n", String(requestCount));
    if (requestSize) form.append("size", requestSize);
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
            model: modelName,
            prompt: generationPrompt,
            n: requestCount,
            ...(requestSize ? {size: requestSize} : {}),
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
    generationPrompt: string,
    modelName: string,
    requestSize: string | null,
    requestCount: number
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
          model: modelName,
          messages: [{role: "user", content}],
          n: requestCount,
          ...(requestSize ? {size: requestSize} : {}),
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
  const selectedModel = resolveModelSelection(chatModelSelection.value);
  if (!selectedModel || selectedModel.model.isImage) {
    chatError.value = "请先选择一个文字模型";
    return;
  }
  const taskId = ++generationSequence;
  await chatSession.send({
    modelLabel: resolvedModelLabel(selectedModel),
    request: ({messages, signal}) => requestTextCompletion(
        messages.map((message) => ({role: message.role, content: message.content})),
        signal,
        taskId,
        selectedModel.model.id,
        new OpenAIConnection(selectedModel.provider.endpoint, selectedModel.provider.apiKey)
    ),
    onStart: (messageCount) => log(
        "INFO",
        `任务=#${taskId} 开始文字聊天: 模型=${selectedModel.model.id} 消息数=${messageCount}`
    ),
    onSuccess: () => log("INFO", `任务=#${taskId} 文字聊天完成`),
    onStop: () => log("INFO", `任务=#${taskId} 文字聊天已停止`),
    onError: (chatRequestError) => {
      chatError.value = errorMessage(chatRequestError);
      log("ERROR", `任务=#${taskId} 文字聊天失败: ${formatErrorDetails(chatRequestError)}`);
    },
    onFirstExchange: (conversationId, messages) => {
      void generateConversationTitle(conversationId, messages, selectedModel);
    },
  });
}

async function generateConversationTitle(
    conversationId: string,
    messages: Array<{role: "user" | "assistant"; content: string}>,
    currentModel: ResolvedModel
) {
  if (titleModelSelection.value === "none") {
    chatSession.markTitleHandled(conversationId);
    return;
  }
  const titleModel = titleModelSelection.value === "current"
      ? currentModel
      : resolveModelSelection(titleModelSelection.value);
  if (!titleModel || titleModel.model.isImage) {
    chatSession.markTitleHandled(conversationId);
    return;
  }
  const controller = new AbortController();
  titleGenerationControllers.set(conversationId, controller);
  const taskId = ++generationSequence;
  const transcript = messages
      .slice(0, 2)
      .map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`)
      .join("\n\n");
  try {
    const title = await requestTextCompletion(
        [
          {
            role: "system",
            content: "根据第一轮对话生成一个简短中文标题。只返回标题，不要引号、标点说明或其他内容，最多 20 个汉字。",
          },
          {role: "user", content: transcript},
        ],
        controller.signal,
        taskId,
        titleModel.model.id,
        new OpenAIConnection(titleModel.provider.endpoint, titleModel.provider.apiKey)
    );
    chatSession.setGeneratedTitle(
        conversationId,
        title.replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").split("\n", 1)[0].slice(0, 40)
    );
    log("INFO", `任务=#${taskId} 对话标题生成完成: 模型=${titleModel.model.id}`);
  } catch (titleError: unknown) {
    if (!controller.signal.aborted) {
      log("ERROR", `任务=#${taskId} 对话标题生成失败: ${formatErrorDetails(titleError)}`);
    }
  } finally {
    titleGenerationControllers.delete(conversationId);
  }
}

function stopChat() {
  chatSession.stop();
}

function clearChat() {
  chatSession.clear();
}

function createChatConversation() {
  if (!chatLoading.value) chatSession.createConversation();
}

function selectChatConversation(id: string) {
  chatSession.selectConversation(id);
}

function renameChatConversation(id: string, title: string) {
  chatSession.renameConversation(id, title);
}

function deleteChatConversation(id: string) {
  titleGenerationControllers.get(id)?.abort();
  titleGenerationControllers.delete(id);
  chatSession.deleteConversation(id);
}

async function copyChatMessage(messageId: string, content: string) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(content);
    copied = true;
  } catch {
    try {
      copied = copyTextFallback(content);
    } catch {
    }
  }
  if (!copied) {
    chatError.value = "复制消息失败，请检查系统剪贴板权限";
    return;
  }
  chatCopiedMessageId.value = messageId;
  if (chatCopyNoticeTimer !== null) window.clearTimeout(chatCopyNoticeTimer);
  chatCopyNoticeTimer = window.setTimeout(() => {
    chatCopiedMessageId.value = "";
    chatCopyNoticeTimer = null;
  }, 1600);
}

const appBusy = computed(() => loading.value || chatLoading.value || canvasBusyCount.value > 0);

async function setAppMode(mode: WorkspaceMode) {
  if (appBusy.value) return;
  closeResultContextMenu();
  closeResultLightbox();
  if (mode === "canvas") seedCanvas();
  await workspaceRouter.push({name: mode === "settings" ? "settings-models" : mode});
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
  const preferredSelection = type === "text" ? chatModelSelection.value : imageModelSelection.value;
  const resolved = resolveModelSelection(preferredSelection)
      ?? resolveModelSelection(firstModelSelection(type === "image"));
  return {
    connectionId: resolved?.provider.id ?? "",
    model: resolved?.model.id ?? "",
  };
}

function canvasNodeModelSelection(nodeData: CanvasNodeData): string {
  return modelSelectionKey(nodeData.connectionId, nodeData.model);
}

function onCanvasNodeModelChange(nodeId: string, valueOrEvent: string | Event) {
  const selection = typeof valueOrEvent === "string"
      ? valueOrEvent
      : (valueOrEvent.target as HTMLSelectElement).value;
  const resolved = resolveModelSelection(selection);
  if (!resolved) return;
  updateCanvasNodeData(nodeId, {
    connectionId: resolved.provider.id,
    model: resolved.model.id,
    error: "",
  });
}

function connectionForCanvasNode(node: CanvasNode): OpenAIConnection {
  const profile = connectionProfiles.value.find((item) => item.id === node.data.connectionId);
  if (!profile) throw new Error("节点选择的 API 连接不存在，请重新选择");
  if (!profile.models.some((item) => item.id === node.data.model)) {
    throw new Error("节点选择的模型不存在，请重新选择");
  }
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
  const requestSize = resolvedGenerationSize();
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
          body: JSON.stringify({
            model: node.data.model,
            messages: [{role: "user", content}],
            n: amount,
            ...(requestSize ? {size: requestSize} : {}),
          }),
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
    if (requestSize) form.append("size", requestSize);
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
            ...(requestSize ? {size: requestSize} : {}),
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
  appBusy,
  endpoint,
  apiKey,
  connectionProfiles,
  providerList,
  selectedProviderId,
  selectedProvider,
  connectionDraftId,
  connectionDraftName,
  connectionDraftEndpoint,
  connectionDraftApiKey,
  connectionDraftError,
  providerDraftIsNew,
  hasUnsavedProviderChanges,
  unsavedChangesModalOpen,
  modelModalOpen,
  modelDraftProviderId,
  modelDraftOriginalId,
  modelDraftId,
  modelDraftDisplayName,
  modelDraftDescription,
  modelDraftIsImage,
  modelDraftContextLength,
  modelDraftError,
  imageModelSelection,
  chatModelSelection,
  titleModelSelection,
  imageModelGroups,
  textModelGroups,
  imageModelSelectOptions,
  textModelSelectOptions,
  titleModelSelectOptions,
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
  themeMode,
  size,
  customWidth,
  customHeight,
  count,
  checkingUpdate,
  updateStatus,
  updateUrl,
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
  chatConversations,
  activeChatConversationId,
  activeChatConversation,
  chatDraft,
  chatLoading,
  chatStopping,
  chatError,
  chatCopiedMessageId,
  canvasNodes,
  canvasEdges,
  DEFAULT_MODEL_OPTIONS,
  DEFAULT_RETRY_STATUS_CODE_OPTIONS,
  setAppMode,
  maskApiKey,
  modelSelectionKey,
  modelDisplayName,
  selectProvider,
  addProviderDraft,
  cancelConnectionDraft,
  saveConnectionDraft,
  resolveUnsavedChanges,
  removeConnection,
  openModelModal,
  closeModelModal,
  saveModelDraft,
  removeProviderModel,
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
  createChatConversation,
  selectChatConversation,
  renameChatConversation,
  deleteChatConversation,
  copyChatMessage,
  addCanvasTextNode,
  addCanvasImageNode,
  updateCanvasNodeData,
  onCanvasConnect,
  onCanvasNodesUpdate,
  onCanvasEdgesUpdate,
  deleteCanvasNode,
  canvasNodeModelSelection,
  onCanvasNodeModelChange,
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
        <a-button
            type="text"
            class="nav-rail-button"
            :class="{ active: appMode === 'image' }"
            :disabled="appBusy"
            title="生图"
            @click="setAppMode('image')"
        >
          <IconImage aria-hidden="true"/>
          <span>生图</span>
        </a-button>
        <a-button
            type="text"
            class="nav-rail-button"
            :class="{ active: appMode === 'chat' }"
            :disabled="appBusy"
            title="聊天"
            @click="setAppMode('chat')"
        >
          <IconMessage aria-hidden="true"/>
          <span>聊天</span>
        </a-button>
        <a-button
            type="text"
            class="nav-rail-button"
            :class="{ active: appMode === 'canvas' }"
            :disabled="appBusy"
            title="无尽画布"
            @click="setAppMode('canvas')"
        >
          <IconMindMapping aria-hidden="true"/>
          <span>无尽画布</span>
        </a-button>
      </nav>
      <a-button
          type="text"
          class="nav-rail-button settings-button"
          :class="{ active: appMode === 'settings' }"
          :disabled="appBusy"
          title="设置"
          @click="setAppMode('settings')"
      >
        <IconSettings aria-hidden="true"/>
        <span>设置</span>
      </a-button>
    </aside>

    <a-scrollbar outer-class="content" class="content-scroll-container" :disable-horizontal="true">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :app="viewModel"/>
      </RouterView>
    </a-scrollbar>

    <ModelModal :app="viewModel"/>
    <UnsavedChangesModal :app="viewModel"/>
    <ResultOverlays :app="viewModel"/>
  </main>
</template>

<style>
:root {
  font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  color: var(--color-text-1);
  background-color: var(--color-bg-1);
  --app-shadow-soft: color-mix(in srgb, var(--color-black) 24%, transparent);
  --app-shadow: color-mix(in srgb, var(--color-black) 42%, transparent);
  --app-shadow-strong: color-mix(in srgb, var(--color-black) 64%, transparent);
  --app-scrim: color-mix(in srgb, var(--color-black) 72%, transparent);
  --app-scrim-strong: color-mix(in srgb, var(--color-black) 88%, transparent);
}

html,
body,
#app {
  height: 100%;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  overflow: hidden;
  color: var(--color-text-1);
  background: var(--color-bg-1);
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
  background: var(--color-bg-2);
  border-right: 1px solid var(--color-border);
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
  color: var(--color-text-3);
  font: inherit;
  cursor: pointer;
}

.nav-rail-button svg {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
}

.nav-rail-button .arco-btn-content > span {
  width: 100%;
  overflow: hidden;
  font-size: 10px;
  line-height: 1.2;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-rail-button:hover:not(:disabled) {
  background: var(--color-fill-2);
  color: var(--color-text-1);
}

.nav-rail-button.active {
  background: rgb(var(--primary-6));
  color: var(--color-white);
}

.nav-rail-button:disabled {
  opacity: 0.55;
  cursor: default;
}

.settings-button {
  margin-top: auto;
}

label:not(.arco-checkbox):not(.arco-radio) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--color-text-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field > label {
  font-size: 13px;
  color: var(--color-text-3);
}

.field-label {
  color: var(--color-text-3);
  font-size: 13px;
  line-height: 1.5;
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
  color: var(--color-text-1);
  background: var(--color-bg-3);
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
}

.combo-control:focus-within,
.combo-control.open {
  border-color: rgb(var(--primary-6));
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
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: var(--color-text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.connection-control:hover,
.connection-control:focus-visible,
.connection-control.open {
  border-color: rgb(var(--primary-6));
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
  color: var(--color-text-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-key {
  overflow: hidden;
  color: var(--color-text-4);
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
  color: var(--color-text-3);
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

.combo-control > .arco-input-wrapper {
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 6px 0 0 6px;
  background: transparent;
}

.combo-control > .arco-input-wrapper:focus-within,
.combo-values > .arco-input-wrapper:focus-within {
  border-color: transparent;
  box-shadow: none;
}

.combo-toggle {
  width: 32px;
  flex: 0 0 32px;
  padding: 0;
  border: 0;
  border-radius: 0 6px 6px 0;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
}

.combo-toggle:hover:not(:disabled) {
  color: var(--color-text-1);
  background: var(--color-fill-2);
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
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  box-shadow: 0 8px 24px var(--app-shadow);
}

.nav-rail-button .arco-btn-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.combo-menu-container {
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
}

.combo-option-row {
  display: flex;
  align-items: center;
  min-width: 0;
  border-radius: 4px;
}

.combo-option-row:hover,
.combo-option-row.selected {
  background: var(--color-fill-3);
}

.combo-option-main,
.combo-add {
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-1);
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
  color: rgb(var(--primary-6));
}

.combo-remove-option {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-4);
  font: inherit;
  cursor: pointer;
}

.combo-remove-option:hover {
  background: var(--color-danger-light-1);
  color: rgb(var(--danger-6));
}

.combo-edit-option {
  min-width: 42px;
  height: 28px;
  flex: 0 0 42px;
  padding: 0 5px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.combo-edit-option:hover {
  background: var(--color-border-2);
  color: var(--color-text-1);
}

.combo-add {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  border-top: 1px solid var(--color-border-2);
  color: rgb(var(--primary-6));
  text-align: left;
}

.combo-add:hover {
  background: var(--color-fill-3);
}

.combo-add .arco-btn-content {
  display: flex;
  align-items: center;
  gap: 6px;
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

.combo-values > .arco-input-wrapper {
  flex: 1 0 78px;
  width: 78px;
  min-width: 0;
  height: 26px;
  padding: 3px 4px;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.status-code-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 5px 0 7px;
  border: 1px solid var(--color-border-3);
  border-radius: 4px;
  background: var(--color-border-2);
  color: var(--color-text-1);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.status-code-chip:hover:not(:disabled) {
  border-color: var(--color-text-4);
  background: var(--color-border-3);
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
  color: var(--color-text-1);
  cursor: pointer;
}

.combo-empty {
  margin: 0;
  padding: 7px 8px;
  color: var(--color-text-4);
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
  background: var(--app-scrim);
}

.connection-backdrop {
  z-index: 110;
}

.model-backdrop {
  z-index: 115;
}

.settings-page {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
}

.settings-page-toolbar {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 10px;
}

.settings-layout {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: 156px minmax(0, 1fr);
  gap: 16px;
}

.settings-subnav {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  padding-right: 12px;
  border-right: 1px solid var(--color-border);
}

.settings-subnav-link {
  display: flex;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 6px;
  color: var(--color-text-3);
  text-decoration: none;
}

.settings-subnav-link svg {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
}

.settings-subnav-link span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-subnav-link:hover {
  background: var(--color-fill-2);
  color: var(--color-text-1);
}

.settings-subnav-link.router-link-active {
  background: var(--color-primary-light-1);
  color: rgb(var(--primary-6));
}

.settings-subpage {
  min-width: 0;
  min-height: 0;
}

.settings-subpage-container {
  height: 100%;
  overflow-y: auto;
  padding-right: 2px;
}

.settings-section {
  width: min(760px, 100%);
}

.settings-section h2 {
  margin: 0 0 14px;
  color: var(--color-text-1);
  font-size: 15px;
  letter-spacing: 0;
}

.settings-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
}

.settings-form-grid h3 {
  grid-column: 1 / -1;
  margin: 6px 0 0;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-3);
  font-size: 12px;
  letter-spacing: 0;
}

.settings-form-wide {
  grid-column: 1 / -1;
}

.theme-mode-control {
  align-self: flex-start;
  max-width: 100%;
}

.settings-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.settings-section-heading h2 {
  margin: 0;
}

.settings-log-section {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.log-panel.settings-log-panel {
  flex: 1;
  min-height: 240px;
  max-height: none;
}

.log-panel.settings-log-panel .log-body {
  flex: 1;
  min-height: 0;
}

.log-path.settings-log-path {
  padding: 0 0 8px;
}

.provider-settings-section {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.provider-settings-layout {
  display: grid;
  height: calc(100% - 34px);
  min-height: 0;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 14px;
}

.provider-sidebar {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  padding-right: 12px;
  border-right: 1px solid var(--color-border);
}

.provider-list {
  min-height: 0;
  flex: 1;
}

.provider-list-container {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
}

.provider-list-item {
  display: flex;
  min-width: 0;
  min-height: 46px;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.provider-list-item .arco-btn-content > span,
.provider-list-item .arco-btn-content > small {
  overflow: hidden;
  width: 100%;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-list-item .arco-btn-content > small {
  color: var(--color-text-4);
  font-size: 11px;
}

.provider-list-item:hover {
  background: var(--color-fill-2);
}

.provider-list-item.active {
  background: var(--color-primary-light-1);
  color: rgb(var(--primary-6));
}

.provider-add-button {
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: rgb(var(--primary-6));
  font: inherit;
  cursor: pointer;
}

.provider-detail {
  min-width: 0;
  min-height: 0;
}

.provider-list-item .arco-btn-content {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.provider-detail-container {
  height: 100%;
  overflow-y: auto;
}

.provider-editor {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}

.provider-detail-header,
.provider-model-toolbar,
.provider-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.provider-detail-header h3 {
  margin: 0;
  color: var(--color-text-1);
  font-size: 14px;
}

.provider-editor-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.provider-editor-fields label:last-child {
  grid-column: 1 / -1;
}

.provider-editor-fields .arco-input-wrapper,
.provider-editor-fields .arco-input-password {
  width: 100%;
  min-width: 0;
}

.provider-editor-error {
  margin: 8px 0 0;
  color: rgb(var(--danger-6));
  font-size: 12px;
}

.provider-model-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.danger-action {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid rgb(var(--danger-6));
  border-radius: 6px;
  background: var(--color-danger-light-1);
  color: rgb(var(--danger-6));
  font: inherit;
  cursor: pointer;
}

.danger-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.provider-model-toolbar {
  margin-top: 18px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.provider-model-list {
  display: flex;
  flex-direction: column;
}

.provider-model-row {
  align-items: flex-start;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}

.provider-model-main {
  min-width: 0;
}

.provider-model-main > strong,
.provider-model-main > code {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-model-main > code {
  margin-top: 3px;
  color: var(--color-text-3);
  font-size: 11px;
}

.provider-model-main > p {
  margin: 7px 0 0;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.provider-model-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 7px;
  color: var(--color-text-4);
  font-size: 11px;
}

.provider-model-empty {
  padding: 28px 0;
  color: var(--color-text-4);
  text-align: center;
}

.provider-draft-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
  padding: 14px 0 2px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-1);
}

.provider-draft-actions button {
  min-height: 34px;
  padding: 6px 14px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.connection-modal {
  width: min(400px, 100%);
  max-height: calc(100vh - 32px);
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
  background: var(--color-bg-2);
  box-shadow: 0 16px 48px var(--app-shadow);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-header h2 {
  margin: 0;
  color: var(--color-text-1);
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
  color: var(--color-text-3);
  font: inherit;
  font-size: 18px;
  cursor: pointer;
}

.modal-header button:hover {
  background: var(--color-fill-2);
  color: var(--color-text-1);
}

.connection-modal .arco-input-wrapper,
.connection-modal .arco-input-number,
.connection-modal .arco-textarea-wrapper {
  width: 100%;
}

.modal-error {
  margin: -4px 0 0;
  color: rgb(var(--danger-6));
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
  border: 1px solid var(--color-border-2);
  background: var(--color-bg-3);
  color: var(--color-text-2);
}

.modal-save {
  border: 1px solid rgb(var(--primary-6));
  background: rgb(var(--primary-6));
  color: var(--color-white);
}

.modal-cancel:hover {
  border-color: var(--color-text-4);
}

.modal-save:hover {
  background: rgb(var(--primary-6));
}

.modal-discard {
  border: 1px solid rgb(var(--danger-6));
  background: var(--color-danger-light-1);
  color: rgb(var(--danger-6));
}

.modal-discard:hover {
  background: var(--color-danger-light-2);
}

.unsaved-changes-backdrop {
  z-index: 130;
}

.unsaved-changes-modal {
  width: min(420px, 100%);
  padding: 16px;
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
  background: var(--color-bg-2);
  box-shadow: 0 16px 48px var(--app-shadow);
}

.connection-modal-container {
  max-height: calc(100vh - 34px);
  overflow-y: auto;
}

.connection-modal form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.unsaved-changes-modal > p {
  margin: 12px 0 18px;
  color: var(--color-text-3);
  line-height: 1.5;
}

.unsaved-changes-actions {
  flex-wrap: wrap;
}

.content {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.content-scroll-container {
  display: flex;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding: 16px;
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
  flex: 0 0 72px;
}

.ref-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--color-border-2);
}

.ref-thumb .remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgb(var(--danger-6));
  color: var(--color-white);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.add-ref {
  width: 72px;
  height: 72px;
  min-width: 72px;
  min-height: 72px;
  flex: 0 0 72px;
  padding: 0;
  border: 1px dashed var(--color-border-3);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 24px;
  cursor: pointer;
}

.add-ref .arco-icon {
  width: 22px;
  height: 22px;
}

.add-ref:hover,
.add-ref.drag-over {
  border-color: rgb(var(--primary-6));
  color: rgb(var(--primary-6));
}

.image-workspace {
  display: flex;
  min-height: 100%;
  flex: 1 0 auto;
  flex-direction: column;
  gap: 10px;
}

.image-primary-options {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 9px 12px;
}

.image-model-option {
  min-width: 220px;
  flex: 1 1 240px;
}

.image-size-option {
  width: 156px;
  flex: 0 0 156px;
}

.image-count-option {
  width: 76px;
  flex: 0 0 76px;
}

.image-size-option .arco-select,
.image-count-option .arco-input-number,
.custom-size-inputs .arco-input-number {
  width: 100%;
  min-width: 0;
}

.custom-size-inputs {
  display: flex;
  min-width: min(190px, 100%);
  flex: 0 0 210px;
  align-items: end;
  gap: 8px;
}

.custom-size-inputs label {
  min-width: 0;
  flex: 1;
}

.custom-size-inputs > span {
  flex: 0 0 auto;
  padding-bottom: 9px;
  color: var(--color-text-4);
}

.image-generate-action {
  min-width: 138px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.model-provider-select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-border-2);
  background: var(--color-bg-3);
  color: var(--color-text-1);
}

.model-provider-select:hover,
.model-provider-select.arco-select-view-focus {
  border-color: rgb(var(--primary-6));
  background: var(--color-bg-3);
}

.model-provider-select .arco-select-view-value,
.model-provider-select .arco-select-view-suffix {
  color: var(--color-text-1);
}

.model-provider-select .arco-select-view-value {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.selected-model-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-provider-select .model-provider-tag.arco-tag {
  max-width: 132px;
  flex: 0 1 auto;
  border: 1px solid rgb(var(--primary-6));
  background: var(--color-primary-light-1);
  color: rgb(var(--primary-6));
}

.model-provider-tag .arco-tag-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arco-select-dropdown {
  border: 1px solid var(--color-border-2);
  background: var(--color-bg-3);
}

.arco-select-dropdown .arco-select-group-title {
  color: var(--color-text-4);
}

.arco-select-dropdown .arco-select-option {
  color: var(--color-text-2);
}

.arco-select-dropdown .arco-select-option:hover,
.arco-select-dropdown .arco-select-option-active {
  background: var(--color-border-2);
}

.arco-select-dropdown .arco-select-option-selected {
  background: var(--color-primary-light-1);
  color: rgb(var(--primary-6));
}

.image-mode-hint {
  color: var(--color-text-4);
  font-size: 12px;
}

.image-prompt-input {
  flex: 0 0 auto;
  min-height: 96px;
}

.image-generation-config {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.advanced-config-toggle {
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  color: var(--color-text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.advanced-config-toggle .chevron.open {
  transform: translateY(2px) rotate(225deg);
}

.image-generation-config-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 9px 12px;
}

.image-retry-toggle {
  min-height: 36px;
  padding-bottom: 8px;
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

.action-model-picker {
  display: flex;
  min-width: min(260px, 100%);
  flex: 1 1 260px;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.action-model-picker .arco-select {
  min-width: 0;
  flex: 1;
}

.advanced-config-toggle .arco-btn-content {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
}

.stop-generation {
  min-width: 88px;
}

.error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--color-danger-light-1);
  border: 1px solid rgb(var(--danger-6));
  color: rgb(var(--danger-6));
  white-space: pre-wrap;
  word-break: break-all;
}

.log-btn {
  font: inherit;
  padding: 8px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: var(--color-text-3);
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

.update-status {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-3);
  word-break: break-all;
}

.update-status a {
  color: rgb(var(--primary-6));
}

.log-btn:hover {
  border-color: rgb(var(--primary-6));
  color: var(--color-text-1);
}

.log-panel {
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
  background: var(--color-bg-2);
  display: flex;
  flex-direction: column;
  max-height: 320px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  color: var(--color-text-3);
}

.log-header button {
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: var(--color-text-1);
  cursor: pointer;
}

.log-header button:hover {
  border-color: rgb(var(--primary-6));
}

.log-path {
  margin: 0;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--color-text-4);
  word-break: break-all;
}

.log-body {
  min-height: 0;
}

.stop-generation .arco-btn-content {
  display: flex;
  align-items: center;
  gap: 7px;
}

.log-body-container {
  height: 100%;
  overflow: auto;
}

.log-body pre {
  margin: 0;
  padding: 8px 12px;
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-2);
  white-space: pre-wrap;
  word-break: break-all;
}

.preview-panel {
  display: flex;
  min-height: 224px;
  flex: 1 1 224px;
  flex-direction: column;
  gap: 6px;
}

.preview-toolbar {
  display: flex;
  min-height: 32px;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  color: var(--color-text-3);
  font-size: 13px;
}

.preview-status {
  color: rgb(var(--primary-6));
}

.preview-notice {
  color: rgb(var(--success-6));
}

.clear-results {
  margin-left: auto;
  padding: 5px 10px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: var(--color-text-2);
  font: inherit;
  cursor: pointer;
}

.clear-results:hover:not(:disabled) {
  border-color: rgb(var(--danger-6));
  color: rgb(var(--danger-6));
}

.clear-results:disabled {
  opacity: 0.45;
  cursor: default;
}

.results {
  display: grid;
  min-width: 100%;
  grid-template-columns: repeat(auto-fill, minmax(148px, 160px));
  gap: 10px;
  padding: 2px 12px 8px 0;
}

.preview-scroll {
  min-height: 186px;
  flex: 1;
}

.preview-scroll-container {
  height: 100%;
  min-height: 186px;
  overflow: auto;
}

.preview-placeholder {
  min-height: 186px;
}

.workspace-toolbar .arco-btn-secondary {
  border-color: var(--color-border-2);
  background: var(--color-bg-3);
  color: var(--color-text-2);
}

.workspace-toolbar .arco-btn-secondary:hover:not(.arco-btn-disabled) {
  border-color: var(--color-text-4);
  color: var(--color-text-1);
}

.workspace-toolbar .arco-btn-secondary.arco-btn-disabled,
.workspace-toolbar .arco-btn-secondary[type="button"].arco-btn-disabled {
  border-color: var(--color-border-2);
  background: var(--color-bg-3);
  color: var(--color-text-4);
  opacity: 0.7;
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
  color: var(--color-text-1);
}

.workspace-meta {
  max-width: min(620px, 70vw);
  overflow: hidden;
  color: var(--color-text-4);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.secondary-action {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: var(--color-text-2);
  font: inherit;
  cursor: pointer;
}

.secondary-action:hover:not(:disabled) {
  border-color: var(--color-text-4);
  color: var(--color-text-1);
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

.chat-layout {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 14px;
}

.chat-conversation-sidebar {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  padding-right: 12px;
  border-right: 1px solid var(--color-border);
}

.new-conversation-button {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid rgb(var(--primary-6));
  border-radius: 6px;
  background: var(--color-primary-light-1);
  color: rgb(var(--primary-6));
  font: inherit;
  cursor: pointer;
}

.conversation-list {
  min-height: 0;
  flex: 1;
}

.new-conversation-button .arco-btn-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conversation-list-container {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
}

.conversation-list-item {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 58px;
  grid-template-columns: minmax(0, 1fr) 48px;
  align-items: center;
  padding: 3px 4px 3px 3px;
  border-radius: 6px;
}

.conversation-list-item:hover,
.conversation-list-item.active {
  background: var(--color-fill-2);
}

.conversation-list-item.active {
  box-shadow: inset 2px 0 rgb(var(--primary-6));
}

.conversation-select {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  color: var(--color-text-2);
  text-align: left;
}

.conversation-select:focus,
.conversation-select:focus-visible {
  box-shadow: none;
}

.conversation-title,
.conversation-count {
  display: block;
  overflow: hidden;
  width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-title {
  color: var(--color-text-1);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.conversation-count {
  color: var(--color-text-4);
  font-size: 11px;
  line-height: 18px;
}

.conversation-item-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  opacity: 0;
  visibility: hidden;
}

.conversation-list-item:hover .conversation-item-actions,
.conversation-list-item.active .conversation-item-actions {
  opacity: 1;
  visibility: visible;
}

.conversation-item-actions button,
.conversation-rename button {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
}

.conversation-item-actions button:hover,
.conversation-rename button:hover {
  background: var(--color-border-3);
  color: var(--color-text-1);
}

.conversation-rename {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px;
  padding: 6px;
}

.conversation-rename .arco-input-wrapper {
  flex: 1;
  width: 100%;
  min-width: 0;
}

.chat-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
}

.chat-messages {
  flex: 1;
  min-height: 240px;
}

.chat-messages-container {
  height: 100%;
  overflow-y: auto;
}

.chat-messages-content {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 14px;
  padding: 10px 2px;
}

.chat-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: var(--color-border-3);
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
  color: var(--color-text-4);
  font-size: 12px;
}

.chat-message-header {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.chat-copy-button {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-4);
  cursor: pointer;
}

.chat-copy-button:hover {
  background: var(--color-fill-2);
  color: var(--color-text-1);
}

.chat-message p,
.chat-thinking {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border-2);
  border-radius: 7px;
  background: var(--color-bg-2);
  color: var(--color-text-1);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-message.user p {
  border-color: rgb(var(--primary-6));
  background: var(--color-primary-light-1);
}

.chat-message-model {
  margin-top: 5px;
  color: var(--color-text-4);
  font-size: 11px;
}

.chat-thinking {
  color: var(--color-text-3);
}

.chat-composer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.chat-composer .arco-textarea-wrapper {
  min-height: 92px;
}

.chat-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.chat-send-button {
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
  border: 1px solid var(--color-border);
  border-radius: 7px;
}

.canvas-flow {
  width: 100%;
  height: 100%;
  background-color: var(--color-bg-1);
  background-image:
      linear-gradient(var(--color-border) 1px, transparent 1px),
      linear-gradient(90deg, var(--color-border) 1px, transparent 1px);
  background-size: 28px 28px;
}

.canvas-flow .vue-flow__node {
  border: 0;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
}

.canvas-flow .vue-flow__node.selected .canvas-node {
  border-color: rgb(var(--primary-6));
  box-shadow: 0 0 0 1px var(--color-primary-light-1);
}

.canvas-flow .vue-flow__edge-path {
  stroke: var(--color-text-2);
  stroke-width: 1.6;
}

.canvas-flow .vue-flow__handle {
  width: 10px;
  height: 10px;
  border: 2px solid var(--color-bg-1);
  background: var(--color-text-3);
}

.canvas-node {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 220px;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--color-border-3);
  border-radius: 8px;
  background: var(--color-bg-3);
  color: var(--color-text-1);
  box-shadow: 0 12px 28px var(--app-shadow-soft);
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

.canvas-node-model-field {
  display: grid;
  min-width: 0;
  grid-template-columns: 66px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  color: var(--color-text-3);
  font-size: 12px;
}

.canvas-node-config .arco-select {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-node-config .model-provider-select {
  min-width: 0;
}

.canvas-node-config .model-provider-tag.arco-tag {
  max-width: 88px;
}

.canvas-node-delete {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 18px;
  cursor: pointer;
}

.canvas-node-delete:hover {
  background: var(--color-danger-light-2);
  color: rgb(var(--danger-6));
}

.canvas-node .arco-textarea-wrapper {
  width: 100%;
  min-height: 78px;
  background: var(--color-bg-2);
}

.canvas-node-actions {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  margin-top: auto;
}

.canvas-node-actions .arco-btn {
  min-height: 30px;
}

.canvas-node-status,
.canvas-node-success {
  margin-right: auto;
  font-size: 12px;
}

.canvas-node-status {
  color: rgb(var(--primary-6));
}

.canvas-node-success {
  color: rgb(var(--success-6));
}

.canvas-node-error {
  margin: 0;
  color: rgb(var(--danger-6));
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
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-1);
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
  background: var(--app-scrim);
  color: var(--color-white);
  cursor: pointer;
}

.canvas-empty-image {
  display: flex;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--color-text-4);
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

.canvas-image-options .arco-input-number {
  width: 66px;
}

.canvas-reference-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-text-3);
  font-size: 12px;
}

.canvas-image-node.readonly {
  min-height: 220px;
}

.result-card {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 6px;
}

.result-card img {
  width: 100%;
  height: 138px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid var(--color-border-2);
  background: var(--color-bg-1);
  cursor: zoom-in;
}

.result-actions {
  display: flex;
  gap: 8px;
}

.result-actions button {
  flex: 1;
  font: inherit;
  padding: 4px 6px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: var(--color-text-1);
  cursor: pointer;
}

.result-actions button:hover {
  border-color: rgb(var(--primary-6));
}

.result-actions .delete-result:hover {
  border-color: rgb(var(--danger-6));
  color: rgb(var(--danger-6));
}

.result-context-menu {
  position: fixed;
  z-index: 100;
  display: flex;
  width: 168px;
  max-width: calc(100vw - 16px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border-3);
  border-radius: 6px;
  background: var(--color-bg-3);
  box-shadow: 0 10px 28px var(--app-shadow);
}

.result-context-menu button {
  min-height: 38px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--color-border-2);
  background: transparent;
  color: var(--color-text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
  justify-content: flex-start;
}

.result-context-menu button:last-child {
  border-bottom: 0;
}

.result-context-menu button:hover:not(:disabled) {
  background: var(--color-border-2);
}

.result-context-menu button:disabled {
  color: var(--color-text-4);
  cursor: default;
}

.result-context-menu .context-delete:hover {
  background: var(--color-danger-light-2);
  color: rgb(var(--danger-6));
}

.result-lightbox {
  position: fixed;
  z-index: 120;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--app-scrim-strong);
  overscroll-behavior: contain;
}

.result-lightbox img {
  display: block;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 16px 48px var(--app-shadow-strong);
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
  border: 1px solid var(--color-border-3);
  border-radius: 6px;
  background: var(--color-bg-3);
  color: var(--color-text-1);
  font: inherit;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.lightbox-close:hover {
  border-color: var(--color-text-3);
  background: var(--color-border-2);
}

.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-border-3);
  border: 1px dashed var(--color-border-2);
  border-radius: 8px;
  min-height: 200px;
}

@media (max-width: 760px) {
  .content-scroll-container {
    padding: 12px;
    gap: 12px;
  }

  .workspace-meta {
    max-width: calc(100vw - 112px);
  }

  .settings-layout {
    grid-template-columns: 128px minmax(0, 1fr);
    gap: 12px;
  }

  .provider-settings-layout {
    grid-template-columns: 140px minmax(0, 1fr);
    gap: 10px;
  }

  .provider-editor-fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .provider-editor-fields label:last-child {
    grid-column: auto;
  }

  .chat-layout {
    grid-template-columns: 160px minmax(0, 1fr);
    gap: 10px;
  }

  .settings-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .image-generation-config-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

@media (max-width: 560px) {
  .image-primary-options {
    align-items: stretch;
  }

  .image-size-option,
  .image-count-option,
  .custom-size-inputs {
    width: 100%;
    flex-basis: 100%;
  }

  .image-generation-config-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .provider-settings-layout,
  .chat-layout {
    grid-template-columns: 124px minmax(0, 1fr);
  }

  .provider-sidebar,
  .chat-conversation-sidebar {
    padding-right: 8px;
  }
}
</style>
