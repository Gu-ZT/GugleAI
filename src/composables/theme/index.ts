import {onMounted, onUnmounted, ref, watch} from "vue";
import {SETTINGS_KEY} from "../../domain/models";

export type ThemeMode = "light" | "dark" | "system";

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function useTheme() {
  const themeMode = ref<ThemeMode>("system");
  const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    themeMode.value = normalizeThemeMode(settings?.themeMode);
  } catch {
  }

  function applyTheme() {
    const dark = themeMode.value === "dark"
        || (themeMode.value === "system" && systemDarkQuery.matches);
    document.body.toggleAttribute("arco-theme", dark);
    if (dark) document.body.setAttribute("arco-theme", "dark");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }

  applyTheme();
  watch(themeMode, applyTheme);
  onMounted(() => systemDarkQuery.addEventListener("change", applyTheme));
  onUnmounted(() => systemDarkQuery.removeEventListener("change", applyTheme));

  return {themeMode};
}
