<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { fetch } from "@tauri-apps/plugin-http";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface RefImage {
  file: File;
  previewUrl: string;
}

interface ResultImage {
  base64: string;
  mime: string;
}

const SETTINGS_KEY = "gugle-ai-settings";

const endpoint = ref("https://api.openai.com/v1");
const apiKey = ref("");
const model = ref("gpt-image-2");
// auto: 多参考图自动改走 chat 接口(部分中转的 edits 接口只支持单图)
const apiMode = ref<"auto" | "images" | "chat">("auto");
const size = ref("auto");
const count = ref(1);

const prompt = ref("");
const refImages = ref<RefImage[]>([]);
const results = ref<ResultImage[]>([]);
const loading = ref(false);
const error = ref("");
const fileInput = ref<HTMLInputElement>();
const dragOver = ref(false);

const logs = ref<string[]>([]);
const showLogs = ref(false);
const logFilePath = ref("");

function log(level: "INFO" | "ERROR", msg: string) {
  const line = `[${new Date().toLocaleString()}] [${level}] ${msg}`;
  logs.value.push(line);
  if (logs.value.length > 500) logs.value.splice(0, logs.value.length - 500);
  invoke("append_log", { line }).catch(() => {});
}

async function openLogFile() {
  try {
    logFilePath.value = await invoke<string>("show_log_file");
  } catch (e: any) {
    error.value = `打开日志失败: ${e?.message ?? e}`;
  }
}

const hintText = computed(() => {
  const n = refImages.value.length;
  const useChat = apiMode.value === "chat" || (apiMode.value === "auto" && n > 1);
  const api = useChat ? "Chat 接口" : n > 0 ? "图像编辑接口" : "文生图接口";
  return n > 0 ? `${n} 张参考图 · ${api}` : `无参考图 · ${api}`;
});

onMounted(() => {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    try {
      const s = JSON.parse(saved);
      endpoint.value = s.endpoint ?? endpoint.value;
      apiKey.value = s.apiKey ?? "";
      model.value = s.model ?? model.value;
      apiMode.value = s.apiMode ?? "auto";
    } catch {}
  }
  window.addEventListener("paste", onPaste);
});

onUnmounted(() => {
  window.removeEventListener("paste", onPaste);
});

watch([endpoint, apiKey, model, apiMode], () => {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      endpoint: endpoint.value,
      apiKey: apiKey.value,
      model: model.value,
      apiMode: apiMode.value,
    })
  );
});

function addFile(file: File) {
  if (!file.type.startsWith("image/")) return;
  refImages.value.push({ file, previewUrl: URL.createObjectURL(file) });
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
      if (conn.url && conn.key) {
        endpoint.value = conn.url;
        apiKey.value = conn.key;
        return true;
      }
    } catch {}
  }
  if (/^\[model_providers\.[^\]]+\]/m.test(text)) {
    const m = text.match(/^\[model_providers\.[^\]]+\][^[]*?^\s*base_url\s*=\s*"([^"]+)"/ms);
    if (m) {
      endpoint.value = m[1];
      return true;
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

async function generate() {
  if (!prompt.value.trim()) {
    error.value = "请输入提示词";
    return;
  }
  loading.value = true;
  error.value = "";
  results.value = [];

  // 允许填裸域名(如 https://ai.example.cn),没有版本路径时自动补 /v1
  let base = endpoint.value.trim().replace(/\/+$/, "");
  if (!/\/v\d+(\/|$)/.test(base)) base += "/v1";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey.value}`,
  };

  try {
    const useChat =
      apiMode.value === "chat" || (apiMode.value === "auto" && refImages.value.length > 1);
    log(
      "INFO",
      `开始生成: 端点=${base} 模型=${model.value} 模式=${useChat ? "chat" : "images"} 参考图=${refImages.value.length} 数量=${count.value} 尺寸=${size.value}`
    );
    if (useChat) {
      await generateViaChat(base, headers);
    } else {
      await generateViaImages(base, headers);
    }
    if (results.value.length === 0) {
      throw new Error("响应中没有图片数据");
    }
    log("INFO", `生成成功: ${results.value.length} 张图片`);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    log("ERROR", error.value);
  } finally {
    loading.value = false;
  }
}

// 标准 OpenAI 图像接口: 无参考图走 generations,有参考图走 edits
async function generateViaImages(base: string, headers: Record<string, string>) {
  let resp: Response;
  if (refImages.value.length > 0) {
    const form = new FormData();
    form.append("model", model.value);
    form.append("prompt", prompt.value);
    form.append("n", String(count.value));
    if (size.value !== "auto") form.append("size", size.value);
    for (const img of refImages.value) {
      form.append("image[]", img.file, img.file.name);
    }
    resp = await fetch(`${base}/images/edits`, { method: "POST", headers, body: form });
  } else {
    resp = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.value,
        prompt: prompt.value,
        n: count.value,
        ...(size.value !== "auto" ? { size: size.value } : {}),
      }),
    });
  }

  const data = await parseResponse(resp);
  for (const item of data.data ?? []) {
    if (item.b64_json) {
      results.value.push({ base64: item.b64_json, mime: "image/png" });
    } else if (item.url) {
      await downloadResult(base, item.url);
    }
  }
}

// chat/completions 兼容链路: 参考图作为 image_url 放入消息,
// 生成的图从返回内容里的 data URL 或 http URL 中提取
async function generateViaChat(base: string, headers: Record<string, string>) {
  const content: any[] = [{ type: "text", text: prompt.value }];
  for (const img of refImages.value) {
    const buf = await img.file.arrayBuffer();
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.file.type || "image/png"};base64,${bufToBase64(buf)}` },
    });
  }

  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.value,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await parseResponse(resp);
  for (const choice of data.choices ?? []) {
    const msg = choice.message ?? {};
    // 部分服务把图放在 message.images 数组里
    for (const img of msg.images ?? []) {
      const url = img?.image_url?.url ?? img?.url;
      if (url) await collectChatImage(base, url);
    }
    const text: string = typeof msg.content === "string" ? msg.content : "";
    for (const m of text.matchAll(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
      results.value.push({ base64: m[2], mime: m[1] });
    }
    // 内容里没有内嵌 base64 时,再找 markdown 图片链接
    if (results.value.length === 0) {
      for (const m of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)) {
        await collectChatImage(base, m[1]);
      }
    }
  }
}

async function collectChatImage(base: string, url: string) {
  const dataUrl = url.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (dataUrl) {
    results.value.push({ base64: dataUrl[2], mime: dataUrl[1] });
  } else {
    await downloadResult(base, url);
  }
}

async function downloadResult(base: string, url: string) {
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
    } catch {}
  }
  let lastStatus = 0;
  for (const imgUrl of candidates) {
    log("INFO", `下载图片: ${imgUrl}`);
    const imgResp = await fetch(imgUrl);
    if (imgResp.ok) {
      const buf = await imgResp.arrayBuffer();
      results.value.push({
        base64: bufToBase64(buf),
        mime: imgResp.headers.get("content-type") ?? "image/png",
      });
      return;
    }
    lastStatus = imgResp.status;
    log("ERROR", `下载失败 (${imgResp.status}): ${imgUrl}`);
  }
  throw new Error(`下载图片失败 (${lastStatus}): ${candidates.join(" 或 ")}`);
}

async function parseResponse(resp: Response): Promise<any> {
  const text = await resp.text();
  log("INFO", `响应: ${resp.status} ${resp.url} 长度=${text.length}`);
  if (!resp.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text)?.error?.message ?? text;
    } catch {}
    log("ERROR", `响应体: ${text.slice(0, 500)}`);
    throw new Error(`请求失败 (${resp.status}): ${msg}`);
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
    filters: [{ name: "图片", extensions: [ext] }],
  });
  if (!path) return;
  try {
    await invoke("save_file", { path, base64Data: img.base64 });
  } catch (e: any) {
    error.value = `保存失败: ${e?.message ?? e}`;
  }
}
</script>

<template>
  <main class="app">
    <aside class="sidebar">
      <h2>连接设置</h2>
      <label>
        API 端点
        <input v-model="endpoint" placeholder="https://api.openai.com/v1" />
      </label>
      <label>
        API Key
        <input v-model="apiKey" type="password" placeholder="sk-..." />
      </label>
      <label>
        模型 ID
        <input v-model="model" placeholder="gpt-image-2" />
      </label>
      <label>
        接口模式
        <select v-model="apiMode">
          <option value="auto">自动（多参考图走 Chat）</option>
          <option value="images">Images 接口</option>
          <option value="chat">Chat 接口</option>
        </select>
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
        <input v-model.number="count" type="number" min="1" max="10" />
      </label>

      <button class="log-btn" @click="showLogs = !showLogs">
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
            <img :src="img.previewUrl" :alt="img.file.name" :title="img.file.name" />
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
          >＋</button>
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
          <button class="generate" :disabled="loading" @click="generate">
            {{ loading ? "生成中..." : "生成 (Ctrl+Enter)" }}
          </button>
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

      <div v-if="results.length" class="results">
        <div v-for="(img, i) in results" :key="i" class="result-card">
          <img :src="`data:${img.mime};base64,${img.base64}`" alt="生成结果" />
          <button @click="saveImage(img)">保存</button>
        </div>
      </div>
      <div v-else-if="!loading" class="placeholder">生成的图片将显示在这里</div>
      <div v-if="loading" class="placeholder">正在生成,请稍候...</div>
    </section>
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

.content {
  flex: 1;
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
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hint {
  font-size: 12px;
  color: #71717a;
}

.generate {
  font: inherit;
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  background: #6366f1;
  color: #fff;
  cursor: pointer;
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
  margin-top: auto;
  padding: 8px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #a1a1aa;
  cursor: pointer;
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

.results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.result-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-card img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #3f3f46;
}

.result-card button {
  font: inherit;
  padding: 6px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #27272a;
  color: #e4e4e7;
  cursor: pointer;
}

.result-card button:hover {
  border-color: #6366f1;
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
