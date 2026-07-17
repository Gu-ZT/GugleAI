<script setup lang="ts">
import {computed, ref} from "vue";
import {IconDelete, IconPlus} from "@arco-design/web-vue/es/icon";
import PromptVariables from "../../components/settings/PromptVariables.vue";

const props = defineProps<{app: any}>();
const activeSection = ref<"canvas" | "chat">("canvas");
const editingAgentId = ref(props.app.defaultChatAgentId);
const editingAgent = computed(() => props.app.chatAgents.find(
    (agent: any) => agent.id === editingAgentId.value
) ?? props.app.chatAgents[0]);

function addAgent() {
  editingAgentId.value = props.app.addChatAgent();
}

function removeAgent() {
  const agent = editingAgent.value;
  if (!agent || agent.isDefault) return;
  if (!window.confirm(`确定删除智能体“${agent.name || "未命名智能体"}”吗？`)) return;
  props.app.removeChatAgent(agent.id);
  editingAgentId.value = props.app.defaultChatAgentId;
}
</script>

<template>
  <div class="settings-section agent-settings-section">
    <h2>智能体设置</h2>
    <a-tabs v-model:active-key="activeSection" type="line" class="agent-settings-tabs">
      <a-tab-pane key="canvas" title="无尽画布">
        <section class="agent-prompt-editor">
          <div class="agent-editor-heading">
            <div>
              <span>无尽画布</span>
              <strong>提示词生成</strong>
            </div>
          </div>
          <label>
            系统提示词
            <a-textarea
                v-model="app.canvasPromptSystemPrompt"
                :auto-size="{minRows: 8, maxRows: 18}"
                placeholder="输入画布文字节点生成时使用的系统提示词"
            />
          </label>
          <PromptVariables :variables="app.promptVariables"/>
        </section>
      </a-tab-pane>

      <a-tab-pane key="chat" title="聊天">
        <div class="chat-agent-settings-layout">
          <aside class="chat-agent-sidebar">
            <a-scrollbar outer-class="chat-agent-list" class="chat-agent-list-container" :disable-horizontal="true">
              <a-button
                  v-for="agent in app.chatAgents"
                  :key="agent.id"
                  type="text"
                  class="chat-agent-list-item"
                  :class="{active: editingAgent?.id === agent.id}"
                  @click="editingAgentId = agent.id"
              >
                <span>{{ agent.name || "未命名智能体" }}</span>
                <a-tag v-if="agent.isDefault" size="small">默认</a-tag>
              </a-button>
            </a-scrollbar>
            <a-button type="outline" class="chat-agent-add" @click="addAgent">
              <template #icon><IconPlus/></template>
              添加智能体
            </a-button>
          </aside>

          <section v-if="editingAgent" class="agent-prompt-editor chat-agent-editor">
            <div class="agent-editor-heading">
              <div>
                <span>聊天</span>
                <strong>{{ editingAgent.name || "未命名智能体" }}</strong>
              </div>
              <a-button
                  v-if="!editingAgent.isDefault"
                  type="text"
                  status="danger"
                  title="删除智能体"
                  @click="removeAgent"
              >
                <template #icon><IconDelete/></template>
                删除
              </a-button>
            </div>
            <label>
              名称
              <a-input v-model="editingAgent.name" :max-length="80" placeholder="智能体名称"/>
            </label>
            <label>
              系统提示词
              <a-textarea
                  v-model="editingAgent.systemPrompt"
                  :auto-size="{minRows: 10, maxRows: 20}"
                  placeholder="输入聊天时加入的系统提示词"
              />
            </label>
            <PromptVariables :variables="app.promptVariables"/>
          </section>
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>
