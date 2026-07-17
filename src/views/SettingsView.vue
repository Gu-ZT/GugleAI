<script setup lang="ts">
import {RouterLink, RouterView} from "vue-router";
import {IconFile, IconRobot, IconSettings} from "@arco-design/web-vue/es/icon";

defineProps<{app: any}>();
</script>

<template>
  <section class="settings-page" aria-labelledby="settings-page-title">
    <div class="workspace-toolbar settings-page-toolbar">
      <div>
        <strong id="settings-page-title">设置</strong>
      </div>
    </div>

    <div class="settings-layout">
      <aside class="settings-subnav" aria-label="设置分类">
        <RouterLink :to="{name: 'settings-models'}" class="settings-subnav-link">
          <IconRobot aria-hidden="true"/><span>模型设置</span>
        </RouterLink>
        <RouterLink :to="{name: 'settings-general'}" class="settings-subnav-link">
          <IconSettings aria-hidden="true"/><span>通用设置</span>
        </RouterLink>
        <RouterLink :to="{name: 'settings-logs'}" class="settings-subnav-link">
          <IconFile aria-hidden="true"/><span>日志</span>
        </RouterLink>
      </aside>

      <a-scrollbar outer-class="settings-subpage" class="settings-subpage-container" :disable-horizontal="true">
        <RouterView v-slot="{Component}">
          <component :is="Component" :app="app"/>
        </RouterView>
      </a-scrollbar>
    </div>
  </section>
</template>
