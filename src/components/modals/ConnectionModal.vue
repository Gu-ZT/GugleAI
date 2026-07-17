<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div v-if="app.connectionModalOpen" class="modal-backdrop connection-backdrop" @mousedown.self="app.closeConnectionModal">
    <form class="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-modal-title" @submit.prevent="app.saveConnectionDraft" @keydown.esc.prevent="app.closeConnectionModal">
      <div class="modal-header">
        <h2 id="connection-modal-title">{{ app.connectionDraftId ? '编辑 API 连接' : '添加 API 连接' }}</h2>
        <button type="button" aria-label="关闭" title="关闭" @click="app.closeConnectionModal">×</button>
      </div>
      <label for="connection-endpoint-input">
        API 端点
        <input id="connection-endpoint-input" v-model="app.connectionDraftEndpoint" autofocus autocomplete="off" placeholder="https://api.openai.com/v1" @input="app.connectionDraftError = ''"/>
      </label>
      <label for="connection-api-key-input">
        API Key（可选）
        <input id="connection-api-key-input" v-model="app.connectionDraftApiKey" type="password" autocomplete="new-password" placeholder="sk-..."/>
      </label>
      <div class="connection-model-editor">
        <label for="connection-model-input">可用模型</label>
        <div class="connection-model-input-row">
          <input id="connection-model-input" v-model="app.connectionDraftModelInput" autocomplete="off" placeholder="输入模型 ID" @keydown.enter.prevent="app.addConnectionDraftModel"/>
          <button type="button" @click="app.addConnectionDraftModel">添加</button>
        </div>
        <div class="connection-model-list">
          <span v-for="modelName in app.connectionDraftModels" :key="modelName" class="connection-model-chip">
            <span :title="modelName">{{ modelName }}</span>
            <button type="button" :aria-label="`删除模型 ${modelName}`" title="删除模型" @click="app.removeConnectionDraftModel(modelName)">×</button>
          </span>
        </div>
      </div>
      <p v-if="app.connectionDraftError" class="modal-error">{{ app.connectionDraftError }}</p>
      <div class="modal-actions">
        <button type="button" class="modal-cancel" @click="app.closeConnectionModal">取消</button>
        <button type="submit" class="modal-save">{{ app.connectionDraftId ? '保存修改' : '保存连接' }}</button>
      </div>
    </form>
  </div>
</template>
