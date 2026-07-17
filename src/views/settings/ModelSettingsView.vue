<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <div class="settings-section provider-settings-section">
    <h2>模型设置</h2>
    <div class="provider-settings-layout">
      <aside class="provider-sidebar" aria-label="提供商列表">
        <div class="provider-list">
          <button
              v-for="provider in app.connectionProfiles"
              :key="provider.id"
              type="button"
              class="provider-list-item"
              :class="{ active: app.selectedProviderId === provider.id }"
              :title="provider.name"
              @click="app.selectProvider(provider.id)"
          >
            <span>{{ provider.name }}</span>
            <small>{{ provider.models.length }} 个模型</small>
          </button>
        </div>
        <button type="button" class="provider-add-button" @click="app.openConnectionModal()">＋ 添加提供商</button>
      </aside>

      <section v-if="app.selectedProvider" class="provider-detail">
        <div class="provider-detail-header">
          <div>
            <h3>{{ app.selectedProvider.name }}</h3>
            <span>{{ app.selectedProvider.endpoint }}</span>
          </div>
          <div class="provider-detail-actions">
            <button type="button" class="secondary-action" @click="app.openConnectionModal(app.selectedProvider)">编辑</button>
            <button
                type="button"
                class="danger-action"
                :disabled="app.connectionProfiles.length <= 1"
                @click="app.removeConnection(app.selectedProvider)"
            >删除</button>
          </div>
        </div>

        <div class="provider-key-summary">API Key {{ app.maskApiKey(app.selectedProvider.apiKey) }}</div>

        <div class="provider-model-toolbar">
          <strong>模型列表</strong>
          <button type="button" class="secondary-action" @click="app.openModelModal(app.selectedProvider.id)">＋ 添加模型</button>
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
      </section>
    </div>
  </div>
</template>
