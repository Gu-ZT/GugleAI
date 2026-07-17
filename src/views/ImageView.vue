<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";

const props = defineProps<{app: any}>();

const fileInput = ref<HTMLInputElement>();
const retryStatusCodePicker = ref<HTMLElement>();
const advancedOpen = ref(false);

function closeRetryPicker(event: PointerEvent) {
  if (!retryStatusCodePicker.value?.contains(event.target as Node)) {
    props.app.retryStatusCodeMenuOpen = false;
  }
}

onMounted(() => document.addEventListener("pointerdown", closeRetryPicker));
onUnmounted(() => document.removeEventListener("pointerdown", closeRetryPicker));
</script>

<template>
  <section class="image-workspace">
    <section class="preview-panel" aria-label="预览区域">
      <div class="preview-toolbar">
        <span>{{ app.historyLoading ? "正在加载预览..." : `预览图片 ${app.results.length} 张` }}</span>
        <span v-if="app.loading" class="preview-status">{{ app.stopping ? "正在停止..." : "正在生成..." }}</span>
        <span v-if="app.previewNotice" class="preview-notice" role="status">{{ app.previewNotice }}</span>
        <button
            type="button"
            class="clear-results"
            :disabled="app.historyLoading || app.results.length === 0"
            @click="app.clearResultHistory"
        >清空预览</button>
      </div>
      <a-scrollbar outer-class="preview-scroll" class="preview-scroll-container">
        <div v-if="app.results.length" class="results">
          <div v-for="img in app.results" :key="img.id" class="result-card">
            <img
                :src="img.previewUrl"
                alt="生成结果"
                @dblclick.prevent="app.openResultLightbox(img)"
                @contextmenu.prevent="app.openResultContextMenu($event, img)"
            />
            <div class="result-actions">
              <button type="button" @click="app.saveImage(img)">保存</button>
              <button type="button" class="delete-result" @click="app.deleteResultImage(img)">删除</button>
            </div>
          </div>
        </div>
        <div v-else class="placeholder preview-placeholder">
          {{ app.historyLoading ? "正在加载预览..." : app.loading ? "正在生成,请稍候..." : "生成的图片将显示在这里" }}
        </div>
      </a-scrollbar>
    </section>

    <section class="image-generation-config" aria-labelledby="image-generation-config-title">
      <button
          id="image-generation-config-title"
          type="button"
          class="advanced-config-toggle"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
      >
        <span>高级配置</span>
        <span class="chevron" :class="{ open: advancedOpen }" aria-hidden="true"></span>
      </button>
      <div v-if="advancedOpen" class="image-generation-config-grid">
        <label>
          接口模式
          <select v-model="app.apiMode">
            <option value="auto">自动（多参考图走 Chat）</option>
            <option value="images">Images 接口</option>
            <option value="chat">Chat 接口</option>
          </select>
        </label>
        <label class="checkbox-row image-retry-toggle">
          <input v-model="app.retryEnabled" type="checkbox"/>
          <span>自动重试</span>
        </label>
        <div class="field">
          <label for="image-retry-status-code-input">重试错误码</label>
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
                    id="image-retry-status-code-input"
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
              <button
                  type="button"
                  class="combo-toggle"
                  aria-label="展开错误码选项"
                  :disabled="!app.retryEnabled"
                  @click="app.retryStatusCodeMenuOpen = !app.retryStatusCodeMenuOpen"
              ><span class="chevron" aria-hidden="true"></span></button>
            </div>
            <a-scrollbar
                v-if="app.retryStatusCodeMenuOpen && app.retryEnabled"
                outer-class="combo-menu"
                class="combo-menu-container"
                :disable-horizontal="true"
            >
              <div
                  v-for="code in app.filteredRetryStatusCodeOptions"
                  :key="code"
                  class="combo-option-row"
                  :class="{ selected: app.retryStatusCodes.includes(code) }"
              >
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
            </a-scrollbar>
          </div>
        </div>
        <label>
          重试次数
          <input v-model.number="app.retryCount" :disabled="!app.retryEnabled" type="number" min="1" max="20"/>
        </label>
      </div>
    </section>

    <div class="ref-images">
      <div v-for="(img, index) in app.refImages" :key="img.previewUrl" class="ref-thumb">
        <img :src="img.previewUrl" :alt="img.file.name" :title="img.file.name"/>
        <button class="remove" @click="app.removeImage(index)">×</button>
      </div>
      <button
          class="add-ref"
          :class="{ 'drag-over': app.dragOver }"
          title="添加参考图（可拖拽文件或 Ctrl+V 粘贴）"
          @click="fileInput?.click()"
          @dragover.prevent="app.dragOver = true"
          @dragleave="app.dragOver = false"
          @drop.prevent="app.onDrop"
      >＋</button>
      <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          @change="app.addImages"
      />
    </div>

    <div class="image-mode-hint">{{ app.hintText }}</div>

    <textarea
        v-model="app.prompt"
        class="image-prompt-input"
        rows="4"
        placeholder="描述你想生成的图片..."
        @keydown.ctrl.enter="app.generate"
    ></textarea>

    <p v-if="app.error" class="error">{{ app.error }}</p>

    <div class="image-primary-options">
      <label class="image-model-option">
        <span>模型</span>
        <a-select
            v-model="app.imageModelSelection"
            :options="app.imageModelSelectOptions"
            :disabled="app.imageModelGroups.length === 0"
            class="model-provider-select"
        >
          <template #label="{data}">
            <span class="selected-model-label">{{ data.label }}</span>
            <a-tag v-if="data.providerName" size="small" class="model-provider-tag">{{ data.providerName }}</a-tag>
          </template>
        </a-select>
      </label>
      <label class="image-size-option">
        尺寸
        <select v-model="app.size">
          <option value="auto">自动</option>
          <option value="1024x1024">1024×1024</option>
          <option value="1536x1024">1536×1024（横）</option>
          <option value="1024x1536">1024×1536（竖）</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      <div v-if="app.size === 'custom'" class="custom-size-inputs" aria-label="自定义尺寸">
        <label>
          宽度
          <input v-model.number="app.customWidth" type="number" min="1" step="1" inputmode="numeric"/>
        </label>
        <span aria-hidden="true">×</span>
        <label>
          高度
          <input v-model.number="app.customHeight" type="number" min="1" step="1" inputmode="numeric"/>
        </label>
      </div>
      <label class="image-count-option">
        数量
        <input v-model.number="app.count" type="number" min="1" max="10" step="1"/>
      </label>
      <button
          v-if="app.loading"
          type="button"
          class="stop-generation image-generate-action"
          :disabled="app.stopping"
          @click="app.stopGeneration"
      >
        <span class="stop-icon" aria-hidden="true"></span>
        {{ app.stopping ? "停止中..." : "停止" }}
      </button>
      <button v-else class="generate image-generate-action" @click="app.generate">生成 (Ctrl+Enter)</button>
    </div>
  </section>
</template>
