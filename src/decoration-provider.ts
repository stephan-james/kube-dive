import * as vscode from "vscode";

export class KubeDecorationProvider
	implements vscode.FileDecorationProvider, vscode.Disposable
{
	private _onDidChangeFileDecorations = new vscode.EventEmitter<
		vscode.Uri | vscode.Uri[] | undefined
	>();
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

	dispose(): void {
		this._onDidChangeFileDecorations.dispose();
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (uri.scheme !== "kubedive") {
			return undefined;
		}

		const parts = uri.path.split("/").filter((p) => p);

		if (parts.length === 1) {
			return {
				color: new vscode.ThemeColor("charts.yellow"),
				tooltip: "Kubernetes Context",
				badge: "⎈",
			};
		}

		if (parts.length === 2) {
			return {
				color: new vscode.ThemeColor("charts.green"),
				tooltip: "Kubernetes Namespace",
				badge: "⛶",
			};
		}

		if (parts.length === 3) {
			return {
				color: new vscode.ThemeColor("charts.blue"),
				tooltip: "Kubernetes Pod",
				badge: "⊡",
			};
		}

		return undefined;
	}
}
