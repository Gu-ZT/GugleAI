import {ref, type Ref} from "vue";
import {invoke} from "@tauri-apps/api/core";

export function useLogger(apiKeys: () => string[], error: Ref<string>) {
  const logs = ref<string[]>([]);
  const logFilePath = ref("");

  function redactSensitiveText(value: unknown): string {
    let text = String(value ?? "");
    for (const savedKey of new Set(apiKeys())) {
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

  function errorMessage(value: unknown): string {
    if (value && typeof value === "object") {
      const message = (value as Record<string, unknown>).message;
      if (typeof message === "string") return redactSensitiveText(message);
    }
    return redactSensitiveText(value);
  }

  function formatErrorDetails(value: unknown, depth = 0): string {
    if (!value || typeof value !== "object") return errorMessage(value);
    const record = value as Record<string, unknown>;
    const details: string[] = [];
    for (const field of [
      "name", "message", "code", "kind", "errno", "status", "type", "reason", "error", "details",
    ] as const) {
      const fieldValue = record[field];
      if (typeof fieldValue === "string" || typeof fieldValue === "number") {
        details.push(`${field}=${redactSensitiveText(fieldValue)}`);
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
    return details.length > 0 ? details.join(" | ") : errorMessage(value);
  }

  function log(level: "INFO" | "ERROR", message: string) {
    const line = `[${new Date().toLocaleString()}] [${level}] ${redactSensitiveText(message)}`;
    logs.value.push(line);
    if (logs.value.length > 500) logs.value.splice(0, logs.value.length - 500);
    invoke("append_log", {line}).catch(() => {});
  }

  async function openLogFile() {
    try {
      logFilePath.value = await invoke<string>("show_log_file");
    } catch (reason: unknown) {
      error.value = `打开日志失败: ${errorMessage(reason)}`;
    }
  }

  return {
    logs,
    logFilePath,
    redactSensitiveText,
    sanitizeUrlForLog,
    errorMessage,
    formatErrorDetails,
    log,
    openLogFile,
  };
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function describeRequestBody(body: BodyInit | null | undefined): string {
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
