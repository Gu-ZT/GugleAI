<script setup lang="ts">
import {ref} from "vue";
import {RouterLink, RouterView} from "vue-router";
import {IconArrowLeft, IconCloudDownload, IconFile, IconRobot, IconRobotAdd, IconSettings} from "@arco-design/web-vue/es/icon";

defineProps<{app: any}>();
const mobileCategoryOpen = ref(false);
</script>

<template>
  <section class="settings-page" aria-labelledby="settings-page-title">
    <div class="workspace-toolbar settings-page-toolbar">
      <div>
        <a-button
            v-if="mobileCategoryOpen"
            type="text"
            shape="circle"
            class="settings-mobile-back"
            title="返回设置分类"
            aria-label="返回设置分类"
            @click="mobileCategoryOpen = false"
        ><IconArrowLeft/></a-button>
        <strong id="settings-page-title">设置</strong>
      </div>
    </div>

    <div class="settings-layout" :class="{'mobile-detail-open': mobileCategoryOpen}">
      <aside class="settings-subnav" aria-label="设置分类">
        <RouterLink :to="{name: 'settings-models'}" class="settings-subnav-link" @click="mobileCategoryOpen = true">
          <IconRobot aria-hidden="true"/><span>模型设置</span>
        </RouterLink>
        <RouterLink :to="{name: 'settings-agents'}" class="settings-subnav-link" @click="mobileCategoryOpen = true">
          <IconRobotAdd aria-hidden="true"/><span>智能体设置</span>
        </RouterLink>
        <RouterLink :to="{name: 'settings-general'}" class="settings-subnav-link" @click="mobileCategoryOpen = true">
          <IconSettings aria-hidden="true"/><span>通用设置</span>
        </RouterLink>
        <RouterLink :to="{name: 'settings-logs'}" class="settings-subnav-link" @click="mobileCategoryOpen = true">
          <IconFile aria-hidden="true"/><span>日志</span>
        </RouterLink>
        <RouterLink :to="{name: 'settings-backup'}" class="settings-subnav-link" @click="mobileCategoryOpen = true">
          <IconCloudDownload aria-hidden="true"/><span>备份</span>
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
