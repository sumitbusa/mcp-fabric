import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { DiscoveredRoute, HttpMethod } from "./types";

const EXCLUDE_GLOB = "**/{node_modules,.git,dist,build,target,coverage,out,.next,.turbo}/**";

function normalizePath(input: string): string {
  let routePath = String(input || "/").trim();
  if (!routePath.startsWith("/")) {
    routePath = `/${routePath}`;
  }
  return routePath.replace(/\/+/g, "/");
}

function inferPathParams(routePath: string): string[] {
  const params = new Set<string>();
  for (const match of routePath.matchAll(/:([A-Za-z0-9_]+)/g)) {
    params.add(match[1]);
  }
  for (const match of routePath.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    params.add(match[1]);
  }
  return [...params];
}

function buildInputSchema(method: string, routePath: string): Record<string, unknown> {
  const pathParams = inferPathParams(routePath);
  const properties: Record<string, unknown> = {};

  for (const param of pathParams) {
    properties[param] = {
      type: "string",
      description: `Path parameter: ${param}`
    };
  }

  if (method === "GET") {
    properties.query = {
      type: "object",
      description: "Optional query parameters"
    };
  } else {
    properties.body = {
      type: "object",
      description: "Optional request body"
    };
  }

  return {
    type: "object",
    properties,
    required: pathParams
  };
}

function toToolName(method: string, routePath: string): string {
  const cleaned = routePath
    .replace(/[:{}]/g, "")
    .replace(/[\/\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${method.toLowerCase()}_${cleaned || "root"}`;
}

function addRoute(
  routes: DiscoveredRoute[],
  method: string,
  path: string,
  framework: string,
  file: string,
  snippet?: string
): void {
  const upper = method.toUpperCase() as HttpMethod;
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upper)) {
    return;
  }

  const normalizedPath = normalizePath(path);
  routes.push({
    method: upper,
    path: normalizedPath,
    framework,
    file,
    snippet,
    safe: upper === "GET",
    toolName: toToolName(upper, normalizedPath),
    inputSchema: buildInputSchema(upper, normalizedPath)
  });
}

function scanText(relativeFile: string, text: string, routes: DiscoveredRoute[]): void {
  let match: RegExpExecArray | null;

  const expressPattern = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  while ((match = expressPattern.exec(text)) !== null) {
    addRoute(routes, match[1], match[2], "express", relativeFile, match[0]);
  }

  const fastApiPattern = /@(?:app|router)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  while ((match = fastApiPattern.exec(text)) !== null) {
    addRoute(routes, match[1], match[2], "fastapi", relativeFile, match[0]);
  }

  const springPattern = /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\((?:[^)]*?["']([^"']+)["'][^)]*)?\)/g;
  while ((match = springPattern.exec(text)) !== null) {
    addRoute(routes, match[1].replace("Mapping", ""), match[2] || "/", "spring", relativeFile, match[0]);
  }

  const nestPattern = /@(Get|Post|Put|Patch|Delete)\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = nestPattern.exec(text)) !== null) {
    addRoute(routes, match[1], match[2], "nest", relativeFile, match[0]);
  }
}

export async function scanWorkspace(folder: vscode.WorkspaceFolder): Promise<{ fingerprint: string; routes: DiscoveredRoute[]; scannedFiles: number }> {
  const config = vscode.workspace.getConfiguration("mcpFabric", folder.uri);
  const maxFiles = config.get<number>("maxFiles", 250);
  const maxFileSizeKb = config.get<number>("maxFileSizeKb", 256);
  const maxBytes = maxFileSizeKb * 1024;

  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*.{js,jsx,ts,tsx,java,py}"),
    EXCLUDE_GLOB,
    maxFiles
  );

  const routes: DiscoveredRoute[] = [];
  const hash = createHash("sha1");
  let scannedFiles = 0;

  for (const uri of uris) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxBytes) {
        continue;
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      const relativeFile = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
      hash.update(relativeFile);
      hash.update(bytes);
      scanText(relativeFile, Buffer.from(bytes).toString("utf8"), routes);
      scannedFiles += 1;
    } catch {
      // ignore unreadable files
    }
  }

  const deduped = new Map<string, DiscoveredRoute>();
  for (const route of routes) {
    deduped.set(`${route.method}|${route.path}|${route.file}`, route);
  }

  return {
    fingerprint: hash.digest("hex"),
    routes: [...deduped.values()].sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`)),
    scannedFiles
  };
}
