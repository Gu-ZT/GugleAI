import {createRouter, createWebHashHistory, type RouteRecordRaw} from "vue-router";
import ImageView from "../views/ImageView.vue";
import ChatView from "../views/ChatView.vue";
import CanvasView from "../views/CanvasView.vue";
import SettingsView from "../views/SettingsView.vue";

export type WorkspaceMode = "image" | "chat" | "canvas" | "settings";

const LAST_MODE_KEY = "gugle-ai-last-workspace";

const routes: RouteRecordRaw[] = [
  {path: "/", redirect: () => `/${restoreWorkspaceMode()}`},
  {path: "/image", name: "image", component: ImageView},
  {path: "/chat", name: "chat", component: ChatView},
  {path: "/canvas", name: "canvas", component: CanvasView},
  {path: "/settings", name: "settings", component: SettingsView},
  {path: "/:pathMatch(.*)*", redirect: "/image"},
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.afterEach((to) => {
  const mode = workspaceModeFromRoute(to.name);
  localStorage.setItem(LAST_MODE_KEY, mode);
});

export function workspaceModeFromRoute(name: unknown): WorkspaceMode {
  return name === "chat" || name === "canvas" || name === "settings" ? name : "image";
}

export function restoreWorkspaceMode(): WorkspaceMode {
  const saved = localStorage.getItem(LAST_MODE_KEY);
  return saved === "chat" || saved === "canvas" || saved === "settings" ? saved : "image";
}
