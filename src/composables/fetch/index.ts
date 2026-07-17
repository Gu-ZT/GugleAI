import {fetch as httpFetch, type ClientOptions} from "@tauri-apps/plugin-http";
import {invoke} from "@tauri-apps/api/core";

type Log = (level: "INFO" | "ERROR", message: string) => void;

export function useSystemFetch(log: Log, sanitizeUrl: (value: string) => string) {
  let lastProxy: string | null | undefined;

  async function fetch(input: string, init?: RequestInit & ClientOptions): Promise<Response> {
    const options = {...init};
    if (!options.proxy) {
      let proxy: string | null = null;
      try {
        proxy = await invoke<string | null>("get_system_proxy");
      } catch {
      }
      if (proxy !== lastProxy) {
        lastProxy = proxy;
        log("INFO", proxy ? `使用系统代理: ${sanitizeUrl(proxy)}` : "系统代理已关闭,直连");
      }
      if (proxy) options.proxy = {all: proxy};
    }
    return httpFetch(input, options);
  }

  function proxyForLog(): string {
    if (lastProxy === undefined) return "未知";
    return lastProxy ? sanitizeUrl(lastProxy) : "直连";
  }

  return {fetch, proxyForLog};
}
