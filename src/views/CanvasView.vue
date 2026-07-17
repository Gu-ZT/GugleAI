<script setup lang="ts">
import {Handle, Position, VueFlow} from "@vue-flow/core";
import {IconClose, IconPlus, IconStop} from "@arco-design/web-vue/es/icon";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

defineProps<{app: any}>();
</script>

<template>
  <section class="canvas-workspace">
    <div class="workspace-toolbar canvas-toolbar">
      <div>
        <strong>无尽画布</strong>
        <span class="workspace-meta">{{ app.connectionProfiles.length }} 个 API 连接</span>
      </div>
      <div class="canvas-toolbar-actions">
        <a-button size="small" @click="app.addCanvasTextNode">＋文字节点</a-button>
        <a-button size="small" @click="app.addCanvasImageNode">＋图像节点</a-button>
        <a-button size="small" status="danger" :disabled="app.canvasNodes.length === 0" @click="app.clearCanvas">清空画布</a-button>
      </div>
    </div>
    <div class="canvas-shell">
      <VueFlow
          id="main-canvas"
          :nodes="app.canvasNodes"
          :edges="app.canvasEdges"
          class="canvas-flow"
          :min-zoom="0.2"
          :max-zoom="2.5"
          :default-viewport="{ x: 0, y: 0, zoom: 0.9 }"
          fit-view-on-init
          @connect="app.onCanvasConnect"
          @update:nodes="app.onCanvasNodesUpdate"
          @update:edges="app.onCanvasEdgesUpdate"
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
            <a-textarea v-model="data.text" class="nodrag" :auto-size="{ minRows: 5, maxRows: 10 }" placeholder="输入文字内容"/>
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
            <div class="canvas-node-config nodrag">
              <div class="canvas-node-model-field">
                <span>模型</span>
                <a-select
                    :model-value="app.canvasNodeModelSelection(data)"
                    :options="app.imageModelSelectOptions"
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
                <img :src="asset.url" :alt="asset.name" :title="asset.name"/>
                <a-button v-if="!data.readOnly" type="text" shape="circle" title="移除图片" @click.stop="app.removeCanvasReference(id, asset.id)"><IconClose/></a-button>
              </div>
            </div>
            <p v-else-if="data.readOnly" class="canvas-empty-image nodrag">暂无图片</p>
            <template v-if="!data.readOnly && data.references.length === 0">
              <a-textarea v-model="data.prompt" class="nodrag" :auto-size="{ minRows: 3, maxRows: 8 }" placeholder="描述要生成的图片"/>
              <div class="canvas-image-options nodrag">
                <a-button class="secondary-action" @click.stop="app.openCanvasImagePicker(id)"><template #icon><IconPlus/></template>添加参考图</a-button>
                <input :id="`canvas-image-input-${id}`" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="app.onCanvasImageFiles(id, $event)"/>
                <label>数量 <a-input-number v-model="data.count" :min="1" :max="10" @click.stop/></label>
              </div>
              <div class="canvas-node-actions nodrag">
                <span v-if="data.status === 'success'" class="canvas-node-success">已生成</span>
                <span v-if="data.status === 'running'" class="canvas-node-status">生成中...</span>
                <a-button v-if="data.status === 'running'" status="danger" @click.stop="app.stopCanvasNode(id)"><template #icon><IconStop/></template>停止</a-button>
                <a-button v-else type="primary" @click.stop="app.generateCanvasImage(id)">生成图片</a-button>
              </div>
            </template>
            <div v-else-if="!data.readOnly" class="canvas-reference-actions nodrag">
              <span>参考图节点</span>
              <a-button class="secondary-action" @click.stop="app.openCanvasImagePicker(id)"><template #icon><IconPlus/></template>添加图片</a-button>
              <input :id="`canvas-image-input-${id}`" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="app.onCanvasImageFiles(id, $event)"/>
            </div>
            <Handle type="source" :position="Position.Right" />
          </div>
        </template>
      </VueFlow>
    </div>
  </section>
</template>
