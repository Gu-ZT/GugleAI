<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";

const props = defineProps<{app: any}>();
const connectionPicker = ref<HTMLElement>();
const modelPicker = ref<HTMLElement>();

function closePickerMenus(event: PointerEvent) {
  const target = event.target as Node;
  if (!connectionPicker.value?.contains(target)) props.app.connectionMenuOpen = false;
  if (!modelPicker.value?.contains(target)) {
    props.app.modelMenuOpen = false;
    props.app.modelShowAll = true;
  }
}

onMounted(() => document.addEventListener("pointerdown", closePickerMenus));
onUnmounted(() => document.removeEventListener("pointerdown", closePickerMenus));
</script>

<template>
  <div class="settings-section">
    <h2>模型设置</h2>
    <div class="settings-form-grid">
      <h3>API 连接</h3>
      <div class="field settings-form-wide">
        <label id="connection-picker-label">当前连接</label>
        <div ref="connectionPicker" class="combo-picker">
          <button
              type="button"
              class="connection-control"
              :class="{ open: app.connectionMenuOpen }"
              aria-haspopup="listbox"
              :aria-expanded="app.connectionMenuOpen"
              aria-labelledby="connection-picker-label"
              @click="app.connectionMenuOpen = !app.connectionMenuOpen"
          >
            <span class="connection-summary">
              <span class="connection-endpoint" :title="app.endpoint">{{ app.endpoint }}</span>
              <span class="connection-key">Key {{ app.maskApiKey(app.apiKey) }}</span>
            </span>
            <span class="connection-chevron" aria-hidden="true"><span class="chevron"></span></span>
          </button>
          <div v-if="app.connectionMenuOpen" class="combo-menu" role="listbox">
            <div
                v-for="profile in app.connectionProfiles"
                :key="profile.id"
                class="combo-option-row connection-option-row"
                :class="{ selected: app.activeConnectionId === profile.id }"
            >
              <button
                  type="button"
                  class="combo-option-main connection-option"
                  role="option"
                  :aria-selected="app.activeConnectionId === profile.id"
                  @click="app.selectConnection(profile)"
              >
                <span class="connection-option-content">
                  <span class="connection-endpoint" :title="profile.endpoint">{{ profile.endpoint }}</span>
                  <span class="connection-key">Key {{ app.maskApiKey(profile.apiKey) }}</span>
                </span>
                <span v-if="app.activeConnectionId === profile.id" class="combo-check" aria-hidden="true">✓</span>
              </button>
              <button type="button" class="combo-edit-option" title="编辑连接" @click.stop="app.openConnectionModal(profile)">编辑</button>
              <button
                  v-if="app.connectionProfiles.length > 1"
                  type="button"
                  class="combo-remove-option"
                  title="删除连接"
                  @click="app.removeConnection(profile)"
              >×</button>
            </div>
            <button type="button" class="combo-add" @click="app.openConnectionModal()">
              <span aria-hidden="true">＋</span><span>添加连接</span>
            </button>
          </div>
        </div>
      </div>

      <h3>默认模型</h3>
      <div class="field">
        <label for="model-input">图像模型</label>
        <div ref="modelPicker" class="combo-picker">
          <div class="combo-control" :class="{ open: app.modelMenuOpen }">
            <input
                id="model-input"
                v-model="app.model"
                role="combobox"
                autocomplete="off"
                placeholder="gpt-image-2"
                @focus="app.modelMenuOpen = true; app.modelShowAll = true"
                @input="app.modelMenuOpen = true; app.modelShowAll = false"
                @keydown.enter.prevent="app.addModelOption"
                @keydown.esc="app.modelMenuOpen = false"
            />
            <button type="button" class="combo-toggle" aria-label="展开模型选项" @click="app.modelMenuOpen = !app.modelMenuOpen; app.modelShowAll = true">
              <span class="chevron" aria-hidden="true"></span>
            </button>
          </div>
          <div v-if="app.modelMenuOpen" class="combo-menu" role="listbox">
            <div v-for="option in app.filteredModelOptions" :key="option" class="combo-option-row" :class="{ selected: app.model === option }">
              <button type="button" class="combo-option-main" role="option" :title="option" @click="app.selectModelOption(option)">
                <span class="combo-option-text">{{ option }}</span>
                <span v-if="app.model === option" class="combo-check" aria-hidden="true">✓</span>
              </button>
              <button
                  v-if="!app.DEFAULT_MODEL_OPTIONS.includes(option)"
                  type="button"
                  class="combo-remove-option"
                  title="删除自定义选项"
                  @click="app.removeModelOption(option)"
              >×</button>
            </div>
            <button v-if="app.canAddModelOption" type="button" class="combo-add" @click="app.addModelOption">
              <span aria-hidden="true">＋</span><span class="combo-option-text">添加“{{ app.model.trim() }}”</span>
            </button>
          </div>
        </div>
      </div>

      <div class="field text-model-field">
        <label for="text-model-input">文字模型</label>
        <input
            id="text-model-input"
            v-model="app.textModel"
            list="text-model-options"
            autocomplete="off"
            placeholder="gpt-4o-mini"
            @change="app.addTextModelOption"
            @keydown.enter.prevent="app.addTextModelOption"
        />
        <datalist id="text-model-options">
          <option v-for="option in app.textModelOptions" :key="option" :value="option"></option>
        </datalist>
      </div>
    </div>
  </div>
</template>
