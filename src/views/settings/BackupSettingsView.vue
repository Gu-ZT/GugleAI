<script setup lang="ts">
import {ref} from "vue";

defineProps<{app: any}>();
const backupInput = ref<HTMLInputElement | null>(null);
</script>

<template>
  <div class="settings-section backup-settings-section">
    <div class="settings-section-heading">
      <h2>备份</h2>
      <div class="backup-toolbar-actions">
        <a-button type="primary" :loading="app.backupBusy" @click="app.createBackup('manual')">创建备份</a-button>
        <a-button :disabled="app.backupBusy" @click="backupInput?.click()">导入备份</a-button>
        <input ref="backupInput" type="file" accept=".zip,application/zip" hidden @change="app.onImportBackup"/>
      </div>
    </div>

    <p class="backup-notice">备份包含设置、聊天记录、预览历史和画布图片。备份包可能包含 API Key 与 WebDAV 密码，请妥善保管。</p>
    <p v-if="app.backupStatus" class="backup-status">{{ app.backupStatus }}</p>

    <h3>本地备份</h3>
    <a-scrollbar class="backup-list-scroll" :disable-horizontal="true">
      <div v-if="app.backups.length" class="backup-list">
        <div v-for="backup in app.backups" :key="backup.id" class="backup-row">
          <div class="backup-row-main">
            <strong>{{ backup.name }}</strong>
            <span>
              <a-tag size="small" :status="backup.kind === 'automatic' ? 'normal' : 'arcoblue'">
                {{ backup.kind === 'automatic' ? '自动' : '手动' }}
              </a-tag>
              {{ app.formatBackupDate(backup.createdAt) }} · {{ app.formatBackupSize(backup.size) }}
            </span>
          </div>
          <div class="backup-row-actions">
            <a-button size="small" @click="app.exportBackup(backup.id)">导出</a-button>
            <a-button v-if="app.webdavConfigured" size="small" @click="app.uploadBackup(backup.id)">上传</a-button>
            <a-button type="text" status="danger" size="small" @click="app.deleteBackup(backup.id)">删除</a-button>
          </div>
        </div>
      </div>
      <a-empty v-else description="暂无本地备份"/>
    </a-scrollbar>

    <h3>自动备份</h3>
    <div class="backup-form-grid backup-auto-grid">
      <label class="backup-switch-field">
        <span>启用自动备份</span>
        <a-switch v-model="app.autoBackupEnabled" />
      </label>
      <label>
        <span>备份间隔（分钟）</span>
        <a-input-number v-model="app.autoBackupIntervalMinutes" :min="1" :max="525600" />
      </label>
      <label>
        <span>保留自动备份数量</span>
        <a-input-number v-model="app.automaticBackupRetention" :min="1" :max="100" />
      </label>
    </div>
    <p class="backup-field-help">自动备份按最近一次备份的创建时间计算间隔，保留数量只统计自动备份。</p>

    <h3>WebDAV</h3>
    <div class="backup-form-grid">
      <label class="backup-switch-field settings-form-wide">
        <span>启用 WebDAV 同步</span>
        <a-switch v-model="app.webdavEnabled" />
      </label>
      <label class="settings-form-wide">
        <span>WebDAV 地址</span>
        <a-input v-model="app.webdavUrl" placeholder="https://dav.example.com/remote.php/dav/files/user" />
      </label>
      <label class="settings-form-wide">
        <span>远程目录</span>
        <a-input v-model="app.webdavPath" placeholder="gugle-ai-backups" />
      </label>
      <label>
        <span>用户名</span>
        <a-input v-model="app.webdavUsername" />
      </label>
      <label>
        <span>密码</span>
        <a-input-password v-model="app.webdavPassword" />
      </label>
    </div>
    <div class="backup-webdav-actions">
      <a-button :loading="app.webdavLoading" @click="app.testWebdav">测试连接</a-button>
      <a-button :loading="app.webdavLoading" @click="app.refreshWebdavBackups">刷新远程备份</a-button>
    </div>
    <a-scrollbar v-if="app.webdavBackups.length" class="backup-list-scroll backup-remote-list" :disable-horizontal="true">
      <div v-for="name in app.webdavBackups" :key="name" class="backup-row">
        <div class="backup-row-main"><strong>{{ name }}</strong><span>WebDAV</span></div>
        <a-button size="small" @click="app.downloadWebdavBackup(name)">下载到本地</a-button>
      </div>
    </a-scrollbar>
  </div>
</template>
