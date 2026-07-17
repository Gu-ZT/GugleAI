export interface ChatAgent {
  id: string;
  name: string;
  systemPrompt: string;
  isDefault: boolean;
}

export interface PromptVariableDefinition {
  token: string;
  description: string;
}

export const AGENT_SETTINGS_KEY = "gugle-ai-agent-settings";
export const DEFAULT_CHAT_AGENT_ID = "default-assistant";
export const DEFAULT_CANVAS_PROMPT_SYSTEM_PROMPT =
    "如果用户输入可以作为生成提示词的要求，直接输出提示词的内容，不要有其他输出";
const LEGACY_DEFAULT_CHAT_AGENT_SYSTEM_PROMPT = `你是一个友好、乐于助人的AI助手。请用清晰、简洁的语言回答用户的问题。遵循以下原则：
1. 事实性回答必须准确，不确定时诚实说明。
2. 拒绝任何有害、非法或不道德的请求。
3. 使用Markdown格式化代码和列表。
4. 使用与用户相同的语言回复。`;
export const DEFAULT_CHAT_AGENT_SYSTEM_PROMPT = `你是一个友好、乐于助人的AI助手。当前环境：日期 {{date}}，时间 {{time}}，系统 {{system}} ({{arch}})，语言 {{language}}，模型 {{model_name}}，用户 {{username}}。请用清晰、简洁的语言回答问题，并遵循：
1. 事实准确，不确定时诚实说明。
2. 拒绝任何有害、非法或不道德请求。
3. 使用Markdown格式化代码和列表。
4. 使用与用户相同的语言回复。`;

export const PROMPT_VARIABLES: PromptVariableDefinition[] = [
  {token: "{{date}}", description: "日期"},
  {token: "{{time}}", description: "时间"},
  {token: "{{datetime}}", description: "日期和时间"},
  {token: "{{system}}", description: "操作系统"},
  {token: "{{arch}}", description: "CPU 架构"},
  {token: "{{language}}", description: "语言"},
  {token: "{{model_name}}", description: "模型名称"},
  {token: "{{username}}", description: "用户名"},
];

export function defaultChatAgent(): ChatAgent {
  return {
    id: DEFAULT_CHAT_AGENT_ID,
    name: "默认助手",
    systemPrompt: DEFAULT_CHAT_AGENT_SYSTEM_PROMPT,
    isDefault: true,
  };
}

export function normalizeChatAgents(value: unknown): ChatAgent[] {
  const source = Array.isArray(value) ? value : [];
  const agents: ChatAgent[] = [];
  const usedIds = new Set<string>();
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    let id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : createAgentId();
    if (usedIds.has(id)) id = createAgentId();
    usedIds.add(id);
    const savedSystemPrompt = typeof record.systemPrompt === "string" ? record.systemPrompt : "";
    agents.push({
      id,
      name: typeof record.name === "string" ? record.name : "",
      systemPrompt: id === DEFAULT_CHAT_AGENT_ID
          && savedSystemPrompt === LEGACY_DEFAULT_CHAT_AGENT_SYSTEM_PROMPT
          ? DEFAULT_CHAT_AGENT_SYSTEM_PROMPT
          : savedSystemPrompt,
      isDefault: id === DEFAULT_CHAT_AGENT_ID,
    });
  }
  const savedDefault = agents.find((agent) => agent.id === DEFAULT_CHAT_AGENT_ID);
  const customAgents = agents.filter((agent) => agent.id !== DEFAULT_CHAT_AGENT_ID);
  return [savedDefault ?? defaultChatAgent(), ...customAgents];
}

export function createAgentId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
