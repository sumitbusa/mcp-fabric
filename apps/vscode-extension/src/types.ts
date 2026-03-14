export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface DiscoveredRoute {
  method: HttpMethod;
  path: string;
  framework: string;
  file: string;
  snippet?: string;
  safe: boolean;
  toolName: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolMetadata {
  name: string;
  title: string;
  description: string;
  method: string;
  path: string;
  framework?: string;
  sourceFile?: string;
  safe: boolean;
  inputSchema: Record<string, unknown>;
}

export interface MCPCatalog {
  serviceName: string;
  baseUrl: string;
  scannedAt: string;
  rootDir: string;
  domainKeywords: string[];
  tools: MCPToolMetadata[];
  assumptions: string[];
  enrichedBy?: string;
}

export interface CacheIndex {
  projects: Record<string, {
    fingerprint: string;
    routeCount: number;
    updatedAt: string;
    enrichedBy?: string;
    source?: string;
  }>;
}
