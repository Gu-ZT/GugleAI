import {shallowRef, type ShallowRef} from "vue";
import {
  addEdge,
  Position,
  type Connection,
  type Edge,
  type Node as FlowNode,
} from "@vue-flow/core";

export type CanvasNodeType = "text" | "image";
export type CanvasNodeStatus = "idle" | "running" | "success" | "error";

export interface CanvasImageAsset {
  id: string;
  blob: Blob;
  mime: string;
  url: string;
  name: string;
}

export interface CanvasNodeData {
  title: string;
  text: string;
  outputText: string;
  prompt: string;
  references: CanvasImageAsset[];
  outputs: CanvasImageAsset[];
  count: number;
  status: CanvasNodeStatus;
  error: string;
  readOnly: boolean;
  connectionId: string;
  model: string;
  generatedFrom?: string;
}

export interface CanvasNodeDefaults {
  connectionId: string;
  model: string;
}

export type CanvasNode = FlowNode<CanvasNodeData, any, CanvasNodeType> & {
  type: CanvasNodeType;
  data: CanvasNodeData;
};

export class CanvasGraph {
  readonly nodes: ShallowRef<CanvasNode[]> = shallowRef([]);
  readonly edges: ShallowRef<Edge[]> = shallowRef([]);
  private sequence = 0;

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  findNode(id: string): CanvasNode | undefined {
    return this.nodes.value.find((node) => node.id === id);
  }

  seed(textDefaults: CanvasNodeDefaults, imageDefaults: CanvasNodeDefaults): void {
    if (this.nodes.value.length > 0) return;
    const textNode = this.createNode("text", 80, 150, {...textDefaults, title: "提示词"});
    const imageNode = this.createNode("image", 470, 120, {...imageDefaults, title: "图像生成"});
    this.nodes.value = [textNode, imageNode];
    this.edges.value = [{
      id: this.nextId("edge"),
      source: textNode.id,
      target: imageNode.id,
      animated: true,
    }];
  }

  add(type: CanvasNodeType, defaults: CanvasNodeDefaults): void {
    const index = this.nodes.value.length;
    this.nodes.value = [
      ...this.nodes.value,
      this.createNode(type, 80 + (index % 3) * 360, 100 + Math.floor(index / 3) * 330, defaults),
    ];
  }

  updateData(id: string, patch: Partial<CanvasNodeData>): void {
    this.nodes.value = this.nodes.value.map((node) =>
        node.id === id ? {...node, data: {...node.data, ...patch}} : node
    );
  }

  connect(connection: Connection): void {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    if (this.edges.value.some(
        (edge) => edge.source === connection.source && edge.target === connection.target
    )) return;
    this.edges.value = addEdge(
        {id: this.nextId("edge"), ...connection, animated: true},
        this.edges.value
    ) as Edge[];
  }

  replaceNodes(nodes: FlowNode[]): void {
    this.nodes.value = nodes as CanvasNode[];
  }

  replaceEdges(edges: Edge[]): void {
    this.edges.value = edges;
  }

  deleteNode(id: string): string[] {
    const removedIds = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.nodes.value) {
        if (node.data.generatedFrom && removedIds.has(node.data.generatedFrom) && !removedIds.has(node.id)) {
          removedIds.add(node.id);
          changed = true;
        }
      }
    }
    const removed = this.nodes.value.filter((node) => removedIds.has(node.id));
    for (const node of removed) this.revokeNodeAssets(node);
    this.nodes.value = this.nodes.value.filter((node) => !removedIds.has(node.id));
    this.edges.value = this.edges.value.filter(
        (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    );
    return [...removedIds];
  }

  removeGeneratedChildren(parentId: string): void {
    const childIds = new Set(
        this.nodes.value.filter((node) => node.data.generatedFrom === parentId).map((node) => node.id)
    );
    for (const node of this.nodes.value) {
      if (childIds.has(node.id)) this.revokeNodeAssets(node);
    }
    this.nodes.value = this.nodes.value.filter((node) => !childIds.has(node.id));
    this.edges.value = this.edges.value.filter(
        (edge) => !childIds.has(edge.source) && !childIds.has(edge.target)
    );
  }

  parentNodes(nodeId: string): CanvasNode[] {
    const parentIds = this.edges.value.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
    return parentIds
        .map((parentId) => this.findNode(parentId))
        .filter((node): node is CanvasNode => Boolean(node));
  }

  prompt(node: CanvasNode): string {
    const parts = [node.type === "text" ? node.data.text : node.data.prompt];
    for (const parent of this.parentNodes(node.id)) {
      if (parent.type !== "text") continue;
      const text = parent.data.outputText.trim() || parent.data.text.trim();
      if (text) parts.push(text);
    }
    return parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
  }

  referenceAssets(node: CanvasNode): CanvasImageAsset[] {
    const assets = [...(node.type === "image" ? node.data.references : [])];
    for (const parent of this.parentNodes(node.id)) {
      if (parent.type !== "image") continue;
      assets.push(...(parent.data.outputs.length > 0 ? parent.data.outputs : parent.data.references));
    }
    const seen = new Set<string>();
    return assets.filter((asset) => {
      if (seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    });
  }

  addFiles(nodeId: string, files: File[]): void {
    const node = this.findNode(nodeId);
    if (!node || node.type !== "image") return;
    const added = files
        .filter((file) => file.type.startsWith("image/"))
        .map((file): CanvasImageAsset => ({
          id: this.nextId("asset"),
          blob: file,
          mime: normalizeMime(file.type),
          url: URL.createObjectURL(file),
          name: file.name,
        }));
    this.updateData(nodeId, {references: [...node.data.references, ...added]});
  }

  removeReference(nodeId: string, assetId: string): void {
    const node = this.findNode(nodeId);
    if (!node) return;
    const asset = node.data.references.find((item) => item.id === assetId);
    if (asset) URL.revokeObjectURL(asset.url);
    this.updateData(nodeId, {
      references: node.data.references.filter((item) => item.id !== assetId),
    });
  }

  addGeneratedOutputs(parentId: string, blobs: Blob[]): void {
    this.removeGeneratedChildren(parentId);
    const source = this.findNode(parentId);
    if (!source) return;
    const outputNodes = blobs.map((blob, index) => {
      const mime = normalizeMime(blob.type);
      const asset: CanvasImageAsset = {
        id: this.nextId("asset"),
        blob,
        mime,
        url: URL.createObjectURL(blob),
        name: `canvas-${Date.now()}-${index + 1}.${extensionForMime(mime)}`,
      };
      return this.createNode("image", source.position.x + 390, source.position.y + index * 250, {
        title: `生成图片 ${index + 1}`,
        references: [asset],
        readOnly: true,
        connectionId: source.data.connectionId,
        model: source.data.model,
        generatedFrom: parentId,
      });
    });
    this.nodes.value = [...this.nodes.value, ...outputNodes];
    this.edges.value = [
      ...this.edges.value,
      ...outputNodes.map((output) => ({
        id: this.nextId("edge"),
        source: parentId,
        target: output.id,
        animated: true,
      })),
    ];
  }

  addGeneratedTextChild(parentId: string, text: string): void {
    const source = this.findNode(parentId);
    if (!source) return;
    const siblingCount = this.nodes.value.filter(
        (node) => node.type === "text" && node.data.generatedFrom === parentId
    ).length;
    const output = this.createNode(
        "text",
        source.position.x + 370,
        source.position.y + siblingCount * 240,
        {
          title: "生成文字",
          text,
          connectionId: source.data.connectionId,
          model: source.data.model,
          generatedFrom: parentId,
        }
    );
    this.nodes.value = [...this.nodes.value, output];
    this.edges.value = [
      ...this.edges.value,
      {
        id: this.nextId("edge"),
        source: parentId,
        target: output.id,
        animated: true,
      },
    ];
  }

  clear(): void {
    for (const node of this.nodes.value) this.revokeNodeAssets(node);
    this.nodes.value = [];
    this.edges.value = [];
  }

  dispose(): void {
    this.clear();
  }

  private createNode(
      type: CanvasNodeType,
      x: number,
      y: number,
      overrides: Partial<CanvasNodeData> = {}
  ): CanvasNode {
    return {
      id: this.nextId(type),
      type,
      position: {x, y},
      width: type === "text" ? 300 : 320,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
      selectable: true,
      connectable: true,
      deletable: false,
      data: {
        title: type === "text" ? "文字节点" : "图像节点",
        text: "",
        outputText: "",
        prompt: "",
        references: [],
        outputs: [],
        count: 1,
        status: "idle",
        error: "",
        readOnly: false,
        connectionId: "",
        model: "",
        ...overrides,
      },
    };
  }

  private revokeNodeAssets(node: CanvasNode): void {
    const urls = new Set<string>();
    for (const asset of [...node.data.references, ...node.data.outputs]) {
      if (urls.has(asset.url)) continue;
      urls.add(asset.url);
      URL.revokeObjectURL(asset.url);
    }
  }
}

function normalizeMime(mime: string | null | undefined): string {
  const normalized = mime?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return normalized.startsWith("image/") ? normalized : "image/png";
}

function extensionForMime(mime: string): string {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}
