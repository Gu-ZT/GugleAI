import {computed, onMounted, reactive, ref} from "vue";
import {useRoute, useRouter} from "vue-router";
import {CanvasGraph} from "../../canvas";
import {
  DEFAULT_MODEL_OPTIONS,
  DEFAULT_RETRY_STATUS_CODE_OPTIONS,
  modelDisplayName,
  modelSelectionKey,
} from "../../domain/models";
import {workspaceModeFromRoute, type WorkspaceMode} from "../../router";
import {createGenerationTransport} from "../../services/transport";
import {useAppSettings} from "../settings/app";
import {useCanvasWorkspace} from "../workspace/canvas";
import {useChatWorkspace} from "../workspace/chat";
import {useGenerationSettings} from "../settings/generation";
import {useImageWorkspace} from "../workspace/image";
import {useLogger} from "../logger";
import {useProviderSettings} from "../settings/provider";
import {useResultHistory} from "../history";
import {useSystemFetch} from "../fetch";
import {useTheme} from "../theme";
import {useUpdater} from "../updater";

export function useAppController() {
  const route = useRoute();
  const router = useRouter();
  const appMode = computed(() => workspaceModeFromRoute(route.name));
  const graph = new CanvasGraph();
  const providers = useProviderSettings({
    canvasNodes: graph.nodes,
    updateCanvasNodeData: (id, patch) => graph.updateData(id, patch),
  });
  const generation = useGenerationSettings();
  const {themeMode} = useTheme();
  const error = ref("");
  const logger = useLogger(
      () => [providers.apiKey.value, ...providers.connectionProfiles.value.map((profile) => profile.apiKey)],
      error
  );
  const systemFetch = useSystemFetch(logger.log, logger.sanitizeUrlForLog);
  const transport = createGenerationTransport({
    fetch: systemFetch.fetch,
    retryConfig: generation.retryConfig,
    log: logger.log,
    sanitizeUrl: logger.sanitizeUrlForLog,
    redact: logger.redactSensitiveText,
    formatError: logger.formatErrorDetails,
    proxyForLog: systemFetch.proxyForLog,
  });
  const settings = useAppSettings({providers, generation, themeMode});
  let taskSequence = 0;
  const nextTaskId = () => ++taskSequence;

  let resultHistory: ReturnType<typeof useResultHistory>;
  const images = useImageWorkspace({
    imageModelSelection: providers.imageModelSelection,
    resolveModelSelection: providers.resolveModelSelection,
    addConnection: providers.addAndSelectConnection,
    generationSettings: generation,
    transport,
    nextTaskId,
    addResultImage: (...args) => resultHistory.addResultImage(...args),
    log: logger.log,
    sanitizeUrl: logger.sanitizeUrlForLog,
    errorMessage: logger.errorMessage,
    formatErrorDetails: logger.formatErrorDetails,
    error,
  });
  resultHistory = useResultHistory({
    error,
    log: logger.log,
    errorMessage: logger.errorMessage,
    formatErrorDetails: logger.formatErrorDetails,
    addReference: images.addFile,
    saveImage: images.saveImage,
  });
  const chat = useChatWorkspace({
    chatModelSelection: providers.chatModelSelection,
    titleModelSelection: providers.titleModelSelection,
    resolveModelSelection: providers.resolveModelSelection,
    nextTaskId,
    transport,
    log: logger.log,
    errorMessage: logger.errorMessage,
    formatErrorDetails: logger.formatErrorDetails,
  });
  const canvas = useCanvasWorkspace({
    graph,
    connectionProfiles: providers.connectionProfiles,
    imageModelSelection: providers.imageModelSelection,
    chatModelSelection: providers.chatModelSelection,
    resolveModelSelection: providers.resolveModelSelection,
    firstModelSelection: providers.firstModelSelection,
    generationSettings: generation,
    transport,
    nextTaskId,
    errorMessage: logger.errorMessage,
  });
  const updater = useUpdater(systemFetch.fetch, logger.log, error);
  const appBusy = computed(
      () => images.loading.value || chat.chatLoading.value || canvas.canvasBusyCount.value > 0
  );

  async function setAppMode(mode: WorkspaceMode) {
    if (appBusy.value) return;
    resultHistory.closeResultContextMenu();
    resultHistory.closeResultLightbox();
    if (mode === "canvas") canvas.seedCanvas();
    await router.push({name: mode === "settings" ? "settings-models" : mode});
  }

  onMounted(async () => {
    await resultHistory.restoreResultHistory();
    if (appMode.value === "canvas") canvas.seedCanvas();
    if (settings.autoCheckUpdate.value) void updater.checkUpdate(false);
  });

  const viewModel = reactive({
    appBusy,
    ...providers,
    ...generation,
    ...settings,
    themeMode,
    ...updater,
    ...logger,
    ...images,
    ...resultHistory,
    ...chat,
    ...canvas,
    DEFAULT_MODEL_OPTIONS,
    DEFAULT_RETRY_STATUS_CODE_OPTIONS,
    setAppMode,
    modelSelectionKey,
    modelDisplayName,
  });

  return {appMode, appBusy, setAppMode, viewModel};
}
