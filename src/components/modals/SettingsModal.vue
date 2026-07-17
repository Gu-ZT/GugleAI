<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";

const props = defineProps<{app: any}>();
const connectionPicker = ref<HTMLElement>();
const modelPicker = ref<HTMLElement>();
const retryStatusCodePicker = ref<HTMLElement>();

function closePickerMenus(event: PointerEvent) {
  const target = event.target as Node;
  if (!connectionPicker.value?.contains(target)) props.app.connectionMenuOpen = false;
  if (!modelPicker.value?.contains(target)) {
    props.app.modelMenuOpen = false;
    props.app.modelShowAll = true;
  }
  if (!retryStatusCodePicker.value?.contains(target)) {
    props.app.retryStatusCodeMenuOpen = false;
  }
}

function close() {
  props.app.settingsModalOpen = false;
  props.app.connectionMenuOpen = false;
  props.app.modelMenuOpen = false;
  props.app.retryStatusCodeMenuOpen = false;
}

onMounted(() => document.addEventListener("pointerdown", closePickerMenus));
onUnmounted(() => document.removeEventListener("pointerdown", closePickerMenus));
</script>

<template>
  <div v-if="app.settingsModalOpen" class="modal-backdrop settings-backdrop" @mousedown.self="close">
    <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title" @keydown.esc.prevent="close">
      <div class="modal-header">
        <h2 id="settings-modal-title">设置</h2>
        <button type="button" aria-label="关闭" title="关闭" @click="close">×</button>
      </div>

      <div class="settings-body">
        <h3>连接设置</h3>
        <div class="field">
          <label id="connection-picker-label">API 连接</label>
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

        <div v-if="app.appMode !== 'chat'" class="field">
          <label for="model-input">模型 ID</label>
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

        <div v-if="app.appMode !== 'image'" class="field text-model-field">
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

        <label v-if="app.appMode !== 'chat'">
          接口模式
          <select v-model="app.apiMode">
            <option value="auto">自动（多参考图走 Chat）</option>
            <option value="images">Images 接口</option>
            <option value="chat">Chat 接口</option>
          </select>
        </label>

        <h3>请求重试</h3>
        <label class="checkbox-row">
          <input v-model="app.retryEnabled" type="checkbox"/><span>自动重试</span>
        </label>
        <div class="field">
          <label for="retry-status-code-input">重试错误码</label>
          <div ref="retryStatusCodePicker" class="combo-picker">
            <div class="combo-control combo-control-multi" :class="{ open: app.retryStatusCodeMenuOpen, disabled: !app.retryEnabled }">
              <div class="combo-values">
                <button
                    v-for="code in app.retryStatusCodes"
                    :key="code"
                    type="button"
                    class="status-code-chip"
                    :disabled="!app.retryEnabled"
                    @click="app.toggleRetryStatusCode(code)"
                >{{ code }}<span aria-hidden="true">×</span></button>
                <input
                    id="retry-status-code-input"
                    v-model="app.retryStatusCodeInput"
                    :disabled="!app.retryEnabled"
                    inputmode="numeric"
                    maxlength="3"
                    autocomplete="off"
                    placeholder="输入错误码"
                    @focus="app.retryStatusCodeMenuOpen = true"
                    @input="app.retryStatusCodeMenuOpen = true"
                    @keydown.enter.prevent="app.addRetryStatusCode"
                />
              </div>
              <button type="button" class="combo-toggle" aria-label="展开错误码选项" :disabled="!app.retryEnabled" @click="app.retryStatusCodeMenuOpen = !app.retryStatusCodeMenuOpen">
                <span class="chevron" aria-hidden="true"></span>
              </button>
            </div>
            <div v-if="app.retryStatusCodeMenuOpen && app.retryEnabled" class="combo-menu">
              <div v-for="code in app.filteredRetryStatusCodeOptions" :key="code" class="combo-option-row" :class="{ selected: app.retryStatusCodes.includes(code) }">
                <label class="combo-checkbox-option">
                  <input type="checkbox" :checked="app.retryStatusCodes.includes(code)" @change="app.toggleRetryStatusCode(code)"/>
                  <span>{{ code }}</span>
                </label>
                <button
                    v-if="!app.DEFAULT_RETRY_STATUS_CODE_OPTIONS.includes(code)"
                    type="button"
                    class="combo-remove-option"
                    title="删除自定义选项"
                    @click="app.removeRetryStatusCodeOption(code)"
                >×</button>
              </div>
              <button v-if="app.showRetryStatusCodeInputAction" type="button" class="combo-add" @click="app.addRetryStatusCode">
                <span aria-hidden="true">＋</span><span>添加并选择 {{ app.retryStatusCodeInputValue }}</span>
              </button>
              <p v-if="app.filteredRetryStatusCodeOptions.length === 0 && !app.showRetryStatusCodeInputAction" class="combo-empty">无匹配项</p>
            </div>
          </div>
        </div>
        <label>
          重试次数
          <input v-model.number="app.retryCount" :disabled="!app.retryEnabled" type="number" min="1" max="20"/>
        </label>

        <template v-if="app.appMode !== 'chat'">
          <h3>生成参数</h3>
          <label>
            尺寸
            <select v-model="app.size">
              <option value="auto">自动</option>
              <option value="1024x1024">1024×1024</option>
              <option value="1536x1024">1536×1024 (横)</option>
              <option value="1024x1536">1024×1536 (竖)</option>
            </select>
          </label>
          <label>数量 <input v-model.number="app.count" type="number" min="1" max="10"/></label>
        </template>

        <h3>更新与日志</h3>
        <label class="checkbox-row">
          <input v-model="app.autoCheckUpdate" type="checkbox"/><span>启动时自动检查更新</span>
        </label>
        <button class="log-btn" :disabled="app.checkingUpdate" @click="app.checkUpdate(true)">
          {{ app.checkingUpdate ? "检查中..." : "检查更新" }}
        </button>
        <p v-if="app.updateStatus" class="update-status">
          {{ app.updateStatus }}
          <a v-if="app.updateUrl" href="#" @click.prevent="app.openDownloadPage">前往下载</a>
        </p>
        <button class="log-btn view-log" @click="app.showLogs = !app.showLogs">
          {{ app.showLogs ? "隐藏日志" : "查看日志" }}
        </button>
        <div v-if="app.showLogs" class="log-panel settings-log-panel">
          <div class="log-header">
            <span>运行日志（本次会话 {{ app.logs.length }} 条）</span>
            <button @click="app.openLogFile">打开日志文件</button>
          </div>
          <p v-if="app.logFilePath" class="log-path">{{ app.logFilePath }}</p>
          <pre class="log-body">{{ app.logs.length ? app.logs.join("\n") : "暂无日志" }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>
