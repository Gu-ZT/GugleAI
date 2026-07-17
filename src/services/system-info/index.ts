import {invoke} from "@tauri-apps/api/core";

interface SystemInfo {
  system: string;
  arch: string;
  username: string;
}

let systemInfoPromise: Promise<SystemInfo> | null = null;

export async function resolvePromptTemplate(template: string, modelName: string): Promise<string> {
  if (!template) return "";
  const now = new Date();
  const locale = navigator.language || "zh-CN";
  const systemInfo = await getSystemInfo();
  const variables: Record<string, string> = {
    date: now.toLocaleDateString(locale),
    time: now.toLocaleTimeString(locale),
    datetime: now.toLocaleString(locale),
    system: systemInfo.system,
    arch: systemInfo.arch,
    language: locale,
    model_name: modelName,
    username: systemInfo.username,
  };
  return template.replace(/\{\{(date|time|datetime|system|arch|language|model_name|username)}}/g, (
      _match,
      name: string
  ) => variables[name]);
}

async function getSystemInfo(): Promise<SystemInfo> {
  if (!systemInfoPromise) {
    systemInfoPromise = invoke<SystemInfo>("get_system_info").catch(browserSystemInfo);
  }
  return systemInfoPromise;
}

function browserSystemInfo(): SystemInfo {
  const platform = navigator.platform || "未知";
  const userAgent = navigator.userAgent;
  const arch = /arm64|aarch64/i.test(userAgent)
      ? "aarch64"
      : /x86_64|x64|win64|amd64/i.test(userAgent)
          ? "x86_64"
          : platform;
  return {system: platform, arch, username: "未知"};
}
