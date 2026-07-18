<script setup lang="ts">
import {onMounted, ref, watch} from "vue";
import {Handle, Position, VueFlow, type ViewportTransform, type VueFlowStore} from "@vue-flow/core";
import {
  IconArrowLeft,
  IconClose,
  IconDelete,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconStop,
} from "@arco-design/web-vue/es/icon";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = defineProps<{app: any}>();

const canvasSelectTriggerProps = ref(createCanvasSelectTriggerProps(0.6));
const mobileNodeMenuOpen = ref(false);
let canvasInstance: VueFlowStore | null = null;

watch(
    () => props.app.canvasViewport?.zoom,
    (zoom) => {
      if (Number.isFinite(zoom) && zoom > 0) {
        canvasSelectTriggerProps.value = createCanvasSelectTriggerProps(zoom);
      }
    },
    {immediate: true}
);

onMounted(async () => {
  await props.app.enterCanvasWorkspace();
  const zoom = Number(props.app.canvasViewport?.zoom);
  if (Number.isFinite(zoom) && zoom > 0) {
    canvasSelectTriggerProps.value = createCanvasSelectTriggerProps(zoom);
  }
});

function createCanvasSelectTriggerProps(zoom: number) {
  return {
    class: "canvas-model-popup",
    popupOffset: 4 * zoom,
    popupStyle: {
      transform: `scale(${zoom})`,
    },
  };
}

function onCanvasViewportChange(viewport: ViewportTransform) {
  canvasSelectTriggerProps.value = createCanvasSelectTriggerProps(viewport.zoom);
  props.app.updateCanvasViewport(viewport);
  props.app.closeCanvasImageContextMenu();
}

function onCanvasInit(instance: VueFlowStore) {
  canvasInstance = instance;
  canvasSelectTriggerProps.value = createCanvasSelectTriggerProps(instance.viewport.value.zoom);
}

function currentViewportCenter() {
  const flowElement = canvasInstance?.vueFlowRef.value;
  if (!canvasInstance || !flowElement) return undefined;
  const bounds = flowElement.getBoundingClientRect();
  return canvasInstance.screenToFlowCoordinate({
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  });
}

function addCanvasTextNode() {
  props.app.addCanvasTextNode(currentViewportCenter());
}

function addCanvasImageNode() {
  props.app.addCanvasImageNode(currentViewportCenter());
}
</script>

<template>
  <section class="canvas-workspace">
    <template v-if="app.canvasLibraryOpen">
      <div class="workspace-toolbar canvas-library-toolbar">
        <div>
          <strong>选择画布</strong>
          <span class="workspace-meta">无尽画布</span>
        </div>
        <a-button type="primary" size="small" :loading="app.canvasLibraryLoading" @click="app.createCanvas">
          <template #icon><IconPlus/></template>
          新建画布
        </a-button>
      </div>

      <div class="canvas-library">
        <a-spin :loading="app.canvasLibraryLoading" class="canvas-library-loading">
          <a-scrollbar
              outer-class="canvas-library-scroll"
              class="canvas-library-scroll-container"
              :disable-horizontal="true"
          >
            <div v-if="app.canvasDocuments.length" class="canvas-library-grid">
              <article
                  v-for="document in app.canvasDocuments"
                  :key="document.id"
                  class="canvas-library-card"
                  @dblclick="app.openCanvas(document.id)"
                  @contextmenu.prevent.stop="app.openCanvasDocumentContextMenu($event, document)"
              >
                <div class="canvas-card-preview">
                  <IconFolder class="canvas-library-icon" aria-hidden="true"/>
                  <span>{{ document.nodeCount }} 个节点</span>
                </div>
                <div class="canvas-card-info">
                  <strong>{{ document.name }}</strong>
                  <span>最后编辑 {{ app.formatCanvasUpdatedAt(document.updatedAt) }}</span>
                  <a-button size="small" long @click="app.openCanvas(document.id)">打开</a-button>
                </div>
              </article>
            </div>
            <a-empty v-else description="暂无画布"/>
          </a-scrollbar>
        </a-spin>
      </div>
    </template>

    <template v-else>
      <div class="workspace-toolbar canvas-toolbar">
        <div class="canvas-toolbar-title">
          <a-button
              type="text"
              shape="circle"
              title="返回画布列表"
              aria-label="返回画布列表"
              :disabled="app.canvasBusyCount > 0"
              @click="app.showCanvasLibrary"
          ><IconArrowLeft/></a-button>
          <div>
            <strong>{{ app.activeCanvas?.name }}</strong>
            <span class="workspace-meta">{{ app.connectionProfiles.length }} 个 API 连接</span>
          </div>
        </div>
        <div class="canvas-toolbar-actions canvas-desktop-actions">
          <a-button size="small" @click="addCanvasTextNode">
            <template #icon><IconPlus/></template>
            <span class="canvas-toolbar-label">文字节点</span>
          </a-button>
          <a-button size="small" @click="addCanvasImageNode">
            <template #icon><IconPlus/></template>
            <span class="canvas-toolbar-label">图像节点</span>
          </a-button>
          <a-button size="small" status="danger" :disabled="app.canvasNodes.length === 0" @click="app.clearCanvas">
            <template #icon><IconDelete/></template>
            <span class="canvas-toolbar-label">清空画布</span>
          </a-button>
        </div>
        <div class="canvas-mobile-node-menu">
          <a-button
              type="primary"
              shape="circle"
              class="canvas-mobile-add-toggle"
              :class="{open: mobileNodeMenuOpen}"
              :aria-expanded="mobileNodeMenuOpen"
              title="画布操作"
              aria-label="画布操作"
              @click="mobileNodeMenuOpen = !mobileNodeMenuOpen"
          ><IconPlus/></a-button>
          <div v-if="mobileNodeMenuOpen" class="canvas-mobile-node-options">
            <a-button @click="addCanvasTextNode(); mobileNodeMenuOpen = false">
              <template #icon><IconPlus/></template>文字节点
            </a-button>
            <a-button @click="addCanvasImageNode(); mobileNodeMenuOpen = false">
              <template #icon><IconPlus/></template>图像节点
            </a-button>
            <a-button status="danger" :disabled="app.canvasNodes.length === 0" @click="app.clearCanvas(); mobileNodeMenuOpen = false">
              <template #icon><IconDelete/></template>清空画布
            </a-button>
          </div>
        </div>
      </div>
      <div class="canvas-shell">
        <VueFlow
            :key="app.activeCanvas?.id"
            id="main-canvas"
            :nodes="app.canvasNodes"
            :edges="app.canvasEdges"
            class="canvas-flow"
            :min-zoom="0.2"
            :max-zoom="2.5"
            :default-viewport="app.canvasViewport"
            @init="onCanvasInit"
            @viewport-change="onCanvasViewportChange"
            @connect="app.onCanvasConnect"
            @update:nodes="app.onCanvasNodesUpdate"
            @update:edges="app.onCanvasEdgesUpdate"
            @edge-double-click="app.onCanvasEdgeDoubleClick"
        >
          <template #node-text="{ id, data }">
            <div class="canvas-node canvas-text-node">
              <Handle type="target" :position="Position.Left" />
              <div class="canvas-node-header">
                <strong>{{ data.title }}</strong>
                <a-button type="text" shape="circle" class="canvas-node-delete nodrag" title="删除节点" @click.stop="app.deleteCanvasNode(id)"><IconClose/></a-button>
              </div>
              <div class="canvas-node-config nodrag">
                <div class="canvas-node-model-field">
                  <span>模型</span>
                  <a-select
                      :model-value="app.canvasNodeModelSelection(data)"
                      :options="app.textModelSelectOptions"
                      :trigger-props="canvasSelectTriggerProps"
                      class="model-provider-select"
                      @change="app.onCanvasNodeModelChange(id, $event)"
                  >
                    <template #label="{data: selectedOption}">
                      <span class="selected-model-label">{{ selectedOption.label }}</span>
                      <a-tag v-if="selectedOption.providerName" size="small" class="model-provider-tag">{{ selectedOption.providerName }}</a-tag>
                    </template>
                  </a-select>
                </div>
              </div>
              <a-textarea
                  :model-value="data.text"
                  class="nodrag"
                  :auto-size="{ minRows: 5, maxRows: 10 }"
                  placeholder="输入文字内容"
                  @update:model-value="app.updateCanvasNodeData(id, {text: $event})"
              />
              <p v-if="data.error" class="canvas-node-error nodrag">{{ data.error }}</p>
              <div class="canvas-node-actions nodrag">
                <span v-if="data.status === 'success'" class="canvas-node-success">已生成</span>
                <span v-if="data.status === 'running'" class="canvas-node-status">生成中...</span>
                <a-button v-if="data.status === 'running'" status="danger" @click.stop="app.stopCanvasNode(id)"><template #icon><IconStop/></template>停止</a-button>
                <a-button v-else type="primary" @click.stop="app.generateCanvasText(id)">生成文字</a-button>
              </div>
              <Handle type="source" :position="Position.Right" />
            </div>
          </template>

          <template #node-image="{ id, data }">
            <div class="canvas-node canvas-image-node" :class="{ readonly: data.readOnly }">
              <Handle type="target" :position="Position.Left" />
              <div class="canvas-node-header">
                <strong>{{ data.title }}</strong>
                <a-button type="text" shape="circle" class="canvas-node-delete nodrag" title="删除节点" @click.stop="app.deleteCanvasNode(id)"><IconClose/></a-button>
              </div>
              <div v-if="data.references.length === 0" class="canvas-node-config nodrag">
                <div class="canvas-node-model-field">
                  <span>模型</span>
                  <a-select
                      :model-value="app.canvasNodeModelSelection(data)"
                      :options="app.imageModelSelectOptions"
                      :trigger-props="canvasSelectTriggerProps"
                      class="model-provider-select"
                      @change="app.onCanvasNodeModelChange(id, $event)"
                  >
                    <template #label="{data: selectedOption}">
                      <span class="selected-model-label">{{ selectedOption.label }}</span>
                      <a-tag v-if="selectedOption.providerName" size="small" class="model-provider-tag">{{ selectedOption.providerName }}</a-tag>
                    </template>
                  </a-select>
                </div>
              </div>
              <div v-if="data.references.length" class="canvas-node-images nodrag">
                <div v-for="asset in data.references" :key="asset.id" class="canvas-node-image">
                  <img
                      :src="asset.url"
                      :alt="asset.name"
                      :title="asset.name"
                      @contextmenu.prevent.stop="app.openCanvasImageContextMenu($event, id, asset.id)"
                  />
                  <a-button v-if="!data.readOnly" type="text" shape="circle" title="移除图片" @click.stop="app.removeCanvasReference(id, asset.id)"><IconClose/></a-button>
                </div>
              </div>
              <p v-else-if="data.readOnly" class="canvas-empty-image nodrag">暂无图片</p>
              <template v-if="!data.readOnly && data.references.length === 0">
                <a-textarea
                    :model-value="data.prompt"
                    class="nodrag"
                    :auto-size="{ minRows: 3, maxRows: 8 }"
                    placeholder="描述要生成的图片"
                    @update:model-value="app.updateCanvasNodeData(id, {prompt: $event})"
                />
                <div class="canvas-image-options nodrag">
                  <a-button class="secondary-action" @click.stop="app.openCanvasImagePicker(id)"><template #icon><IconPlus/></template>添加参考图</a-button>
                  <input :id="`canvas-image-input-${id}`" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="app.onCanvasImageFiles(id, $event)"/>
                  <label class="canvas-count-option">
                    数量
                    <a-input-number
                        :model-value="data.count"
                        :min="1"
                        :max="10"
                        @click.stop
                        @update:model-value="app.updateCanvasNodeData(id, {count: $event})"
                    />
                  </label>
                </div>
                <div class="canvas-node-actions nodrag">
                  <span v-if="data.status === 'success'" class="canvas-node-success">已生成</span>
                  <span v-if="data.status === 'running'" class="canvas-node-status">生成中...</span>
                  <div class="canvas-size-action">
                    <span>尺寸</span>
                    <a-select
                        :model-value="data.size"
                        :trigger-props="canvasSelectTriggerProps"
                        :disabled="data.status === 'running'"
                        class="canvas-size-select"
                        @mousedown.stop
                        @pointerdown.stop
                        @click.stop
                        @update:model-value="app.updateCanvasNodeData(id, {size: $event})"
                    >
                      <a-option value="auto">自动</a-option>
                      <a-option value="1024x1024">1024×1024</a-option>
                      <a-option value="1536x1024">1536×1024（横）</a-option>
                      <a-option value="1024x1536">1024×1536（竖）</a-option>
                      <a-option value="custom">自定义</a-option>
                    </a-select>
                  </div>
                  <div v-if="data.size === 'custom'" class="canvas-custom-size-action">
                    <a-input-number
                        :model-value="data.customWidth"
                        :min="1"
                        :step="1"
                        :hide-button="true"
                        aria-label="自定义宽度"
                        @mousedown.stop
                        @pointerdown.stop
                        @click.stop
                        @update:model-value="app.updateCanvasNodeData(id, {customWidth: $event})"
                    />
                    <span aria-hidden="true">x</span>
                    <a-input-number
                        :model-value="data.customHeight"
                        :min="1"
                        :step="1"
                        :hide-button="true"
                        aria-label="自定义高度"
                        @mousedown.stop
                        @pointerdown.stop
                        @click.stop
                        @update:model-value="app.updateCanvasNodeData(id, {customHeight: $event})"
                    />
                  </div>
                  <a-button v-if="data.status === 'running'" status="danger" @click.stop="app.stopCanvasNode(id)"><template #icon><IconStop/></template>停止</a-button>
                  <a-button v-else type="primary" @click.stop="app.generateCanvasImage(id)">生成图片</a-button>
                </div>
              </template>
              <div v-else-if="!data.readOnly" class="canvas-reference-actions nodrag">
                <span>参考图节点</span>
                <a-button class="secondary-action" @click.stop="app.openCanvasImagePicker(id)"><template #icon><IconRefresh/></template>替换图片</a-button>
                <input :id="`canvas-image-input-${id}`" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="app.onCanvasImageFiles(id, $event)"/>
              </div>
              <Handle type="source" :position="Position.Right" />
            </div>
          </template>
        </VueFlow>
      </div>
    </template>

    <a-modal
        :visible="Boolean(app.canvasRenameTarget)"
        title="重命名画布"
        ok-text="保存"
        cancel-text="取消"
        :ok-loading="app.canvasRenameSaving"
        :mask-closable="!app.canvasRenameSaving"
        :closable="!app.canvasRenameSaving"
        :unmount-on-close="true"
        @ok="app.renameCanvasDocument"
        @cancel="app.cancelRenameCanvasDocument"
    >
      <label class="field">
        <span class="field-label">画布名称</span>
        <a-input
            v-model="app.canvasRenameDraft"
            :max-length="64"
            autofocus
            @press-enter="app.renameCanvasDocument"
        />
      </label>
      <p v-if="app.canvasRenameError" class="canvas-document-modal-error">{{ app.canvasRenameError }}</p>
    </a-modal>

    <a-modal
        :visible="Boolean(app.canvasDeleteTarget)"
        title="删除画布"
        ok-text="删除"
        cancel-text="取消"
        :ok-loading="app.canvasDeleteSaving"
        :ok-button-props="{ status: 'danger' }"
        :mask-closable="!app.canvasDeleteSaving"
        :closable="!app.canvasDeleteSaving"
        :unmount-on-close="true"
        @ok="app.confirmDeleteCanvasDocument"
        @cancel="app.cancelDeleteCanvasDocument"
    >
      <p class="canvas-delete-confirmation">
        确定删除“{{ app.canvasDeleteTarget?.name }}”吗？画布中的节点和图片将永久删除，此操作无法撤销。
      </p>
    </a-modal>
  </section>
</template>
