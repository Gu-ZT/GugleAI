import {computed, ref, watch} from "vue";
import {
  AGENT_SETTINGS_KEY,
  DEFAULT_CANVAS_PROMPT_SYSTEM_PROMPT,
  DEFAULT_CHAT_AGENT_ID,
  PROMPT_VARIABLES,
  createAgentId,
  defaultChatAgent,
  normalizeChatAgents,
  type ChatAgent,
} from "../../../domain/agents";
import {resolvePromptTemplate} from "../../../services/system-info";

export function useAgentSettings() {
  const canvasPromptSystemPrompt = ref(DEFAULT_CANVAS_PROMPT_SYSTEM_PROMPT);
  const chatAgents = ref<ChatAgent[]>([defaultChatAgent()]);
  const selectedChatAgentId = ref(DEFAULT_CHAT_AGENT_ID);

  restore();

  const selectedChatAgent = computed(() => chatAgents.value.find(
      (agent) => agent.id === selectedChatAgentId.value
  ) ?? chatAgents.value[0]);
  const chatAgentSelectOptions = computed(() => chatAgents.value.map((agent) => ({
    value: agent.id,
    label: agent.name.trim() || "未命名智能体",
  })));

  watch([canvasPromptSystemPrompt, chatAgents, selectedChatAgentId], persist, {deep: true});

  function addChatAgent(): string {
    const id = createAgentId();
    chatAgents.value = [...chatAgents.value, {
      id,
      name: `智能体 ${chatAgents.value.length}`,
      systemPrompt: "",
      isDefault: false,
    }];
    selectedChatAgentId.value = id;
    return id;
  }

  function removeChatAgent(id: string) {
    const agent = chatAgents.value.find((item) => item.id === id);
    if (!agent || agent.isDefault) return;
    chatAgents.value = chatAgents.value.filter((item) => item.id !== id);
    if (selectedChatAgentId.value === id) selectedChatAgentId.value = DEFAULT_CHAT_AGENT_ID;
  }

  async function resolveChatSystemPrompt(modelName: string): Promise<string> {
    return resolvePromptTemplate(selectedChatAgent.value?.systemPrompt ?? "", modelName);
  }

  async function resolveCanvasPromptSystemPrompt(modelName: string): Promise<string> {
    return resolvePromptTemplate(canvasPromptSystemPrompt.value, modelName);
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(AGENT_SETTINGS_KEY) ?? "null");
      if (!saved || typeof saved !== "object") return;
      canvasPromptSystemPrompt.value = typeof saved.canvasPromptSystemPrompt === "string"
          ? saved.canvasPromptSystemPrompt
          : DEFAULT_CANVAS_PROMPT_SYSTEM_PROMPT;
      chatAgents.value = normalizeChatAgents(saved.chatAgents);
      selectedChatAgentId.value = typeof saved.selectedChatAgentId === "string"
          && chatAgents.value.some((agent) => agent.id === saved.selectedChatAgentId)
          ? saved.selectedChatAgentId
          : DEFAULT_CHAT_AGENT_ID;
    } catch {
    }
  }

  function persist() {
    localStorage.setItem(AGENT_SETTINGS_KEY, JSON.stringify({
      canvasPromptSystemPrompt: canvasPromptSystemPrompt.value,
      chatAgents: chatAgents.value,
      selectedChatAgentId: selectedChatAgentId.value,
    }));
  }

  return {
    canvasPromptSystemPrompt,
    chatAgents,
    selectedChatAgentId,
    selectedChatAgent,
    chatAgentSelectOptions,
    promptVariables: PROMPT_VARIABLES,
    defaultChatAgentId: DEFAULT_CHAT_AGENT_ID,
    addChatAgent,
    removeChatAgent,
    resolveChatSystemPrompt,
    resolveCanvasPromptSystemPrompt,
  };
}

export type AgentSettings = ReturnType<typeof useAgentSettings>;
