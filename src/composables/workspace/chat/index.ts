import {computed, onUnmounted, ref, type Ref} from "vue";
import {OpenAIConnection} from "../../../api";
import {ChatSession, type ChatMessage} from "../../../chat";
import {resolvedModelLabel, type ResolvedModel} from "../../../domain/models";
import type {GenerationTransport} from "../../../services/transport";
import {copyText} from "../../history";

type Log = (level: "INFO" | "ERROR", message: string) => void;

interface ChatWorkspaceOptions {
  chatModelSelection: Ref<string>;
  titleModelSelection: Ref<string>;
  resolveModelSelection(value: string): ResolvedModel | null;
  nextTaskId(): number;
  transport: GenerationTransport;
  log: Log;
  errorMessage(value: unknown): string;
  formatErrorDetails(value: unknown): string;
}

export function useChatWorkspace(options: ChatWorkspaceOptions) {
  const session = new ChatSession();
  const chatConversations = session.conversations;
  const activeChatConversationId = session.activeConversationId;
  const activeChatConversation = computed(() => session.activeConversation);
  const chatMessages = session.messages;
  const chatDraft = session.draft;
  const chatLoading = session.loading;
  const chatStopping = session.stopping;
  const chatError = session.error;
  const chatCopiedMessageId = ref("");
  const titleControllers = new Map<string, AbortController>();
  let copyNoticeTimer: number | null = null;

  async function sendChatMessage() {
    if (chatLoading.value || !chatDraft.value.trim()) return;
    const selectedModel = options.resolveModelSelection(options.chatModelSelection.value);
    if (!selectedModel || selectedModel.model.isImage) {
      chatError.value = "请先选择一个文字模型";
      return;
    }
    const taskId = options.nextTaskId();
    await session.send({
      modelLabel: resolvedModelLabel(selectedModel),
      request: ({messages, signal}) => options.transport.requestTextCompletion(
          messages.map((message) => ({role: message.role, content: message.content})),
          signal,
          taskId,
          selectedModel.model.id,
          connectionFor(selectedModel)
      ),
      onStart: (messageCount) => options.log(
          "INFO",
          `任务=#${taskId} 开始文字聊天: 模型=${selectedModel.model.id} 消息数=${messageCount}`
      ),
      onSuccess: () => options.log("INFO", `任务=#${taskId} 文字聊天完成`),
      onStop: () => options.log("INFO", `任务=#${taskId} 文字聊天已停止`),
      onError: (reason) => {
        chatError.value = options.errorMessage(reason);
        options.log("ERROR", `任务=#${taskId} 文字聊天失败: ${options.formatErrorDetails(reason)}`);
      },
      onFirstExchange: (conversationId, messages) => {
        void generateConversationTitle(conversationId, messages, selectedModel);
      },
    });
  }

  async function generateConversationTitle(
      conversationId: string,
      messages: ChatMessage[],
      currentModel: ResolvedModel
  ) {
    if (options.titleModelSelection.value === "none") {
      session.markTitleHandled(conversationId);
      return;
    }
    const titleModel = options.titleModelSelection.value === "current"
        ? currentModel
        : options.resolveModelSelection(options.titleModelSelection.value);
    if (!titleModel || titleModel.model.isImage) {
      session.markTitleHandled(conversationId);
      return;
    }
    const controller = new AbortController();
    titleControllers.set(conversationId, controller);
    const taskId = options.nextTaskId();
    const transcript = messages
        .slice(0, 2)
        .map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`)
        .join("\n\n");
    try {
      const title = await options.transport.requestTextCompletion(
          [
            {
              role: "system",
              content: "根据第一轮对话生成一个简短中文标题。只返回标题，不要引号、标点说明或其他内容，最多 20 个汉字。",
            },
            {role: "user", content: transcript},
          ],
          controller.signal,
          taskId,
          titleModel.model.id,
          connectionFor(titleModel)
      );
      session.setGeneratedTitle(
          conversationId,
          title.replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").split("\n", 1)[0].slice(0, 40)
      );
      options.log("INFO", `任务=#${taskId} 对话标题生成完成: 模型=${titleModel.model.id}`);
    } catch (reason) {
      if (!controller.signal.aborted) {
        options.log("ERROR", `任务=#${taskId} 对话标题生成失败: ${options.formatErrorDetails(reason)}`);
      }
    } finally {
      titleControllers.delete(conversationId);
    }
  }

  function stopChat() {
    session.stop();
  }

  function clearChat() {
    session.clear();
  }

  function createChatConversation() {
    if (!chatLoading.value) session.createConversation();
  }

  function selectChatConversation(id: string) {
    session.selectConversation(id);
  }

  function renameChatConversation(id: string, title: string) {
    session.renameConversation(id, title);
  }

  function deleteChatConversation(id: string) {
    titleControllers.get(id)?.abort();
    titleControllers.delete(id);
    session.deleteConversation(id);
  }

  async function copyChatMessage(messageId: string, content: string) {
    if (!await copyText(content)) {
      chatError.value = "复制消息失败，请检查系统剪贴板权限";
      return;
    }
    chatCopiedMessageId.value = messageId;
    if (copyNoticeTimer !== null) window.clearTimeout(copyNoticeTimer);
    copyNoticeTimer = window.setTimeout(() => {
      chatCopiedMessageId.value = "";
      copyNoticeTimer = null;
    }, 1600);
  }

  onUnmounted(() => {
    session.abort();
    for (const controller of titleControllers.values()) controller.abort();
    titleControllers.clear();
    if (copyNoticeTimer !== null) window.clearTimeout(copyNoticeTimer);
  });

  return {
    chatConversations,
    activeChatConversationId,
    activeChatConversation,
    chatMessages,
    chatDraft,
    chatLoading,
    chatStopping,
    chatError,
    chatCopiedMessageId,
    sendChatMessage,
    stopChat,
    clearChat,
    createChatConversation,
    selectChatConversation,
    renameChatConversation,
    deleteChatConversation,
    copyChatMessage,
  };
}

function connectionFor(model: ResolvedModel) {
  return new OpenAIConnection(model.provider.endpoint, model.provider.apiKey);
}

export type ChatWorkspace = ReturnType<typeof useChatWorkspace>;
