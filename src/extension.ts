import * as vscode from "vscode";
import axios from "axios"; // Calling API Groq

export function activate(context: vscode.ExtensionContext) {
  const addBreakpointsCommand = vscode.commands.registerCommand(
    "groq.debugger",
    async () => {
      let apiKey = context.globalState.get<string>("groqApiKey");

      if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
          prompt: "Please enter your Groq API key",
          password: true,
        });

        if (!apiKey) {
          vscode.window.showErrorMessage("API key is required.");
          return;
        }

        try {
          const isValidApiKey = await verifyApiKey(apiKey);
          if (!isValidApiKey.valid) {
            const errorMessage =
              isValidApiKey.error || "Unknown error occurred.";
            let formattedMessage: string;
            if (
              typeof errorMessage === "object" &&
              errorMessage !== null &&
              "message" in errorMessage
            ) {
              formattedMessage = (errorMessage as { message: string }).message;
            } else if (typeof errorMessage === "object") {
              formattedMessage = JSON.stringify(errorMessage, null, 2);
            } else {
              formattedMessage = errorMessage as string;
            }
            vscode.window.showErrorMessage(formattedMessage);
            return;
          }
        } catch (error) {
          vscode.window.showErrorMessage("Error verifying API key.");
          return;
        }

        await context.globalState.update("groqApiKey", apiKey);
        vscode.window.showInformationMessage("API key has been saved.");
      }

      const prompt = await vscode.window.showInputBox({
        prompt: "Tell me what do you need to add as breakpoint",
      });

      if (!prompt) {
        vscode.window.showErrorMessage("Prompt not available.");
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No file opened.");
        return;
      }

      const document = editor.document;
      const linesWithNumbers = [];

      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        linesWithNumbers.push(`${i + 1}: ${line.text}`);
      }
      const code = linesWithNumbers.join("\n");
      vscode.window.showInformationMessage("Running analysis code...");

      try {
        const breakpoints = await analyzeCodeWithGroq(prompt, code, apiKey);
        addBreakpointsToDebugger(editor, breakpoints);
      } catch (error) {
        if (error instanceof Error) {
          vscode.window.showErrorMessage(`Error in analysis: ${error.message}`);
        } else {
          vscode.window.showErrorMessage("Unknown error in analysis.");
        }
      }
    }
  );

  context.subscriptions.push(addBreakpointsCommand);
}

async function verifyApiKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: "Verify my account",
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return { valid: true };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const apiError = error.response?.data?.error;
      return {
        valid: false,
        error: apiError || "Unknown API error occurred.",
      };
    } else if (error instanceof Error) {
      return {
        valid: false,
        error: error.message,
      };
    } else {
      // Caso di errore sconosciuto
      return {
        valid: false,
        error: "An unexpected error occurred.",
      };
    }
  }
}

async function analyzeCodeWithGroq(
  prompt: string,
  code: string,
  apiKey: string
): Promise<number[]> {
  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are an assistant debugger AI." +
            "Just return me the line numbers of the code I send you as requested by my prompt preceded by the word line." +
            "Always exclude lines where breakpoint cannot be set like whitespace and parentheses",
        },
        { role: "user", content: `${prompt}\n\nCode:\n${code}` },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  const analysis = response.data.choices[0].message.content;
  return parseBreakpointsFromAnalysis(analysis);
}

function parseBreakpointsFromAnalysis(analysis: string): number[] {
  const lines: number[] = [];
  const regex = /line (\d+)/gi; // Search "line X" in the result
  let match;
  while ((match = regex.exec(analysis)) !== null) {
    lines.push(parseInt(match[1], 10));
  }
  return lines;
}

function addBreakpointsToDebugger(editor: vscode.TextEditor, lines: number[]) {
  const debugConfig = vscode.debug;
  const breakpoints = lines.map((line) => {
    const position = new vscode.Position(line - 1, 0); // Lines in VS Code are 0-based
    const location = new vscode.Location(editor.document.uri, position);
    return new vscode.SourceBreakpoint(location);
  });

  debugConfig.addBreakpoints(breakpoints);
  vscode.window.showInformationMessage(`Added ${lines.length} breakpoint.`);
}

export function deactivate() {}
