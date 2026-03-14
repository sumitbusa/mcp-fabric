import * as vscode from "vscode";
import { performance } from "node:perf_hooks";
import { AIProvider } from "./ai/provider";
import { CopilotProvider } from "./ai/copilotProvider";
import { OllamaProvider } from "./ai/ollamaProvider";
import { buildCatalogEnrichmentPrompt } from "./prompts";
import { scanWorkspace } from "./scanner";
import { CacheIndex, MCPCatalog, MCPToolMetadata } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mcpFabric.enrichCurrentWorkspace", async () => {
      try {
        await enrichCurrentWorkspace();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`MCP Fabric failed: ${message}`);
      }
    }),
    vscode.commands.registerCommand("mcpFabric.showCatalogMetrics", async () => {
      try {
        await showCatalogMetrics();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`MCP Fabric failed: ${message}`);
      }
    })
  );
}

export function deactivate(): void {}

async function enrichCurrentWorkspace(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a workspace folder first.");
  }

  const config = vscode.workspace.getConfiguration("mcpFabric", folder.uri);
  const startedAt = performance.now();
  const scanResult = await scanWorkspace(folder);

  if (scanResult.routes.length === 0) {
    throw new Error("No API routes were discovered in the current workspace.");
  }

  const cacheIndexPath = vscode.Uri.joinPath(folder.uri, config.get<string>("cacheIndexFile", "generated/cache-index.json"));
  const cacheIndex = await readCacheIndex(cacheIndexPath);
  const cached = cacheIndex.projects[folder.name];
  const forceRescan = config.get<boolean>("forceRescan", false);

  const catalogDir = vscode.Uri.joinPath(folder.uri, config.get<string>("outputCatalogDir", "generated/catalog"));
  const metricsDir = vscode.Uri.joinPath(folder.uri, config.get<string>("outputMetricsDir", "generated/metrics"));
  const catalogPath = vscode.Uri.joinPath(catalogDir, `${folder.name}.json`);
  const rawPath = vscode.Uri.joinPath(catalogDir, `${folder.name}.raw.txt`);
  const metricsPath = vscode.Uri.joinPath(metricsDir, `${folder.name}-extension-metrics.json`);

  await vscode.workspace.fs.createDirectory(catalogDir);
  await vscode.workspace.fs.createDirectory(metricsDir);

  if (!forceRescan && cached?.fingerprint === scanResult.fingerprint) {
    const cacheMetrics = {
      measuredAt: new Date().toISOString(),
      workspace: folder.name,
      routeCount: cached.routeCount,
      scannedFiles: scanResult.scannedFiles,
      cacheHit: true,
      provider: cached.enrichedBy || "cached",
      scanDurationMs: Number((performance.now() - startedAt).toFixed(2)),
      catalogPath: catalogPath.fsPath
    };
    await writeJson(metricsPath, cacheMetrics);

    const action = await vscode.window.showInformationMessage(
      `MCP Fabric reused the cached catalog for ${folder.name}.`,
      "Open Catalog",
      "Open Metrics"
    );
    if (action === "Open Catalog") {
      await openDocument(catalogPath);
    } else if (action === "Open Metrics") {
      await openDocument(metricsPath);
    }
    return;
  }

  const provider = await pickProvider(config);
  if (!provider) {
    return;
  }

  const prompt = buildCatalogEnrichmentPrompt(folder.name, scanResult.routes);
  const cts = new vscode.CancellationTokenSource();
  const rawText = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `MCP Fabric: enriching ${folder.name} with ${provider.name}`,
      cancellable: true
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => cts.cancel());
      return provider.generate(prompt, cts.token);
    }
  );

  const catalog = normalizeCatalog(parseCatalogJson(rawText), folder.name, folder.uri.fsPath, scanResult.routes.length);
  catalog.enrichedBy = provider.name;
  catalog.scannedAt = new Date().toISOString();

  await vscode.workspace.fs.writeFile(rawPath, Buffer.from(rawText, "utf8"));
  await writeJson(catalogPath, catalog);

  cacheIndex.projects[folder.name] = {
    fingerprint: scanResult.fingerprint,
    routeCount: catalog.tools.length,
    updatedAt: new Date().toISOString(),
    enrichedBy: provider.name,
    source: "vscode-extension"
  };
  await writeJson(cacheIndexPath, cacheIndex);

  const metrics = {
    measuredAt: new Date().toISOString(),
    workspace: folder.name,
    routeCount: catalog.tools.length,
    scannedFiles: scanResult.scannedFiles,
    cacheHit: false,
    provider: provider.name,
    scanDurationMs: Number((performance.now() - startedAt).toFixed(2)),
    catalogPath: catalogPath.fsPath,
    assumptionsCount: catalog.assumptions.length
  };
  await writeJson(metricsPath, metrics);

  const action = await vscode.window.showInformationMessage(
    `MCP Fabric generated ${catalog.tools.length} tools for ${folder.name}.`,
    "Open Catalog",
    "Open Metrics"
  );
  if (action === "Open Catalog") {
    await openDocument(catalogPath);
  } else if (action === "Open Metrics") {
    await openDocument(metricsPath);
  }
}

async function showCatalogMetrics(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a workspace folder first.");
  }

  const metricsPath = vscode.Uri.joinPath(folder.uri, "generated/metrics", `${folder.name}-extension-metrics.json`);
  try {
    await openDocument(metricsPath);
  } catch {
    throw new Error("No extension metrics file found yet. Run 'MCP Fabric: Enrich Current Workspace' first.");
  }
}

async function pickProvider(config: vscode.WorkspaceConfiguration): Promise<AIProvider | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "Copilot (VS Code entitlement)",
        description: "Use VS Code Language Model API with a Copilot-backed model",
        value: "copilot"
      },
      {
        label: "Local Ollama (Llama)",
        description: "Use Ollama running on localhost",
        value: "ollama"
      }
    ],
    { placeHolder: "Choose the provider used to enrich this workspace catalog" }
  );

  if (!choice) {
    return undefined;
  }

  if (choice.value === "copilot") {
    return new CopilotProvider(config.get<string>("copilotFamily", "gpt-4o"));
  }

  return new OllamaProvider(
    config.get<string>("ollamaBaseUrl", "http://localhost:11434"),
    config.get<string>("ollamaModel", "llama3.1")
  );
}

function parseCatalogJson(rawText: string): MCPCatalog {
  const trimmed = rawText.trim();
  const cleaned = trimmed.startsWith("{") && trimmed.endsWith("}")
    ? trimmed
    : extractJsonObject(trimmed);

  const parsed = JSON.parse(cleaned) as MCPCatalog;
  if (!parsed || !Array.isArray(parsed.tools) || !Array.isArray(parsed.assumptions)) {
    throw new Error("Model output is missing the required catalog structure.");
  }
  return parsed;
}

function extractJsonObject(text: string): string {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return fence[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  throw new Error("Could not locate a JSON object in the model response.");
}

function normalizeCatalog(catalog: MCPCatalog, workspaceName: string, rootDir: string, routeCount: number): MCPCatalog {
  const tools = Array.isArray(catalog.tools) ? catalog.tools : [];
  const normalizedTools: MCPToolMetadata[] = tools.map((tool, index) => ({
    name: tool.name || `tool_${index + 1}`,
    title: tool.title || tool.name || `Tool ${index + 1}`,
    description: tool.description || `${tool.method || "GET"} ${tool.path || "/"}`,
    method: tool.method || "GET",
    path: tool.path || "/",
    framework: tool.framework,
    sourceFile: tool.sourceFile,
    safe: typeof tool.safe === "boolean" ? tool.safe : String(tool.method || "GET").toUpperCase() === "GET",
    inputSchema: tool.inputSchema || { type: "object", properties: {}, required: [] }
  }));

  return {
    serviceName: catalog.serviceName || workspaceName,
    baseUrl: catalog.baseUrl || "http://localhost:0000",
    scannedAt: catalog.scannedAt || new Date().toISOString(),
    rootDir: catalog.rootDir || rootDir,
    domainKeywords: Array.isArray(catalog.domainKeywords) && catalog.domainKeywords.length > 0
      ? catalog.domainKeywords
      : [workspaceName, "api", "service"],
    tools: normalizedTools,
    assumptions: Array.isArray(catalog.assumptions) && catalog.assumptions.length > 0
      ? catalog.assumptions
      : [`Generated from ${routeCount} discovered routes.`]
  };
}

async function readCacheIndex(uri: vscode.Uri): Promise<CacheIndex> {
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(raw).toString("utf8")) as CacheIndex;
  } catch {
    return { projects: {} };
  }
}

async function writeJson(uri: vscode.Uri, value: unknown): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
}

async function openDocument(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}
