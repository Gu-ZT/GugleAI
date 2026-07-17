<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";
import {IconClose} from "@arco-design/web-vue/es/icon";

const props = defineProps<{app: any}>();
const contextMenu = ref<HTMLElement>();

function closeOnOutsidePointer(event: PointerEvent) {
  if (!contextMenu.value?.contains(event.target as Node)) props.app.closeResultContextMenu();
}

onMounted(() => document.addEventListener("pointerdown", closeOnOutsidePointer));
onUnmounted(() => document.removeEventListener("pointerdown", closeOnOutsidePointer));
</script>

<template>
  <div
      v-if="app.resultContextMenu"
      ref="contextMenu"
      class="result-context-menu"
      role="menu"
      :style="{ left: `${app.resultContextMenu.x}px`, top: `${app.resultContextMenu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
  >
    <a-button
        type="text"
        role="menuitem"
        :disabled="!app.resultContextMenu.image.prompt"
        :title="app.resultContextMenu.image.prompt ? '' : '旧版本预览未保存提示词'"
        @click="app.copyResultPrompt(app.resultContextMenu.image)"
    >复制提示词</a-button>
    <a-button type="text" role="menuitem" @click="app.copyResultImage(app.resultContextMenu.image)">复制到剪贴板</a-button>
    <a-button type="text" role="menuitem" @click="app.setResultAsReference(app.resultContextMenu.image)">设置为参考图</a-button>
    <a-button type="text" role="menuitem" @click="app.saveResultFromContextMenu(app.resultContextMenu.image)">保存图片</a-button>
    <a-button type="text" status="danger" class="context-delete" role="menuitem" @click="app.deleteResultFromContextMenu(app.resultContextMenu.image)">删除图片</a-button>
  </div>

  <div
      v-if="app.enlargedResult"
      class="result-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="放大预览"
      @mousedown.self="app.closeResultLightbox"
      @wheel.stop
  >
    <a-button type="text" shape="circle" class="lightbox-close" aria-label="关闭放大预览" title="关闭" @click="app.closeResultLightbox"><IconClose/></a-button>
    <img :src="app.enlargedResult.previewUrl" alt="放大的生成结果" @dblclick.prevent="app.closeResultLightbox"/>
  </div>
</template>
