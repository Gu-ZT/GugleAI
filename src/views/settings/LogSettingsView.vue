<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div class="settings-section settings-log-section">
    <div class="settings-section-heading">
      <h2>日志</h2>
      <button class="log-btn" @click="app.openLogFile">打开日志文件</button>
    </div>
    <p v-if="app.logFilePath" class="log-path settings-log-path">{{ app.logFilePath }}</p>
    <div class="log-panel settings-log-panel">
      <div class="log-header">
        <span>运行日志（本次会话 {{ app.logs.length }} 条）</span>
      </div>
      <a-scrollbar outer-class="log-body" class="log-body-container">
        <pre>{{ app.logs.length ? app.logs.join("\n") : "暂无日志" }}</pre>
      </a-scrollbar>
    </div>
  </div>
</template>
