<script setup lang="ts">
import {Handle, Position, VueFlow} from "@vue-flow/core";
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
              <button type="button" class="canvas-node-delete nodrag" title="删除节点" @click.stop="app.deleteCanvasNode(id)">×</button>
            </div>
            <div class="canvas-node-config nodrag">
              <label>
                API 连接
                <select :value="data.connectionId" @change="app.onCanvasNodeConnectionChange(id, $event)">
                  <option v-for="profile in app.connectionProfiles" :key="profile.id" :value="profile.id">
                    {{ profile.endpoint }} · {{ app.maskApiKey(profile.apiKey) }}
                  </option>
                </select>
              </label>
              <label>
                模型
                <select v-model="data.model">
                  <option v-for="modelName in app.canvasConnectionModels(data.connectionId)" :key="modelName" :value="modelName">
                    {{ modelName }}
                  </option>
                </select>
              </label>
            </div>
            <textarea v-model="data.text" class="nodrag" rows="5" placeholder="输入文字内容"></textarea>
            <p v-if="data.error" class="canvas-node-error nodrag">{{ data.error }}</p>
            <div class="canvas-node-actions nodrag">
              <span v-if="data.status === 'success'" class="canvas-node-success">已生成</span>
              <span v-if="data.status === 'running'" class="canvas-node-status">生成中...</span>
              <button v-if="data.status === 'running'" type="button" class="node-stop" @click.stop="app.stopCanvasNode(id)">停止</button>
              <button v-else type="button" class="node-generate" @click.stop="app.generateCanvasText(id)">生成文字</button>
            </div>
            <Handle type="source" :position="Position.Right" />
          </div>
        </template>

        <template #node-image="{ id, data }">
          <div class="canvas-node canvas-image-node" :class="{ readonly: data.readOnly }">
            <Handle type="target" :position="Position.Left" />
            <div class="canvas-node-header">
              <strong>{{ data.title }}</strong>
              <button type="button" class="canvas-node-delete nodrag" title="删除节点" @click.stop="app.deleteCanvasNode(id)">×</button>
            </div>
            <div class="canvas-node-config nodrag">
              <label>
                API 连接
                <select :value="data.connectionId" @change="app.onCanvasNodeConnectionChange(id, $event)">
                  <option v-for="profile in app.connectionProfiles" :key="profile.id" :value="profile.id">
                    {{ profile.endpoint }} · {{ app.maskApiKey(profile.apiKey) }}
                  </option>
                </select>
              </label>
              <label>
                模型
                <select v-model="data.model">
                  <option v-for="modelName in app.canvasConnectionModels(data.connectionId)" :key="modelName" :value="modelName">
                    {{ modelName }}
                  </option>
                </select>
              </label>
            </div>
            <div v-if="data.references.length" class="canvas-node-images nodrag">
              <div v-for="asset in data.references" :key="asset.id" class="canvas-node-image">
                <img :src="asset.url" :alt="asset.name" :title="asset.name"/>
                <button v-if="!data.readOnly" type="button" @click.stop="app.removeCanvasReference(id, asset.id)">×</button>
              </div>
            </div>
            <p v-else-if="data.readOnly" class="canvas-empty-image nodrag">暂无图片</p>
            <template v-if="!data.readOnly && data.references.length === 0">
              <textarea v-model="data.prompt" class="nodrag" rows="3" placeholder="描述要生成的图片"></textarea>
              <div class="canvas-image-options nodrag">
                <button type="button" class="secondary-action" @click.stop="app.openCanvasImagePicker(id)">添加参考图</button>
                <input :id="`canvas-image-input-${id}`" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="app.onCanvasImageFiles(id, $event)"/>
                <label>数量 <input v-model.number="data.count" type="number" min="1" max="10" @click.stop/></label>
              </div>
              <div class="canvas-node-actions nodrag">
                <span v-if="data.status === 'success'" class="canvas-node-success">已生成</span>
                <span v-if="data.status === 'running'" class="canvas-node-status">生成中...</span>
                <button v-if="data.status === 'running'" type="button" class="node-stop" @click.stop="app.stopCanvasNode(id)">停止</button>
                <button v-else type="button" class="node-generate" @click.stop="app.generateCanvasImage(id)">生成图片</button>
              </div>
            </template>
            <div v-else-if="!data.readOnly" class="canvas-reference-actions nodrag">
              <span>参考图节点</span>
              <button type="button" class="secondary-action" @click.stop="app.openCanvasImagePicker(id)">添加图片</button>
              <input :id="`canvas-image-input-${id}`" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="app.onCanvasImageFiles(id, $event)"/>
            </div>
            <Handle type="source" :position="Position.Right" />
          </div>
        </template>
      </VueFlow>
    </div>
  </section>
</template>
