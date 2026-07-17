<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div class="settings-section">
    <h2>通用设置</h2>
    <div class="settings-form-grid">
      <h3>应用更新</h3>
      <label class="checkbox-row settings-form-wide">
        <input v-model="app.autoCheckUpdate" type="checkbox"/>
        <span>启动时自动检查更新</span>
      </label>
      <button class="log-btn" :disabled="app.checkingUpdate" @click="app.checkUpdate(true)">
        {{ app.checkingUpdate ? "检查中..." : "检查更新" }}
      </button>
      <p v-if="app.updateStatus" class="update-status settings-form-wide">
        {{ app.updateStatus }}
        <a v-if="app.updateUrl" href="#" @click.prevent="app.openDownloadPage">前往下载</a>
      </p>
    </div>
  </div>
</template>
