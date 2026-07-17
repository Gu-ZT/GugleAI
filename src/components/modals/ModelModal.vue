<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div v-if="app.modelModalOpen" class="modal-backdrop model-backdrop" @mousedown.self="app.closeModelModal">
    <a-scrollbar outer-class="connection-modal model-modal" class="connection-modal-container" :disable-horizontal="true">
      <form role="dialog" aria-modal="true" aria-labelledby="model-modal-title" @submit.prevent="app.saveModelDraft" @keydown.esc.prevent="app.closeModelModal">
        <div class="modal-header">
          <h2 id="model-modal-title">{{ app.modelDraftOriginalId ? '编辑模型' : '添加模型' }}</h2>
          <button type="button" aria-label="关闭" title="关闭" @click="app.closeModelModal">×</button>
        </div>
        <label for="provider-model-id-input">
          模型 ID
          <input id="provider-model-id-input" v-model="app.modelDraftId" autofocus autocomplete="off" placeholder="gpt-4.1-mini" @input="app.modelDraftError = ''"/>
        </label>
        <label for="provider-model-display-name-input">
          显示名称（可选）
          <input id="provider-model-display-name-input" v-model="app.modelDraftDisplayName" autocomplete="off" placeholder="GPT-4.1 Mini"/>
        </label>
        <label for="provider-model-description-input">
          模型介绍（可选）
          <textarea id="provider-model-description-input" v-model="app.modelDraftDescription" rows="3" placeholder="模型能力或用途"></textarea>
        </label>
        <label class="checkbox-row">
          <input v-model="app.modelDraftIsImage" type="checkbox"/>
          <span>生图模型</span>
        </label>
        <label for="provider-model-context-input">
          上下文长度
          <input id="provider-model-context-input" v-model.number="app.modelDraftContextLength" type="number" min="1" step="1"/>
        </label>
        <p v-if="app.modelDraftError" class="modal-error">{{ app.modelDraftError }}</p>
        <div class="modal-actions">
          <button type="button" class="modal-cancel" @click="app.closeModelModal">取消</button>
          <button type="submit" class="modal-save">{{ app.modelDraftOriginalId ? '保存修改' : '添加模型' }}</button>
        </div>
      </form>
    </a-scrollbar>
  </div>
</template>
