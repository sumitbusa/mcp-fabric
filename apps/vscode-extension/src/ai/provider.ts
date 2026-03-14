import * as vscode from "vscode";

export interface AIProvider {
  readonly name: string;
  generate(prompt: string, token: vscode.CancellationToken): Promise<string>;
}
