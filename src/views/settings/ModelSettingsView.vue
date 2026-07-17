<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div class="settings-section provider-settings-section">
    <h2>模型设置</h2>
    <div class="provider-settings-layout">
      <aside class="provider-sidebar" aria-label="提供商列表">
        <a-scrollbar outer-class="provider-list" class="provider-list-container" :disable-horizontal="true">
          <button
              v-for="provider in app.providerList"
              :key="provider.id"
              type="button"
              class="provider-list-item"
              :class="{ active: app.selectedProviderId === provider.id }"
              :title="provider.name"
              @click="app.selectProvider(provider.id)"
          >
            <span>{{ provider.name }}</span>
            <small v-if="app.providerDraftIsNew && app.selectedProviderId === provider.id">未保存</small>
            <small v-else>{{ provider.models.length }} 个模型</small>
          </button>
        </a-scrollbar>
        <button type="button" class="provider-add-button" @click="app.addProviderDraft">＋ 添加提供商</button>
      </aside>

      <a-scrollbar
          v-if="app.selectedProvider"
          outer-class="provider-detail"
          class="provider-detail-container"
          :disable-horizontal="true"
      >
        <form class="provider-editor" @submit.prevent="app.saveConnectionDraft">
          <div class="provider-detail-header">
            <h3>{{ app.providerDraftIsNew ? '添加提供商' : '提供商信息' }}</h3>
            <button
                v-if="!app.providerDraftIsNew"
                type="button"
                class="danger-action"
                :disabled="app.connectionProfiles.length <= 1 || app.hasUnsavedProviderChanges"
                @click="app.removeConnection(app.selectedProvider)"
            >删除</button>
          </div>

          <div class="provider-editor-fields">
            <label for="provider-name-input">
              提供商名称
              <input
                  id="provider-name-input"
                  v-model="app.connectionDraftName"
                  autocomplete="off"
                  placeholder="例如 OpenAI"
                  @input="app.connectionDraftError = ''"
              />
            </label>
            <label for="provider-endpoint-input">
              API 地址
              <input
                  id="provider-endpoint-input"
                  v-model="app.connectionDraftEndpoint"
                  autocomplete="off"
                  placeholder="https://api.openai.com/v1"
                  @input="app.connectionDraftError = ''"
              />
            </label>
            <label for="provider-api-key-input">
              API Key（可选）
              <input
                  id="provider-api-key-input"
                  v-model="app.connectionDraftApiKey"
                  type="password"
                  autocomplete="new-password"
                  placeholder="sk-..."
                  @input="app.connectionDraftError = ''"
              />
            </label>
          </div>
          <p v-if="app.connectionDraftError" class="provider-editor-error">{{ app.connectionDraftError }}</p>

          <div class="provider-model-toolbar">
            <strong>模型列表</strong>
            <button
                type="button"
                class="secondary-action"
                :disabled="app.providerDraftIsNew"
                :title="app.providerDraftIsNew ? '请先保存提供商' : '添加模型'"
                @click="app.openModelModal(app.selectedProvider.id)"
            >＋ 添加模型</button>
          </div>

          <div v-if="app.selectedProvider.models.length" class="provider-model-list">
            <article v-for="providerModel in app.selectedProvider.models" :key="providerModel.id" class="provider-model-row">
              <div class="provider-model-main">
                <strong>{{ app.modelDisplayName(providerModel) }}</strong>
                <code>{{ providerModel.id }}</code>
                <p v-if="providerModel.description">{{ providerModel.description }}</p>
                <div class="provider-model-meta">
                  <span>{{ providerModel.isImage ? '生图模型' : '文字模型' }}</span>
                  <span>上下文 {{ providerModel.contextLength.toLocaleString() }}</span>
                </div>
              </div>
              <div class="provider-model-actions">
                <button type="button" class="secondary-action" @click="app.openModelModal(app.selectedProvider.id, providerModel)">编辑</button>
                <button type="button" class="danger-action" @click="app.removeProviderModel(app.selectedProvider.id, providerModel.id)">删除</button>
              </div>
            </article>
          </div>
          <div v-else class="provider-model-empty">暂无模型</div>

          <div v-if="app.hasUnsavedProviderChanges" class="provider-draft-actions">
            <button type="button" class="modal-cancel" @click="app.cancelConnectionDraft">取消更改</button>
            <button type="submit" class="modal-save">保存更改</button>
          </div>
        </form>
      </a-scrollbar>
    </div>
  </div>
</template>
