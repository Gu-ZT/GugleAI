<script setup lang="ts">
import {IconClose} from "@arco-design/web-vue/es/icon";

defineProps<{app: any}>();
</script>

<template>
  <div v-if="app.modelModalOpen" class="modal-backdrop model-backdrop" @mousedown.self="app.closeModelModal">
    <a-scrollbar outer-class="connection-modal model-modal" class="connection-modal-container" :disable-horizontal="true">
      <form role="dialog" aria-modal="true" aria-labelledby="model-modal-title" @submit.prevent="app.saveModelDraft" @keydown.esc.prevent="app.closeModelModal">
        <div class="modal-header">
          <h2 id="model-modal-title">{{ app.modelDraftOriginalId ? '编辑模型' : '添加模型' }}</h2>
          <a-button type="text" shape="circle" aria-label="关闭" title="关闭" @click="app.closeModelModal"><IconClose/></a-button>
        </div>
        <label for="provider-model-id-input">
          模型 ID
          <a-input id="provider-model-id-input" v-model="app.modelDraftId" autofocus autocomplete="off" placeholder="gpt-4.1-mini" @input="app.modelDraftError = ''"/>
        </label>
        <label for="provider-model-display-name-input">
          显示名称（可选）
          <a-input id="provider-model-display-name-input" v-model="app.modelDraftDisplayName" autocomplete="off" placeholder="GPT-4.1 Mini"/>
        </label>
        <label for="provider-model-description-input">
          模型介绍（可选）
          <a-textarea id="provider-model-description-input" v-model="app.modelDraftDescription" :auto-size="{ minRows: 3, maxRows: 6 }" placeholder="模型能力或用途"/>
        </label>
        <a-checkbox v-model="app.modelDraftIsImage" class="checkbox-row">生图模型</a-checkbox>
        <label for="provider-model-context-input">
          上下文长度
          <a-input-number id="provider-model-context-input" v-model="app.modelDraftContextLength" :min="1" :step="1"/>
        </label>
        <p v-if="app.modelDraftError" class="modal-error">{{ app.modelDraftError }}</p>
        <div class="modal-actions">
          <a-button class="modal-cancel" @click="app.closeModelModal">取消</a-button>
          <a-button type="primary" html-type="submit" class="modal-save">{{ app.modelDraftOriginalId ? '保存修改' : '添加模型' }}</a-button>
        </div>
      </form>
    </a-scrollbar>
  </div>
</template>
