# MCP Fabric VS Code Extension

This extension is the Copilot/Ollama-powered add-on for the main **MCP Fabric POC**.

It scans the currently opened workspace, detects API routes, enriches them with either:
- **GitHub Copilot through VS Code's Language Model API**, or
- **local Ollama / Llama**

Then it writes the result back into the same catalog structure used by the generator CLI:
- `generated/catalog/<workspace>.json`
- `generated/cache-index.json`
- `generated/metrics/<workspace>-extension-metrics.json`

## Commands

- `MCP Fabric: Enrich Current Workspace`
- `MCP Fabric: Show Catalog Metrics`

## Run steps

### Option A: run the extension directly

1. Open `apps/vscode-extension` in VS Code.
2. Run:

```bash
npm install
npm run compile
```

3. Press `F5`.
4. In the Extension Development Host window, open any API repo.
5. Run `MCP Fabric: Enrich Current Workspace`.
6. Choose either:
   - **Copilot (VS Code entitlement)**
   - **Local Ollama (Llama)**

### Option B: use local Ollama

Start Ollama first:

```bash
ollama serve
ollama run llama3.1
```

Then use the extension command and select **Local Ollama (Llama)**.

## What the extension measures

It writes measurable metrics so the demo is not only qualitative:
- route count
- scanned file count
- provider used
- cache hit / miss
- scan duration ms
- catalog path

## Notes

- The extension intentionally uses **file-based local cache** for the MVP, not ChromaDB, to keep setup friction low.
- For enterprise scale, you can replace the file cache with SQLite, Postgres, or a vector store later.
