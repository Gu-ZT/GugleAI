<script setup lang="ts">
import {RouterView} from "vue-router";
import {
  IconImage,
  IconMessage,
  IconMindMapping,
  IconSettings,
} from "@arco-design/web-vue/es/icon";
import {useAppController} from "./composables/controller";
import ModelModal from "./components/modals/ModelModal.vue";
import ResultOverlays from "./components/modals/ResultOverlays.vue";
import UnsavedChangesModal from "./components/modals/UnsavedChangesModal.vue";

const {appMode, appBusy, setAppMode, viewModel} = useAppController();
</script>

<template>
  <main class="app">
    <aside class="nav-rail" aria-label="工作区导航">
      <nav class="workspace-nav">
        <a-button
            type="text"
            class="nav-rail-button"
            :class="{ active: appMode === 'image' }"
            :disabled="appBusy"
            title="生图"
            @click="setAppMode('image')"
        >
          <IconImage aria-hidden="true"/>
          <span>生图</span>
        </a-button>
        <a-button
            type="text"
            class="nav-rail-button"
            :class="{ active: appMode === 'chat' }"
            :disabled="appBusy"
            title="聊天"
            @click="setAppMode('chat')"
        >
          <IconMessage aria-hidden="true"/>
          <span>聊天</span>
        </a-button>
        <a-button
            type="text"
            class="nav-rail-button"
            :class="{ active: appMode === 'canvas' }"
            :disabled="appBusy"
            title="无尽画布"
            @click="setAppMode('canvas')"
        >
          <IconMindMapping aria-hidden="true"/>
          <span>无尽画布</span>
        </a-button>
      </nav>
      <a-button
          type="text"
          class="nav-rail-button settings-button"
          :class="{ active: appMode === 'settings' }"
          :disabled="appBusy"
          title="设置"
          @click="setAppMode('settings')"
      >
        <IconSettings aria-hidden="true"/>
        <span>设置</span>
      </a-button>
    </aside>

    <a-scrollbar outer-class="content" class="content-scroll-container" :disable-horizontal="true">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :app="viewModel"/>
      </RouterView>
    </a-scrollbar>

    <ModelModal :app="viewModel"/>
    <UnsavedChangesModal :app="viewModel"/>
    <ResultOverlays :app="viewModel"/>
  </main>
</template>

<style src="./styles/app.css"></style>
