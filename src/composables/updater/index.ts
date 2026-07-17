import {ref, type Ref} from "vue";
import {getVersion} from "@tauri-apps/api/app";
import {openUrl} from "@tauri-apps/plugin-opener";

const RELEASES_PAGE = "https://github.com/Gu-ZT/GugleAI/releases";
const UPDATE_API = "https://api.github.com/repos/Gu-ZT/GugleAI/releases?per_page=1";
const UPDATE_FALLBACK =
    "https://gh-proxy.com/https://raw.githubusercontent.com/Gu-ZT/GugleAI/main/src-tauri/tauri.conf.json";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Log = (level: "INFO" | "ERROR", message: string) => void;

export function useUpdater(fetch: Fetch, log: Log, error: Ref<string>) {
  const updateStatus = ref("");
  const updateUrl = ref("");
  const checkingUpdate = ref(false);

  async function fetchLatestVersion(): Promise<{version: string; url: string}> {
    try {
      const response = await fetch(UPDATE_API, {headers: {Accept: "application/vnd.github+json"}});
      if (response.ok) {
        const releases = await response.json();
        if (Array.isArray(releases) && releases[0]?.tag_name) {
          return {version: releases[0].tag_name, url: releases[0].html_url ?? RELEASES_PAGE};
        }
      }
      throw new Error(`GitHub API ${response.status}`);
    } catch (reason) {
      log("INFO", `GitHub API 不可达(${reason}),改用 gh-proxy 回退`);
      const response = await fetch(UPDATE_FALLBACK);
      if (!response.ok) throw new Error(`代理请求失败 (${response.status})`);
      const config = await response.json();
      if (!config.version) throw new Error("代理响应中没有版本号");
      return {version: config.version, url: RELEASES_PAGE};
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
    } catch (reason: unknown) {
      const message = `检查更新失败: ${reason instanceof Error ? reason.message : reason}`;
      log("ERROR", message);
      if (manual) updateStatus.value = message;
    } finally {
      checkingUpdate.value = false;
    }
  }

  async function openDownloadPage() {
    try {
      await openUrl(updateUrl.value || RELEASES_PAGE);
    } catch (reason: unknown) {
      error.value = `打开浏览器失败: ${reason instanceof Error ? reason.message : reason}`;
    }
  }

  return {updateStatus, updateUrl, checkingUpdate, checkUpdate, openDownloadPage};
}

function isNewer(remote: string, current: string): boolean {
  const remoteParts = parseVersion(remote);
  const currentParts = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if ((remoteParts[i] ?? 0) !== (currentParts[i] ?? 0)) {
      return (remoteParts[i] ?? 0) > (currentParts[i] ?? 0);
    }
  }
  return false;
}

function parseVersion(value: string): number[] {
  return value.replace(/^v/, "").split("+")[0].split(".").map((part) => parseInt(part, 10) || 0);
}
