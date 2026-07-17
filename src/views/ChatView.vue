<script setup lang="ts">
import {ref} from "vue";
import {IconCheck, IconCopy, IconDelete, IconEdit, IconPlus} from "@arco-design/web-vue/es/icon";

const props = defineProps<{app: any}>();
const editingConversationId = ref("");
const editingTitle = ref("");

function startRename(conversation: any) {
  editingConversationId.value = conversation.id;
  editingTitle.value = conversation.title;
}

function saveRename() {
  if (!editingConversationId.value) return;
  props.app.renameChatConversation(editingConversationId.value, editingTitle.value);
  editingConversationId.value = "";
  editingTitle.value = "";
}
</script>

<template>
  <section class="chat-workspace">
    <div class="chat-layout">
      <aside class="chat-conversation-sidebar" aria-label="聊天记录">
        <button type="button" class="new-conversation-button" :disabled="app.chatLoading" @click="app.createChatConversation">
          <IconPlus aria-hidden="true"/><span>新建对话</span>
        </button>
        <a-scrollbar outer-class="conversation-list" class="conversation-list-container" :disable-horizontal="true">
          <article
              v-for="conversation in app.chatConversations"
              :key="conversation.id"
              class="conversation-list-item"
              :class="{ active: app.activeChatConversationId === conversation.id }"
          >
            <form v-if="editingConversationId === conversation.id" class="conversation-rename" @submit.prevent="saveRename">
              <input v-model="editingTitle" autofocus maxlength="80" @keydown.esc="editingConversationId = ''"/>
              <button type="submit" title="保存名称" aria-label="保存名称"><IconCheck/></button>
            </form>
            <template v-else>
              <button type="button" class="conversation-select" :title="conversation.title" @click="app.selectChatConversation(conversation.id)" @dblclick="startRename(conversation)">
                <span>{{ conversation.title }}</span>
                <small>{{ conversation.messages.length }} 条消息</small>
              </button>
              <div class="conversation-item-actions">
                <button type="button" title="重命名" aria-label="重命名" @click="startRename(conversation)"><IconEdit/></button>
                <button type="button" title="删除对话" aria-label="删除对话" :disabled="app.chatLoading" @click="app.deleteChatConversation(conversation.id)"><IconDelete/></button>
              </div>
            </template>
          </article>
        </a-scrollbar>
      </aside>

      <div class="chat-main">
        <div class="workspace-toolbar">
          <div>
            <strong>{{ app.activeChatConversation?.title || '默认标题' }}</strong>
          </div>
          <a-button size="small" :disabled="app.chatLoading || app.chatMessages.length === 0" @click="app.clearChat">清空当前对话</a-button>
        </div>
        <a-scrollbar outer-class="chat-messages" class="chat-messages-container" :disable-horizontal="true" aria-live="polite">
          <div class="chat-messages-content">
            <div v-if="app.chatMessages.length === 0" class="chat-empty">开始一段文字对话</div>
            <article v-for="message in app.chatMessages" :key="message.id" class="chat-message" :class="message.role">
              <div class="chat-message-header">
                <div class="chat-role">{{ message.role === 'user' ? '你' : '助手' }}</div>
                <button
                    type="button"
                    class="chat-copy-button"
                    :title="app.chatCopiedMessageId === message.id ? '已复制' : '复制消息'"
                    :aria-label="app.chatCopiedMessageId === message.id ? '已复制' : '复制消息'"
                    @click="app.copyChatMessage(message.id, message.content)"
                >
                  <IconCheck v-if="app.chatCopiedMessageId === message.id"/>
                  <IconCopy v-else/>
                </button>
              </div>
              <p>{{ message.content }}</p>
              <div v-if="message.modelLabel" class="chat-message-model">{{ message.modelLabel }}</div>
            </article>
            <div v-if="app.chatLoading" class="chat-message assistant chat-thinking">正在思考...</div>
          </div>
        </a-scrollbar>
        <p v-if="app.chatError" class="error">{{ app.chatError }}</p>
        <div class="chat-composer">
          <textarea v-model="app.chatDraft" rows="4" placeholder="输入消息..." @keydown.ctrl.enter="app.sendChatMessage"></textarea>
          <div class="chat-actions">
            <label class="action-model-picker">
              <span>模型</span>
              <a-select
                  v-model="app.chatModelSelection"
                  :options="app.textModelSelectOptions"
                  :disabled="app.textModelGroups.length === 0"
                  class="model-provider-select"
              >
                <template #label="{data}">
                  <span class="selected-model-label">{{ data.label }}</span>
                  <a-tag v-if="data.providerName" size="small" class="model-provider-tag">{{ data.providerName }}</a-tag>
                </template>
              </a-select>
            </label>
            <button v-if="app.chatLoading" type="button" class="stop-generation" :disabled="app.chatStopping" @click="app.stopChat">
              <span class="stop-icon" aria-hidden="true"></span>
              {{ app.chatStopping ? '停止中...' : '停止' }}
            </button>
            <button type="button" class="generate" :disabled="app.chatLoading || !app.chatDraft.trim() || !app.chatModelSelection" @click="app.sendChatMessage">
              {{ app.chatLoading ? '生成中...' : '发送' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
