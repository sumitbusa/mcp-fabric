import * as vscode from "vscode";
import { AIProvider } from "./provider";

interface OllamaResponse {
  message?: {
    content?: string;
  };
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  constructor(private readonly baseUrl: string, private readonly model: string) {}

  async generate(prompt: string, _token: vscode.CancellationToken): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/api/chat`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content: [
              "You are an expert API platform engineer.",
              "Convert discovered HTTP routes into MCP Fabric catalog JSON.",
              "Return only valid JSON.",
              "Do not wrap the response in markdown fences.",
              "Be conservative and avoid inventing required body fields."
            ].join(" ")
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Ollama request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as OllamaResponse;
    const content = data.message?.content?.trim();
    if (!content) {
      throw new Error("Ollama returned an empty response.");
    }
    return content;
  }
}
