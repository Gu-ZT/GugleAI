<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div v-if="app.connectionModalOpen" class="modal-backdrop connection-backdrop" @mousedown.self="app.closeConnectionModal">
    <form class="connection-modal" role="dialog" aria-modal="true" aria-labelledby="provider-modal-title" @submit.prevent="app.saveConnectionDraft" @keydown.esc.prevent="app.closeConnectionModal">
      <div class="modal-header">
        <h2 id="provider-modal-title">{{ app.connectionDraftId ? '编辑提供商' : '添加提供商' }}</h2>
        <button type="button" aria-label="关闭" title="关闭" @click="app.closeConnectionModal">×</button>
      </div>
      <label for="provider-name-input">
        提供商名称
        <input id="provider-name-input" v-model="app.connectionDraftName" autofocus autocomplete="off" placeholder="例如 OpenAI" @input="app.connectionDraftError = ''"/>
      </label>
      <label for="provider-endpoint-input">
        API 地址
        <input id="provider-endpoint-input" v-model="app.connectionDraftEndpoint" autocomplete="off" placeholder="https://api.openai.com/v1" @input="app.connectionDraftError = ''"/>
      </label>
      <label for="provider-api-key-input">
        API Key（可选）
        <input id="provider-api-key-input" v-model="app.connectionDraftApiKey" type="password" autocomplete="new-password" placeholder="sk-..."/>
      </label>
      <p v-if="app.connectionDraftError" class="modal-error">{{ app.connectionDraftError }}</p>
      <div class="modal-actions">
        <button type="button" class="modal-cancel" @click="app.closeConnectionModal">取消</button>
        <button type="submit" class="modal-save">{{ app.connectionDraftId ? '保存修改' : '添加提供商' }}</button>
      </div>
    </form>
  </div>
</template>
