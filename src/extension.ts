import { rename } from "node:fs/promises";
import * as vscode from "vscode";
import { KubeDecorationProvider } from "./decoration-provider";
import { KubeFileSystemProvider } from "./kube-fs";
import { KubectlClient } from "./kubectl";

export function activate(context: vscode.ExtensionContext) {
	const kubectl = new KubectlClient();
	const kubeFs = new KubeFileSystemProvider(kubectl);
	const decorationProvider = new KubeDecorationProvider();

	context.subscriptions.push(
		kubeFs,
		decorationProvider,
		vscode.workspace.registerFileSystemProvider("kubedive", kubeFs, {
			isCaseSensitive: true,
		}),
		vscode.window.registerFileDecorationProvider(decorationProvider),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"kubedive.openShell",
			async (uri: vscode.Uri) => {
				const parts = uri.path.split("/").filter((p) => p);
				if (parts.length < 3) {
					vscode.window.showErrorMessage("Cannot open shell: Invalid pod URI");
					return;
				}
				const contextName = parts[0];
				const namespace = parts[1];
				const pod = parts[2];
				const pathInPod =
					parts.length > 3 ? `/${parts.slice(3).join("/")}` : undefined;

				const terminal = vscode.window.createTerminal(
					`Pod: ${pod} (${contextName})`,
				);
				const kubectlPath =
					vscode.workspace
						.getConfiguration("kubedive")
						.get<string>("kubectlPath") || "kubectl";

				const escapedContext = contextName.replace(/(["$`\\])/g, "\\$1");
				const escapedNamespace = namespace.replace(/(["$`\\])/g, "\\$1");
				const escapedPod = pod.replace(/(["$`\\])/g, "\\$1");

				terminal.sendText(
					`"${kubectlPath}" --context "${escapedContext}" exec -it -n "${escapedNamespace}" "${escapedPod}" -- sh`,
				);

				if (pathInPod) {
					const escapedPath = pathInPod.replace(/(["$`\\])/g, "\\$1");
					const parentDir =
						escapedPath.substring(0, escapedPath.lastIndexOf("/")) || "/";
					terminal.sendText(
						`cd "${escapedPath}" 2>/dev/null || cd "${parentDir}"`,
					);
				}
				terminal.show();
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"kubedive.download",
			async (uri: vscode.Uri) => {
				const parts = uri.path.split("/").filter((p) => p);
				if (parts.length < 4) {
					vscode.window.showErrorMessage("Cannot download: Select a file");
					return;
				}

				const contextName = parts[0];
				const namespace = parts[1];
				const pod = parts[2];
				const pathInPod = `/${parts.slice(3).join("/")}`;
				const filename = parts[parts.length - 1];

				const saveUri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(filename),
					saveLabel: "Download",
				});

				if (saveUri) {
					try {
						const tempPath = `${saveUri.fsPath}.kd-download`;
						await vscode.window.withProgress(
							{
								location: vscode.ProgressLocation.Window,
								title: `Downloading ${filename}...`,
								cancellable: false,
							},
							async () => {
								await kubectl.cpFromPod(
									namespace,
									pod,
									pathInPod,
									tempPath,
									contextName,
								);
								await rename(tempPath, saveUri.fsPath);
							},
						);
						vscode.window.showInformationMessage(`Downloaded ${filename}`);
					} catch (e: unknown) {
						const message = e instanceof Error ? e.message : String(e);
						vscode.window.showErrorMessage(`Download failed: ${message}`);
					}
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"kubedive.downloadFile",
			async (uri: vscode.Uri) => {
				const parts = uri.path.split("/").filter((p) => p);
				if (parts.length < 4) {
					vscode.window.showErrorMessage("Cannot download: Select a file");
					return;
				}

				const contextName = parts[0];
				const namespace = parts[1];
				const pod = parts[2];
				const pathInPod = `/${parts.slice(3).join("/")}`;
				const filename = parts[parts.length - 1];

				const saveUri = await vscode.window.showOpenDialog({
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					openLabel: "Select target directory",
				});

				if (saveUri?.[0]) {
					try {
						if (saveUri[0].scheme === "kubedive") {
							const targetParts = saveUri[0].path.split("/").filter((p) => p);
							if (targetParts.length < 3) {
								vscode.window.showErrorMessage(
									"Invalid target remote directory",
								);
								return;
							}
							const targetContext = targetParts[0];
							const targetNamespace = targetParts[1];
							const targetPod = targetParts[2];
							const targetPath = `/${targetParts.slice(3).join("/")}`;
							const finalDestPath =
								targetPath + (targetPath.endsWith("/") ? "" : "/") + filename;
							const tempDestPath = `${finalDestPath}.kd-download`;

							const existingStat = await kubectl.stat(
								targetNamespace,
								targetPod,
								finalDestPath,
								targetContext,
							);
							if (existingStat !== null) {
								const answer = await vscode.window.showWarningMessage(
									`A file or folder named '${filename}' already exists in the destination pod. Do you want to overwrite it?`,
									{ modal: true },
									"Overwrite",
								);
								if (answer !== "Overwrite") {
									return;
								}
							}

							await vscode.window.withProgress(
								{
									location: vscode.ProgressLocation.Window,
									title: `Copying ${filename} to ${targetPod}...`,
									cancellable: false,
								},
								async () => {
									await kubectl.cpPodToPod(
										contextName,
										namespace,
										pod,
										pathInPod,
										targetContext,
										targetNamespace,
										targetPod,
										tempDestPath,
										false,
									);
									await kubectl.mv(
										targetNamespace,
										targetPod,
										tempDestPath,
										finalDestPath,
										targetContext,
									);
								},
							);
							vscode.window.showInformationMessage(
								`Copied ${filename} to ${targetPod}:${targetPath}`,
							);
							kubeFs.triggerFileChange(
								vscode.Uri.joinPath(saveUri[0], filename),
								true,
							);
						} else {
							const localPath = vscode.Uri.joinPath(
								saveUri[0],
								filename,
							).fsPath;
							const localUri = vscode.Uri.file(localPath);

							try {
								await vscode.workspace.fs.stat(localUri);
								const answer = await vscode.window.showWarningMessage(
									`A file or folder named '${filename}' already exists locally. Do you want to overwrite it?`,
									{ modal: true },
									"Overwrite",
								);
								if (answer !== "Overwrite") {
									return;
								}
							} catch (_e) {}

							const tempPath = `${localPath}.kd-download`;
							await vscode.window.withProgress(
								{
									location: vscode.ProgressLocation.Window,
									title: `Downloading ${filename}...`,
									cancellable: false,
								},
								async () => {
									await kubectl.cpFromPod(
										namespace,
										pod,
										pathInPod,
										tempPath,
										contextName,
									);
									await rename(tempPath, localPath);
								},
							);
							vscode.window.showInformationMessage(
								`Downloaded ${filename} to ${saveUri[0].fsPath}`,
							);
						}
					} catch (e: unknown) {
						const message = e instanceof Error ? e.message : String(e);
						vscode.window.showErrorMessage(`Download failed: ${message}`);
					}
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"kubedive.refresh",
			async (uri?: vscode.Uri) => {
				kubeFs.refresh(uri);
			},
		),
	);

	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	const kubeDiveUri = vscode.Uri.parse("kubedive:/");
	if (!workspaceFolders.find((f) => f.uri.scheme === "kubedive")) {
		vscode.workspace.updateWorkspaceFolders(workspaceFolders.length, 0, {
			uri: kubeDiveUri,
			name: "⍟ Kube Dive",
		});
	}

	try {
		const searchConfig = vscode.workspace.getConfiguration(
			"search",
			kubeDiveUri,
		);
		const searchExclude =
			searchConfig.get<Record<string, boolean>>("exclude") || {};
		if (!searchExclude["**"]) {
			searchConfig.update(
				"exclude",
				{ ...searchExclude, "**": true },
				vscode.ConfigurationTarget.WorkspaceFolder,
			);
		}

		const filesConfig = vscode.workspace.getConfiguration("files", kubeDiveUri);
		const watcherExclude =
			filesConfig.get<Record<string, boolean>>("watcherExclude") || {};
		if (!watcherExclude["**"]) {
			filesConfig.update(
				"watcherExclude",
				{ ...watcherExclude, "**": true },
				vscode.ConfigurationTarget.WorkspaceFolder,
			);
		}
	} catch (_e) {}
}

export function deactivate() {}
