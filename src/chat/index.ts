import {ref, type Ref} from "vue";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestContext {
  messages: ChatMessage[];
  signal: AbortSignal;
}

interface ChatSessionHooks {
  request(context: ChatRequestContext): Promise<string>;
  onStart?(messageCount: number): void;
  onSuccess?(): void;
  onStop?(): void;
  onError?(error: unknown): void;
}

export class ChatSession {
  readonly messages: Ref<ChatMessage[]> = ref([]);
  readonly draft = ref("");
  readonly loading = ref(false);
  readonly stopping = ref(false);
  readonly error = ref("");
  private controller: AbortController | null = null;

  async send(hooks: ChatSessionHooks): Promise<void> {
    if (this.loading.value) return;
    const content = this.draft.value.trim();
    if (!content) return;

    this.messages.value.push({
      id: `chat-user-${Date.now()}`,
      role: "user",
      content,
    });
    this.draft.value = "";
    this.error.value = "";
    this.loading.value = true;
    this.stopping.value = false;
    const controller = new AbortController();
    this.controller = controller;
    hooks.onStart?.(this.messages.value.length);

    try {
      const reply = await hooks.request({
        messages: this.messages.value.map((message) => ({...message})),
        signal: controller.signal,
      });
      this.messages.value.push({
        id: `chat-assistant-${Date.now()}`,
        role: "assistant",
        content: reply,
      });
      hooks.onSuccess?.();
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
    this.messages.value = [];
    this.error.value = "";
  }

  abort(): void {
    this.controller?.abort();
  }
}
