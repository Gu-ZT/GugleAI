import {computed, onMounted, onUnmounted, ref, watch, type Ref} from "vue";
import {save} from "@tauri-apps/plugin-dialog";
import {invoke} from "@tauri-apps/api/core";
import {arrayBufferToBase64} from "../../services/transport";
import {
  createBackupArchive,
  deleteBackup as deleteStoredBackup,
  getBackup,
  listBackups,
  putBackup,
  pruneAutomaticBackups,
  readBackupArchive,
  restoreBackupContents,
  type BackupKind,
  type BackupMetadata,
} from "../../services/backup";

export const BACKUP_SETTINGS_KEY = "gugle-ai-backup-settings";

interface BackupOptions {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  error: Ref<string>;
  errorMessage(value: unknown): string;
}

export function useBackup(options: BackupOptions) {
  const backups = ref<BackupMetadata[]>([]);
  const backupLoading = ref(false);
  const backupBusy = ref(false);
  const backupStatus = ref("");
  const autoBackupEnabled = ref(false);
  const autoBackupIntervalMinutes = ref(1440);
  const automaticBackupRetention = ref(5);
  const webdavEnabled = ref(false);
  const webdavUrl = ref("");
  const webdavPath = ref("gugle-ai-backups");
  const webdavUsername = ref("");
  const webdavPassword = ref("");
  const webdavBackups = ref<string[]>([]);
  const webdavLoading = ref(false);
  let autoBackupTimer: number | null = null;

  restoreSettings();
  watch(
      [
        autoBackupEnabled,
        autoBackupIntervalMinutes,
        automaticBackupRetention,
        webdavEnabled,
        webdavUrl,
        webdavPath,
        webdavUsername,
        webdavPassword,
      ],
      persistSettings,
      {deep: true}
  );
  watch(automaticBackupRetention, (value) => {
    void pruneAutomaticBackups(value).then(refreshBackups).catch((reason) => {
      reportBackupError("清理自动备份", reason);
    });
  });

  const latestBackup = computed(() => backups.value[0] ?? null);
  const automaticBackups = computed(() => backups.value.filter((item) => item.kind === "automatic"));

  async function refreshBackups() {
    backupLoading.value = true;
    try {
      backups.value = await listBackups();
    } catch (reason) {
      reportBackupError("加载备份", reason);
    } finally {
      backupLoading.value = false;
    }
  }

  async function createBackup(kind: BackupKind = "manual") {
    if (backupBusy.value) return;
    backupBusy.value = true;
    backupStatus.value = "";
    try {
      const archive = await createBackupArchive();
      const metadata = await putBackup(archive, kind, automaticBackupRetention.value);
      await refreshBackups();
      if (webdavEnabled.value && webdavConfigured.value) {
        try {
          await uploadBackupArchive(metadata, archive);
          backupStatus.value = `${kind === "automatic" ? "自动" : "手动"}备份已创建并上传到 WebDAV`;
        } catch (reason) {
          backupStatus.value = `${kind === "automatic" ? "自动" : "手动"}备份已创建，但 WebDAV 上传失败`;
          reportBackupError("上传 WebDAV 备份", reason, false);
        }
      } else {
        backupStatus.value = `${kind === "automatic" ? "自动" : "手动"}备份已创建`;
      }
    } catch (reason) {
      reportBackupError("创建备份", reason);
    } finally {
      backupBusy.value = false;
    }
  }

  async function deleteBackup(id: string) {
    const backup = backups.value.find((item) => item.id === id);
    if (!backup || !window.confirm(`确定删除备份“${backup.name}”吗？此操作无法撤销。`)) return;
    try {
      await deleteStoredBackup(id);
      backups.value = backups.value.filter((item) => item.id !== id);
      backupStatus.value = "备份已删除";
    } catch (reason) {
      reportBackupError("删除备份", reason);
    }
  }

  async function exportBackup(id: string) {
    const backup = await getBackup(id);
    if (!backup) {
      reportBackupError("导出备份", new Error("备份不存在"));
      return;
    }
    const path = await save({
      defaultPath: backup.name,
      filters: [{name: "GugleAI 备份", extensions: ["zip"]}],
    });
    if (!path) return;
    try {
      await invoke("save_file", {
        path,
        base64Data: arrayBufferToBase64(await backup.blob.arrayBuffer()),
      });
      backupStatus.value = "备份已导出";
    } catch (reason) {
      reportBackupError("导出备份", reason);
    }
  }

  async function importBackup(file: File | Blob) {
    if (backupBusy.value) return;
    backupBusy.value = true;
    try {
      const contents = await readBackupArchive(file);
      if (!window.confirm("导入备份会覆盖当前设置、聊天、预览历史和画布数据，确定继续吗？")) return;
      await restoreBackupContents(contents);
      backupStatus.value = "备份已导入，正在重新加载应用";
      window.setTimeout(() => window.location.reload(), 250);
    } catch (reason) {
      reportBackupError("导入备份", reason);
    } finally {
      backupBusy.value = false;
    }
  }

  function onImportBackup(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) void importBackup(file);
  }

  async function testWebdav() {
    if (!webdavConfigured.value) {
      reportBackupError("测试 WebDAV", new Error("请先填写 WebDAV 地址和账号"));
      return;
    }
    webdavLoading.value = true;
    try {
      const response = await webdavRequest(webdavDirectoryUrl.value, "PROPFIND", undefined, {Depth: "0"});
      if (!response.ok && response.status !== 207) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
      backupStatus.value = "WebDAV 连接成功";
    } catch (reason) {
      reportBackupError("测试 WebDAV", reason);
    } finally {
      webdavLoading.value = false;
    }
  }

  async function refreshWebdavBackups() {
    if (!webdavConfigured.value) return;
    webdavLoading.value = true;
    try {
      const response = await webdavRequest(webdavDirectoryUrl.value, "PROPFIND", undefined, {Depth: "1"});
      if (!response.ok && response.status !== 207) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
      const xml = await response.text();
      webdavBackups.value = [...xml.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi)]
          .map((match) => decodeURIComponent(match[1]))
          .map((value) => value.split("/").filter(Boolean).pop() ?? "")
          .filter((name, index, names) => name.endsWith(".zip") && names.indexOf(name) === index);
    } catch (reason) {
      reportBackupError("读取 WebDAV 备份", reason);
    } finally {
      webdavLoading.value = false;
    }
  }

  async function downloadWebdavBackup(name: string) {
    if (!webdavConfigured.value || !name) return;
    webdavLoading.value = true;
    try {
      const response = await webdavRequest(webdavFileUrl(name), "GET");
      if (!response.ok) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
      const archive = await response.blob();
      await putBackup(archive, "manual", automaticBackupRetention.value);
      await refreshBackups();
      backupStatus.value = "WebDAV 备份已下载到本地";
    } catch (reason) {
      reportBackupError("下载 WebDAV 备份", reason);
    } finally {
      webdavLoading.value = false;
    }
  }

  async function uploadBackup(id: string) {
    const backup = await getBackup(id);
    if (!backup) return;
    try {
      await uploadBackupArchive(backup, backup.blob);
      backupStatus.value = "备份已上传到 WebDAV";
    } catch (reason) {
      reportBackupError("上传 WebDAV 备份", reason);
    }
  }

  async function uploadBackupArchive(metadata: BackupMetadata, archive: Blob) {
    const response = await webdavRequest(
        webdavFileUrl(metadata.name),
        "PUT",
        archive,
        {"Content-Type": "application/zip"}
    );
    if (!response.ok) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
  }

  async function webdavRequest(
      url: string,
      method: string,
      body?: BodyInit,
      extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {...extraHeaders};
    if (webdavUsername.value || webdavPassword.value) {
      headers.Authorization = `Basic ${encodeBasicAuth(webdavUsername.value, webdavPassword.value)}`;
    }
    return options.fetch(url, {method, headers, body});
  }

  async function checkAutomaticBackup() {
    if (!autoBackupEnabled.value || backupBusy.value) return;
    await refreshBackups();
    const latest = backups.value[0];
    const interval = Math.max(1, Number(autoBackupIntervalMinutes.value) || 1) * 60 * 1000;
    if (!latest || Date.now() - latest.createdAt >= interval) await createBackup("automatic");
  }

  function reportBackupError(action: string, reason: unknown, setError = true) {
    const message = `备份${action}失败: ${options.errorMessage(reason)}`;
    if (setError) options.error.value = message;
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(BACKUP_SETTINGS_KEY) ?? "null");
      if (!saved || typeof saved !== "object") return;
      autoBackupEnabled.value = saved.autoBackupEnabled === true;
      autoBackupIntervalMinutes.value = finiteRange(saved.autoBackupIntervalMinutes, 1440, 1, 525600);
      automaticBackupRetention.value = finiteRange(saved.automaticBackupRetention, 5, 1, 100);
      webdavEnabled.value = saved.webdavEnabled === true;
      webdavUrl.value = stringValue(saved.webdavUrl);
      webdavPath.value = stringValue(saved.webdavPath) || "gugle-ai-backups";
      webdavUsername.value = stringValue(saved.webdavUsername);
      webdavPassword.value = stringValue(saved.webdavPassword);
    } catch {
    }
  }

  function persistSettings() {
    localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify({
      autoBackupEnabled: autoBackupEnabled.value,
      autoBackupIntervalMinutes: finiteRange(autoBackupIntervalMinutes.value, 1440, 1, 525600),
      automaticBackupRetention: finiteRange(automaticBackupRetention.value, 5, 1, 100),
      webdavEnabled: webdavEnabled.value,
      webdavUrl: webdavUrl.value.trim(),
      webdavPath: webdavPath.value.trim(),
      webdavUsername: webdavUsername.value,
      webdavPassword: webdavPassword.value,
    }));
  }

  onMounted(() => {
    void refreshBackups();
    void checkAutomaticBackup();
    autoBackupTimer = window.setInterval(() => void checkAutomaticBackup(), 60 * 1000);
  });
  onUnmounted(() => {
    if (autoBackupTimer !== null) window.clearInterval(autoBackupTimer);
  });

  const webdavConfigured = computed(() => Boolean(webdavUrl.value.trim()));
  const webdavDirectoryUrl = computed(() => buildWebdavUrl(webdavUrl.value, webdavPath.value));
  const webdavFileUrl = (name: string) => `${webdavDirectoryUrl.value.replace(/\/+$/, "")}/${encodeURIComponent(name)}`;

  return {
    backups,
    automaticBackups,
    latestBackup,
    backupLoading,
    backupBusy,
    backupStatus,
    autoBackupEnabled,
    autoBackupIntervalMinutes,
    automaticBackupRetention,
    webdavEnabled,
    webdavUrl,
    webdavPath,
    webdavUsername,
    webdavPassword,
    webdavConfigured,
    webdavBackups,
    webdavLoading,
    refreshBackups,
    createBackup,
    deleteBackup,
    exportBackup,
    onImportBackup,
    testWebdav,
    refreshWebdavBackups,
    downloadWebdavBackup,
    uploadBackup,
    formatBackupDate,
    formatBackupSize,
  };
}

function buildWebdavUrl(base: string, path: string): string {
  const normalizedBase = base.trim().replace(/\/+$/, "");
  const segments = path.split("/").map((item) => item.trim()).filter(Boolean).map(encodeURIComponent);
  return segments.length ? `${normalizedBase}/${segments.join("/")}` : normalizedBase;
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function finiteRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatBackupDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN");
}

function formatBackupSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

export type BackupSettings = ReturnType<typeof useBackup>;
