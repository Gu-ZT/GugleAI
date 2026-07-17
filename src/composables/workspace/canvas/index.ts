import {onUnmounted, ref, type Ref} from "vue";
import {OpenAIConnection} from "../../../api";
import {
  CanvasGraph,
  type CanvasImageAsset,
  type CanvasNode,
  type CanvasNodeData,
} from "../../../canvas";
import {
  base64ToBlob,
  modelSelectionKey,
  type ConnectionProfile,
  type ResolvedModel,
} from "../../../domain/models";
import {arrayBufferToBase64, type GenerationTransport} from "../../../services/transport";
import type {GenerationSettings} from "../../settings/generation";

interface CanvasWorkspaceOptions {
  graph: CanvasGraph;
  connectionProfiles: Ref<ConnectionProfile[]>;
  imageModelSelection: Ref<string>;
  chatModelSelection: Ref<string>;
  resolveModelSelection(value: string): ResolvedModel | null;
  firstModelSelection(image: boolean): string;
  generationSettings: GenerationSettings;
  transport: GenerationTransport;
  nextTaskId(): number;
  errorMessage(value: unknown): string;
}

export function useCanvasWorkspace(options: CanvasWorkspaceOptions) {
  const canvasNodes = options.graph.nodes;
  const canvasEdges = options.graph.edges;
  const canvasBusyCount = ref(0);
  const controllers = new Map<string, AbortController>();

  function seedCanvas() {
    options.graph.seed(canvasNodeDefaults("text"), canvasNodeDefaults("image"));
  }

  function addCanvasTextNode() {
    options.graph.add("text", canvasNodeDefaults("text"));
  }

  function addCanvasImageNode() {
    options.graph.add("image", canvasNodeDefaults("image"));
  }

  function canvasNodeDefaults(type: "text" | "image") {
    const preferredSelection = type === "text"
        ? options.chatModelSelection.value
        : options.imageModelSelection.value;
    const resolved = options.resolveModelSelection(preferredSelection)
        ?? options.resolveModelSelection(options.firstModelSelection(type === "image"));
    return {
      connectionId: resolved?.provider.id ?? "",
      model: resolved?.model.id ?? "",
    };
  }

  function canvasNodeModelSelection(nodeData: CanvasNodeData): string {
    return modelSelectionKey(nodeData.connectionId, nodeData.model);
  }

  function onCanvasNodeModelChange(nodeId: string, valueOrEvent: string | Event) {
    const selection = typeof valueOrEvent === "string"
        ? valueOrEvent
        : (valueOrEvent.target as HTMLSelectElement).value;
    const resolved = options.resolveModelSelection(selection);
    if (!resolved) return;
    updateCanvasNodeData(nodeId, {
      connectionId: resolved.provider.id,
      model: resolved.model.id,
      error: "",
    });
  }

  function connectionForCanvasNode(node: CanvasNode): OpenAIConnection {
    const profile = options.connectionProfiles.value.find((item) => item.id === node.data.connectionId);
    if (!profile) throw new Error("节点选择的 API 连接不存在，请重新选择");
    if (!profile.models.some((item) => item.id === node.data.model)) {
      throw new Error("节点选择的模型不存在，请重新选择");
    }
    return new OpenAIConnection(profile.endpoint, profile.apiKey);
  }

  function updateCanvasNodeData(id: string, patch: Partial<CanvasNodeData>) {
    options.graph.updateData(id, patch);
  }

  function onCanvasConnect(connection: Parameters<CanvasGraph["connect"]>[0]) {
    options.graph.connect(connection);
  }

  function onCanvasNodesUpdate(nodes: Parameters<CanvasGraph["replaceNodes"]>[0]) {
    options.graph.replaceNodes(nodes);
  }

  function onCanvasEdgesUpdate(edges: Parameters<CanvasGraph["replaceEdges"]>[0]) {
    options.graph.replaceEdges(edges);
  }

  function deleteCanvasNode(id: string) {
    for (const removedId of options.graph.deleteNode(id)) {
      controllers.get(removedId)?.abort();
      controllers.delete(removedId);
    }
  }

  function onCanvasImageFiles(nodeId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    options.graph.addFiles(nodeId, [...(input.files ?? [])]);
    input.value = "";
  }

  function openCanvasImagePicker(nodeId: string) {
    document.getElementById(`canvas-image-input-${nodeId}`)?.click();
  }

  function removeCanvasReference(nodeId: string, assetId: string) {
    options.graph.removeReference(nodeId, assetId);
  }

  async function assetDataUrl(asset: CanvasImageAsset): Promise<string> {
    return `data:${asset.mime};base64,${arrayBufferToBase64(await asset.blob.arrayBuffer())}`;
  }

  async function requestCanvasText(
      node: CanvasNode,
      signal: AbortSignal,
      taskId: number
  ): Promise<string> {
    const prompt = options.graph.prompt(node);
    if (!prompt) throw new Error("请先在节点或父节点中填写文字内容");
    const content: unknown[] = [{type: "text", text: prompt}];
    for (const asset of options.graph.referenceAssets(node)) {
      content.push({type: "image_url", image_url: {url: await assetDataUrl(asset)}});
    }
    return options.transport.requestTextCompletion(
        [{role: "user", content}],
        signal,
        taskId,
        node.data.model,
        connectionForCanvasNode(node)
    );
  }

  async function generateCanvasText(nodeId: string) {
    const node = options.graph.findNode(nodeId);
    if (!node || node.type !== "text" || node.data.readOnly || controllers.has(nodeId)) return;
    const controller = new AbortController();
    controllers.set(nodeId, controller);
    canvasBusyCount.value += 1;
    updateCanvasNodeData(nodeId, {status: "running", error: ""});
    try {
      const output = await requestCanvasText(node, controller.signal, options.nextTaskId());
      options.graph.addGeneratedTextChild(nodeId, output);
      updateCanvasNodeData(nodeId, {status: "success"});
    } catch (reason) {
      updateCanvasNodeData(nodeId, controller.signal.aborted
          ? {status: "idle"}
          : {status: "error", error: options.errorMessage(reason)});
    } finally {
      canvasBusyCount.value -= 1;
      controllers.delete(nodeId);
    }
  }

  async function requestCanvasImages(
      node: CanvasNode,
      prompt: string,
      references: CanvasImageAsset[],
      amount: number,
      signal: AbortSignal,
      taskId: number
  ): Promise<Blob[]> {
    const connection = connectionForCanvasNode(node);
    const base = connection.baseUrl;
    const requestSize = options.generationSettings.resolvedSize();
    const useChat = options.generationSettings.apiMode.value === "chat"
        || (options.generationSettings.apiMode.value === "auto" && references.length > 1);
    if (useChat) {
      const content: unknown[] = [{type: "text", text: prompt}];
      for (const asset of references) {
        content.push({type: "image_url", image_url: {url: await assetDataUrl(asset)}});
      }
      const response = await options.transport.fetchGeneration(
          `${base}/chat/completions`,
          {
            method: "POST",
            headers: connection.jsonHeaders,
            body: JSON.stringify({
              model: node.data.model,
              messages: [{role: "user", content}],
              n: amount,
              ...(requestSize ? {size: requestSize} : {}),
            }),
          },
          taskId,
          signal
      );
      const data = await options.transport.parseResponse(response);
      const blobs: Blob[] = [];
      for (const choice of data.choices ?? []) {
        const message = choice.message ?? {};
        for (const image of message.images ?? []) {
          const url = image?.image_url?.url ?? image?.url;
          if (url) blobs.push(await imageUrlToBlob(base, url, signal));
        }
        const text = OpenAIConnection.extractTextContent(message.content);
        for (const match of text.matchAll(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
          blobs.push(base64ToBlob(match[2], match[1]));
        }
        if (blobs.length === 0) {
          for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)) {
            blobs.push(await imageUrlToBlob(base, match[1], signal));
          }
        }
      }
      return blobs.slice(0, amount);
    }

    let response: Response;
    if (references.length > 0) {
      const form = new FormData();
      form.append("model", node.data.model);
      form.append("prompt", prompt);
      form.append("n", String(amount));
      if (requestSize) form.append("size", requestSize);
      for (const asset of references) {
        form.append("image[]", new File([asset.blob], asset.name, {type: asset.mime}), asset.name);
      }
      response = await options.transport.fetchGeneration(
          `${base}/images/edits`,
          {method: "POST", headers: connection.authHeaders, body: form},
          taskId,
          signal
      );
    } else {
      response = await options.transport.fetchGeneration(
          `${base}/images/generations`,
          {
            method: "POST",
            headers: connection.jsonHeaders,
            body: JSON.stringify({
              model: node.data.model,
              prompt,
              n: amount,
              ...(requestSize ? {size: requestSize} : {}),
            }),
          },
          taskId,
          signal
      );
    }
    const data = await options.transport.parseResponse(response);
    const blobs: Blob[] = [];
    for (const item of data.data ?? []) {
      if (item.b64_json) blobs.push(base64ToBlob(item.b64_json, "image/png"));
      else if (item.url) blobs.push(await imageUrlToBlob(base, item.url, signal));
    }
    return blobs.slice(0, amount);
  }

  async function imageUrlToBlob(base: string, url: string, signal: AbortSignal): Promise<Blob> {
    const dataUrl = url.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (dataUrl) return base64ToBlob(dataUrl[2], dataUrl[1]);
    return options.transport.downloadImage(base, url, signal);
  }

  async function generateCanvasImage(nodeId: string) {
    const node = options.graph.findNode(nodeId);
    if (!node || node.type !== "image" || node.data.readOnly || controllers.has(nodeId)) return;
    if (node.data.references.length > 0) {
      updateCanvasNodeData(nodeId, {
        status: "error",
        error: "参考图节点不能直接生成，请新建图像节点并连接此节点",
      });
      return;
    }
    const prompt = options.graph.prompt(node);
    if (!prompt) {
      updateCanvasNodeData(nodeId, {status: "error", error: "请先填写提示词或连接文字节点"});
      return;
    }
    const references = options.graph.referenceAssets(node);
    const amount = Math.max(1, Math.min(10, Number(node.data.count) || 1));
    const controller = new AbortController();
    controllers.set(nodeId, controller);
    canvasBusyCount.value += 1;
    updateCanvasNodeData(nodeId, {status: "running", error: ""});
    try {
      const blobs = await requestCanvasImages(
          node,
          prompt,
          references,
          amount,
          controller.signal,
          options.nextTaskId()
      );
      if (blobs.length === 0) throw new Error("响应中没有图片数据");
      options.graph.addGeneratedOutputs(nodeId, blobs);
      updateCanvasNodeData(nodeId, {status: "success"});
    } catch (reason) {
      updateCanvasNodeData(nodeId, controller.signal.aborted
          ? {status: "idle"}
          : {status: "error", error: options.errorMessage(reason)});
    } finally {
      canvasBusyCount.value -= 1;
      controllers.delete(nodeId);
    }
  }

  function stopCanvasNode(nodeId: string) {
    controllers.get(nodeId)?.abort();
  }

  function clearCanvas() {
    if (canvasNodes.value.length === 0) return;
    if (!window.confirm("确定清空无尽画布中的全部节点和连接吗？")) return;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    options.graph.clear();
  }

  onUnmounted(() => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    options.graph.dispose();
  });

  return {
    canvasNodes,
    canvasEdges,
    canvasBusyCount,
    seedCanvas,
    addCanvasTextNode,
    addCanvasImageNode,
    updateCanvasNodeData,
    onCanvasConnect,
    onCanvasNodesUpdate,
    onCanvasEdgesUpdate,
    deleteCanvasNode,
    canvasNodeModelSelection,
    onCanvasNodeModelChange,
    onCanvasImageFiles,
    openCanvasImagePicker,
    removeCanvasReference,
    generateCanvasText,
    generateCanvasImage,
    stopCanvasNode,
    clearCanvas,
  };
}

export type CanvasWorkspace = ReturnType<typeof useCanvasWorkspace>;
