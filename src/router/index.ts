import {createRouter, createWebHashHistory, type RouteRecordRaw} from "vue-router";

export type WorkspaceMode = "image" | "chat" | "canvas";

const LAST_MODE_KEY = "gugle-ai-last-workspace";

const routes: RouteRecordRaw[] = [
  {path: "/", redirect: () => `/${restoreWorkspaceMode()}`},
  {path: "/image", name: "image", component: {render: () => null}},
  {path: "/chat", name: "chat", component: {render: () => null}},
  {path: "/canvas", name: "canvas", component: {render: () => null}},
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
  return name === "chat" || name === "canvas" ? name : "image";
}

export function restoreWorkspaceMode(): WorkspaceMode {
  const saved = localStorage.getItem(LAST_MODE_KEY);
  return saved === "chat" || saved === "canvas" ? saved : "image";
}
