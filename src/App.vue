<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
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
const size = ref("auto");
const count = ref(1);

const prompt = ref("");
const refImages = ref<RefImage[]>([]);
const results = ref<ResultImage[]>([]);
const loading = ref(false);
const error = ref("");
const fileInput = ref<HTMLInputElement>();
const dragOver = ref(false);

onMounted(() => {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    try {
      const s = JSON.parse(saved);
      endpoint.value = s.endpoint ?? endpoint.value;
      apiKey.value = s.apiKey ?? "";
      model.value = s.model ?? model.value;
    } catch {}
  }
  window.addEventListener("paste", onPaste);
});

onUnmounted(() => {
  window.removeEventListener("paste", onPaste);
});

watch([endpoint, apiKey, model], () => {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ endpoint: endpoint.value, apiKey: apiKey.value, model: model.value })
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

function onPaste(e: ClipboardEvent) {
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

  const base = endpoint.value.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey.value}`,
  };

  try {
    let resp: Response;
    if (refImages.value.length > 0) {
      // 带参考图走 edits 接口,multipart 上传任意数量的 image[]
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

    const text = await resp.text();
    if (!resp.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text)?.error?.message ?? text;
      } catch {}
      throw new Error(`请求失败 (${resp.status}): ${msg}`);
    }

    const data = JSON.parse(text);
    for (const item of data.data ?? []) {
      if (item.b64_json) {
        results.value.push({ base64: item.b64_json, mime: "image/png" });
      } else if (item.url) {
        // 部分中转服务返回相对路径,需拼接到配置的 API 端点上
        const imgUrl = /^https?:\/\//i.test(item.url)
          ? item.url
          : base + (item.url.startsWith("/") ? "" : "/") + item.url;
        const imgResp = await fetch(imgUrl);
        if (!imgResp.ok) {
          throw new Error(`下载图片失败 (${imgResp.status}): ${imgUrl}`);
        }
        const buf = await imgResp.arrayBuffer();
        results.value.push({
          base64: bufToBase64(buf),
          mime: imgResp.headers.get("content-type") ?? "image/png",
        });
      }
    }
    if (results.value.length === 0) {
      throw new Error("响应中没有图片数据");
    }
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
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
          <span class="hint">
            {{ refImages.length > 0 ? `${refImages.length} 张参考图 · 使用图像编辑接口` : "无参考图 · 使用文生图接口" }}
          </span>
          <button class="generate" :disabled="loading" @click="generate">
            {{ loading ? "生成中..." : "生成 (Ctrl+Enter)" }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

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
