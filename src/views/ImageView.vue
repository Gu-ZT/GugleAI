<script setup lang="ts">
import {ref} from "vue";

defineProps<{app: any}>();

const fileInput = ref<HTMLInputElement>();
</script>

<template>
  <section class="image-workspace">
    <div class="prompt-area">
      <textarea
          v-model="app.prompt"
          rows="4"
          placeholder="描述你想生成的图片..."
          @keydown.ctrl.enter="app.generate"
      ></textarea>

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

      <div class="actions">
        <span class="hint">{{ app.hintText }}</span>
        <div class="action-buttons">
          <button
              v-if="app.loading"
              type="button"
              class="stop-generation"
              :disabled="app.stopping"
              @click="app.stopGeneration"
          >
            <span class="stop-icon" aria-hidden="true"></span>
            {{ app.stopping ? "停止中..." : "停止" }}
          </button>
          <button class="generate" :disabled="app.loading" @click="app.generate">
            {{ app.loading ? "生成中..." : "生成 (Ctrl+Enter)" }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="app.error" class="error">{{ app.error }}</p>

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
      <div v-else class="placeholder">
        {{ app.historyLoading ? "正在加载预览..." : app.loading ? "正在生成,请稍候..." : "生成的图片将显示在这里" }}
      </div>
    </section>
  </section>
</template>
