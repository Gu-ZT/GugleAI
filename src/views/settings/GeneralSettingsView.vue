<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div class="settings-section">
    <h2>通用设置</h2>
    <div class="settings-form-grid">
      <h3>个人信息</h3>
      <label class="field settings-form-wide">
        <span class="field-label">用户名称</span>
        <a-input v-model="app.userName" :max-length="64" placeholder="请输入用户名称"/>
      </label>

      <h3>外观</h3>
      <label class="settings-form-wide">
        主题
        <a-radio-group v-model="app.themeMode" type="button" class="theme-mode-control">
          <a-radio value="light">浅色</a-radio>
          <a-radio value="dark">深色</a-radio>
          <a-radio value="system">跟随系统</a-radio>
        </a-radio-group>
      </label>

      <h3>生成设置</h3>
      <div class="field settings-form-wide">
        <span class="field-label">对话标题</span>
        <a-select v-model="app.titleModelSelection" :options="app.titleModelSelectOptions" class="model-provider-select">
          <template #label="{data}">
            <span class="selected-model-label">{{ data.label }}</span>
            <a-tag v-if="data.providerName" size="small" class="model-provider-tag">{{ data.providerName }}</a-tag>
          </template>
        </a-select>
      </div>

      <h3>应用更新</h3>
      <a-checkbox v-model="app.autoCheckUpdate" class="checkbox-row settings-form-wide">
        启动时自动检查更新
      </a-checkbox>
      <a-button class="log-btn" :loading="app.checkingUpdate" @click="app.checkUpdate(true)">
        {{ app.checkingUpdate ? "检查中..." : "检查更新" }}
      </a-button>
      <p v-if="app.updateStatus" class="update-status settings-form-wide">
        {{ app.updateStatus }}
        <a-link v-if="app.updateUrl" href="#" @click.prevent="app.openDownloadPage">前往下载</a-link>
      </p>
    </div>
  </div>
</template>
