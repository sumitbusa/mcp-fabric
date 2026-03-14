import * as vscode from "vscode";
import { AIProvider } from "./provider";

export class CopilotProvider implements AIProvider {
  readonly name = "copilot";

  constructor(private readonly preferredFamily: string) {}

  async generate(prompt: string, token: vscode.CancellationToken): Promise<string> {
    let models = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: this.preferredFamily
    });

    if (models.length === 0) {
      models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    }

    if (models.length === 0) {
      throw new Error("No Copilot-backed models are available in this VS Code session.");
    }

    const model = models[0];
    const messages = [
      vscode.LanguageModelChatMessage.User(
        [
          "You are an expert API platform engineer.",
          "Convert discovered HTTP routes into MCP Fabric catalog JSON.",
          "Return only valid JSON.",
          "Do not wrap the response in markdown fences.",
          "Be conservative and avoid inventing required body fields."
        ].join(" ")
      ),
      vscode.LanguageModelChatMessage.User(prompt)
    ];

    const response = await model.sendRequest(messages, {}, token);
    let result = "";
    for await (const chunk of response.text) {
      result += chunk;
    }
    return result.trim();
  }
}
