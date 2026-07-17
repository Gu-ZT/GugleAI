import {computed, ref, watch, type ComputedRef, type Ref} from "vue";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelLabel?: string;
  createdAt: number;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  manualTitle: boolean;
  titleGenerated: boolean;
}

interface ChatRequestContext {
  messages: ChatMessage[];
  signal: AbortSignal;
}

interface ChatSessionHooks {
  request(context: ChatRequestContext): Promise<string>;
  modelLabel: string;
  onStart?(messageCount: number): void;
  onSuccess?(): void;
  onStop?(): void;
  onError?(error: unknown): void;
  onFirstExchange?(conversationId: string, messages: ChatMessage[]): void;
}

const CHAT_HISTORY_KEY = "gugle-ai-chat-history";

export class ChatSession {
  readonly conversations: Ref<ChatConversation[]> = ref([]);
  readonly activeConversationId = ref("");
  readonly messages: ComputedRef<ChatMessage[]> = computed(
      () => this.activeConversation?.messages ?? []
  );
  readonly draft = ref("");
  readonly loading = ref(false);
  readonly stopping = ref(false);
  readonly error = ref("");
  private controller: AbortController | null = null;

  constructor() {
    this.restore();
    if (this.conversations.value.length === 0) this.createConversation();
    watch(
        this.conversations,
        (conversations) => localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(conversations)),
        {deep: true}
    );
  }

  get activeConversation(): ChatConversation | undefined {
    return this.conversations.value.find(
        (conversation) => conversation.id === this.activeConversationId.value
    );
  }

  createConversation(): string {
    const now = Date.now();
    const conversation: ChatConversation = {
      id: createId("conversation"),
      title: "默认标题",
      messages: [],
      createdAt: now,
      updatedAt: now,
      manualTitle: false,
      titleGenerated: false,
    };
    this.conversations.value = [conversation, ...this.conversations.value];
    this.activeConversationId.value = conversation.id;
    this.draft.value = "";
    this.error.value = "";
    return conversation.id;
  }

  selectConversation(id: string): void {
    if (this.loading.value || !this.conversations.value.some((item) => item.id === id)) return;
    this.activeConversationId.value = id;
    this.draft.value = "";
    this.error.value = "";
  }

  renameConversation(id: string, title: string): void {
    const normalized = title.trim() || "默认标题";
    this.patchConversation(id, {
      title: normalized,
      manualTitle: true,
      titleGenerated: true,
    });
  }

  setGeneratedTitle(id: string, title: string): void {
    const conversation = this.conversations.value.find((item) => item.id === id);
    if (!conversation || conversation.manualTitle) return;
    this.patchConversation(id, {
      title: title.trim() || "默认标题",
      titleGenerated: true,
    });
  }

  markTitleHandled(id: string): void {
    const conversation = this.conversations.value.find((item) => item.id === id);
    if (!conversation || conversation.manualTitle) return;
    this.patchConversation(id, {titleGenerated: true});
  }

  deleteConversation(id: string): void {
    if (this.loading.value) return;
    const remaining = this.conversations.value.filter((item) => item.id !== id);
    this.conversations.value = remaining;
    if (this.activeConversationId.value === id) {
      if (remaining.length > 0) this.activeConversationId.value = remaining[0].id;
      else this.createConversation();
    }
  }

  async send(hooks: ChatSessionHooks): Promise<void> {
    if (this.loading.value) return;
    const content = this.draft.value.trim();
    if (!content) return;
    let conversation = this.activeConversation;
    if (!conversation) {
      const conversationId = this.createConversation();
      conversation = this.conversations.value.find((item) => item.id === conversationId);
    }
    if (!conversation) return;

    conversation.messages.push({
      id: createId("chat-user"),
      role: "user",
      content,
      createdAt: Date.now(),
    });
    conversation.updatedAt = Date.now();
    this.touchConversation(conversation.id);
    this.draft.value = "";
    this.error.value = "";
    this.loading.value = true;
    this.stopping.value = false;
    const controller = new AbortController();
    this.controller = controller;
    hooks.onStart?.(conversation.messages.length);

    try {
      const reply = await hooks.request({
        messages: conversation.messages.map((message) => ({...message})),
        signal: controller.signal,
      });
      conversation.messages.push({
        id: createId("chat-assistant"),
        role: "assistant",
        content: reply,
        modelLabel: hooks.modelLabel,
        createdAt: Date.now(),
      });
      conversation.updatedAt = Date.now();
      this.touchConversation(conversation.id);
      hooks.onSuccess?.();
      if (
        conversation.messages.length === 2 &&
        !conversation.manualTitle &&
        !conversation.titleGenerated
      ) {
        conversation.titleGenerated = true;
        hooks.onFirstExchange?.(
            conversation.id,
            conversation.messages.map((message) => ({...message}))
        );
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) hooks.onStop?.();
      else hooks.onError?.(error);
    } finally {
      if (this.controller === controller) this.controller = null;
      this.stopping.value = false;
      this.loading.value = false;
    }
  }

  stop(): void {
    if (!this.controller || this.controller.signal.aborted) return;
    this.stopping.value = true;
    this.controller.abort();
  }

  clear(): void {
    if (this.loading.value) return;
    const conversation = this.activeConversation;
    if (!conversation) return;
    conversation.messages = [];
    conversation.title = "默认标题";
    conversation.manualTitle = false;
    conversation.titleGenerated = false;
    conversation.updatedAt = Date.now();
    this.touchConversation(conversation.id);
    this.error.value = "";
  }

  abort(): void {
    this.controller?.abort();
  }

  private patchConversation(id: string, patch: Partial<ChatConversation>): void {
    this.conversations.value = this.conversations.value.map((conversation) =>
      conversation.id === id
          ? {...conversation, ...patch, updatedAt: Date.now()}
          : conversation
    );
  }

  private touchConversation(id: string): void {
    this.conversations.value = this.conversations.value.map((conversation) =>
      conversation.id === id ? {...conversation} : conversation
    );
  }

  private restore(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? "[]");
      if (!Array.isArray(saved)) return;
      this.conversations.value = saved
          .map(normalizeConversation)
          .filter((item): item is ChatConversation => Boolean(item))
          .sort((a, b) => b.updatedAt - a.updatedAt);
      this.activeConversationId.value = this.conversations.value[0]?.id ?? "";
    } catch {
      this.conversations.value = [];
    }
  }
}

function normalizeConversation(value: unknown): ChatConversation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id ? record.id : createId("conversation");
  const messages = Array.isArray(record.messages)
      ? record.messages.map(normalizeMessage).filter((item): item is ChatMessage => Boolean(item))
      : [];
  const createdAt = finiteNumber(record.createdAt, Date.now());
  return {
    id,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "默认标题",
    messages,
    createdAt,
    updatedAt: finiteNumber(record.updatedAt, createdAt),
    manualTitle: record.manualTitle === true,
    titleGenerated: record.titleGenerated === true,
  };
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if ((record.role !== "user" && record.role !== "assistant") || typeof record.content !== "string") {
    return null;
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : createId("chat-message"),
    role: record.role,
    content: record.content,
    modelLabel: typeof record.modelLabel === "string" ? record.modelLabel : undefined,
    createdAt: finiteNumber(record.createdAt, Date.now()),
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
