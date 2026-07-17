<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <section class="chat-workspace">
    <div class="workspace-toolbar">
      <div>
        <strong>文字聊天</strong>
        <span class="workspace-meta">{{ app.endpoint }} · Key {{ app.maskApiKey(app.apiKey) }} · {{ app.textModel }}</span>
      </div>
      <a-button size="small" :disabled="app.chatLoading || app.chatMessages.length === 0" @click="app.clearChat">清空会话</a-button>
    </div>
    <div class="chat-messages" aria-live="polite">
      <div v-if="app.chatMessages.length === 0" class="chat-empty">开始一段文字对话</div>
      <article v-for="message in app.chatMessages" :key="message.id" class="chat-message" :class="message.role">
        <div class="chat-role">{{ message.role === 'user' ? '你' : '助手' }}</div>
        <p>{{ message.content }}</p>
      </article>
      <div v-if="app.chatLoading" class="chat-message assistant chat-thinking">正在思考...</div>
    </div>
    <p v-if="app.chatError" class="error">{{ app.chatError }}</p>
    <div class="chat-composer">
      <textarea
          v-model="app.chatDraft"
          rows="4"
          placeholder="输入消息..."
          @keydown.ctrl.enter="app.sendChatMessage"
      ></textarea>
      <div class="chat-actions">
        <button v-if="app.chatLoading" type="button" class="stop-generation" :disabled="app.chatStopping" @click="app.stopChat">
          <span class="stop-icon" aria-hidden="true"></span>
          {{ app.chatStopping ? '停止中...' : '停止' }}
        </button>
        <button type="button" class="generate" :disabled="app.chatLoading || !app.chatDraft.trim()" @click="app.sendChatMessage">
          {{ app.chatLoading ? '生成中...' : '发送' }}
        </button>
      </div>
    </div>
  </section>
</template>
