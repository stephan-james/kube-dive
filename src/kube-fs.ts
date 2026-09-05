import * as vscode from "vscode";
import type { KubectlClient } from "./kubectl";

export class KubeFileSystemProvider
	implements vscode.FileSystemProvider, vscode.Disposable
{
	private _onDidChangeFile = new vscode.EventEmitter<
		vscode.FileChangeEvent[]
	>();
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
		this._onDidChangeFile.event;

	private contextsCache: string[] | null = null;
	private namespacesCache: Map<string, string[]> = new Map();
	private podsCache: Map<string, string[]> = new Map();

	constructor(private kubectl: KubectlClient) {}

	public dispose(): void {
		this._onDidChangeFile.dispose();
	}

	private isMetaName(name: string): boolean {
		return (
			name.startsWith(".") ||
			name === "node_modules" ||
			name === "package.json" ||
			name === "tsconfig.json"
		);
	}

	watch(
		_uri: vscode.Uri,
		_options: { recursive: boolean; excludes: string[] },
	): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	public triggerFileChange(uri: vscode.Uri, isCreated: boolean) {
		this._onDidChangeFile.fire([
			{
				type: isCreated
					? vscode.FileChangeType.Created
					: vscode.FileChangeType.Changed,
				uri,
			},
		]);
	}

	public refresh(uri?: vscode.Uri) {
		if (!uri?.path || uri.path === "/") {
			this.contextsCache = null;
			this.namespacesCache.clear();
			this.podsCache.clear();
			this._onDidChangeFile.fire([
				{
					type: vscode.FileChangeType.Changed,
					uri: vscode.Uri.parse("kubedive:/"),
				},
			]);
			return;
		}

		const { context, namespace, pod } = this.parseUri(uri);
		if (context && !namespace) {
			this.namespacesCache.delete(context);
			for (const key of Array.from(this.podsCache.keys())) {
				if (key.startsWith(`${context}:`)) {
					this.podsCache.delete(key);
				}
			}
			this._onDidChangeFile.fire([
				{ type: vscode.FileChangeType.Changed, uri },
			]);
		} else if (context && namespace && !pod) {
			this.podsCache.delete(`${context}:${namespace}`);
			this._onDidChangeFile.fire([
				{ type: vscode.FileChangeType.Changed, uri },
			]);
		} else {
			this._onDidChangeFile.fire([
				{ type: vscode.FileChangeType.Changed, uri },
			]);
		}
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const { context, namespace, pod, path } = this.parseUri(uri);

		if (
			(context && this.isMetaName(context)) ||
			(namespace && this.isMetaName(namespace)) ||
			(pod && this.isMetaName(pod))
		) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		if (!context) {
			return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
		}
		if (!namespace) {
			return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
		}
		if (!pod) {
			return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
		}
		if (!path || path === "/") {
			return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
		}

		const stat = await this.kubectl.stat(namespace, pod, path, context);
		if (!stat) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return stat;
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const { context, namespace, pod, path } = this.parseUri(uri);

		if (
			(context && this.isMetaName(context)) ||
			(namespace && this.isMetaName(namespace)) ||
			(pod && this.isMetaName(pod))
		) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		if (!context) {
			if (!this.contextsCache) {
				this.contextsCache = await this.kubectl.getContexts();
			}
			return this.contextsCache.map((c) => [c, vscode.FileType.Directory]);
		}

		if (!namespace) {
			let namespaces = this.namespacesCache.get(context);
			if (!namespaces) {
				namespaces = await this.kubectl.getNamespaces(context);
				this.namespacesCache.set(context, namespaces);
			}
			return namespaces.map((ns) => [ns, vscode.FileType.Directory]);
		}

		if (!pod) {
			const cacheKey = `${context}:${namespace}`;
			let pods = this.podsCache.get(cacheKey);
			if (!pods) {
				pods = await this.kubectl.getPods(namespace, context);
				this.podsCache.set(cacheKey, pods);
			}
			return pods.map((p) => [p, vscode.FileType.Directory]);
		}

		const items = await this.kubectl.ls(namespace, pod, path || "/", context);
		return items.map((item) => [item.name, item.type]);
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		const { context, namespace, pod, path } = this.parseUri(uri);
		if (!context || !namespace || !pod || !path) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		await this.kubectl.mkdir(namespace, pod, path, context);
		this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Created, uri }]);
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const { context, namespace, pod, path } = this.parseUri(uri);
		if (!context || !namespace || !pod || !path) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (path === "/" || path === "") {
			throw vscode.FileSystemError.FileIsADirectory(uri);
		}

		const stat = await this.stat(uri);
		const maxBufferSizeMB =
			vscode.workspace
				.getConfiguration("kubedive")
				.get<number>("maxBufferSizeMB") || 100;
		const maxBufferSizeBytes = maxBufferSizeMB * 1024 * 1024;

		if (stat.size > maxBufferSizeBytes) {
			vscode.window.showWarningMessage(
				`File is too large completely load. Size exceeds the configured maximum of ${maxBufferSizeMB} MB.`,
			);
			throw vscode.FileSystemError.Unavailable(
				"File too large to load into buffer",
			);
		}

		return this.kubectl.cat(namespace, pod, path, context);
	}

	async writeFile(
		uri: vscode.Uri,
		content: Uint8Array,
		options: { create: boolean; overwrite: boolean },
	): Promise<void> {
		const { context, namespace, pod, path } = this.parseUri(uri);
		if (!context || !namespace || !pod || !path) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (path === "/" || path === "") {
			throw vscode.FileSystemError.FileIsADirectory(uri);
		}

		if (!options.overwrite) {
			try {
				await this.stat(uri);
				throw vscode.FileSystemError.FileExists(uri);
			} catch (e) {
				if (e instanceof vscode.FileSystemError && e.code === "FileNotFound") {
				} else {
					throw e;
				}
			}
		}

		const filename = path.split("/").pop() || "file";
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Window,
				title: `Uploading ${filename}...`,
				cancellable: false,
			},
			async () => {
				await this.kubectl.saveFile(namespace, pod, path, content, context);
			},
		);

		vscode.window.showInformationMessage(`Uploaded ${filename} successfully`);
		this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
	}

	async delete(
		uri: vscode.Uri,
		_options: { recursive: boolean },
	): Promise<void> {
		const { context, namespace, pod, path } = this.parseUri(uri);
		if (!context || !namespace || !pod || !path) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (path === "/" || path === "") {
			throw vscode.FileSystemError.NoPermissions(
				"Deleting pod root is not permitted",
			);
		}
		await this.kubectl.rm(namespace, pod, path, context);
		this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
	}

	async rename(
		oldUri: vscode.Uri,
		newUri: vscode.Uri,
		_options: { overwrite: boolean },
	): Promise<void> {
		const oldParsed = this.parseUri(oldUri);
		const newParsed = this.parseUri(newUri);

		if (
			!oldParsed.context ||
			!oldParsed.namespace ||
			!oldParsed.pod ||
			!oldParsed.path
		) {
			throw vscode.FileSystemError.FileNotFound(oldUri);
		}
		if (!newParsed.path) {
			throw vscode.FileSystemError.FileNotFound(newUri);
		}

		if (
			oldParsed.context !== newParsed.context ||
			oldParsed.namespace !== newParsed.namespace ||
			oldParsed.pod !== newParsed.pod
		) {
			throw vscode.FileSystemError.NoPermissions(
				"Cannot rename across pods/namespaces/contexts",
			);
		}

		await this.kubectl.mv(
			oldParsed.namespace,
			oldParsed.pod,
			oldParsed.path,
			newParsed.path,
			oldParsed.context,
		);
		this._onDidChangeFile.fire([
			{ type: vscode.FileChangeType.Deleted, uri: oldUri },
			{ type: vscode.FileChangeType.Created, uri: newUri },
		]);
	}

	async copy(
		source: vscode.Uri,
		destination: vscode.Uri,
		options: { overwrite: boolean },
	): Promise<void> {
		const srcParsed = this.parseUri(source);
		const destParsed = this.parseUri(destination);

		if (
			!srcParsed.context ||
			!srcParsed.namespace ||
			!srcParsed.pod ||
			!srcParsed.path ||
			!destParsed.context ||
			!destParsed.namespace ||
			!destParsed.pod ||
			!destParsed.path
		) {
			throw vscode.FileSystemError.FileNotFound(source);
		}

		const srcContext = srcParsed.context;
		const srcNamespace = srcParsed.namespace;
		const srcPod = srcParsed.pod;
		const srcPath = srcParsed.path;
		const destContext = destParsed.context;
		const destNamespace = destParsed.namespace;
		const destPod = destParsed.pod;
		const destPath = destParsed.path;

		if (!options.overwrite) {
			try {
				await this.stat(destination);
				throw vscode.FileSystemError.FileExists(destination);
			} catch (e) {
				if (e instanceof vscode.FileSystemError && e.code === "FileNotFound") {
				} else {
					throw e;
				}
			}
		}

		const filename = destination.path.split("/").pop() || "file";
		const stat = await this.stat(source);
		const isDir = stat.type === vscode.FileType.Directory;
		const tempDestPath = `${destPath}.kd-download`;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Window,
				title: `Copying ${filename}...`,
				cancellable: false,
			},
			async () => {
				await this.kubectl.cpPodToPod(
					srcContext,
					srcNamespace,
					srcPod,
					srcPath,
					destContext,
					destNamespace,
					destPod,
					tempDestPath,
					isDir,
				);
				await this.kubectl.mv(
					destNamespace,
					destPod,
					tempDestPath,
					destPath,
					destContext,
				);
			},
		);

		vscode.window.showInformationMessage(`Copied ${filename} successfully`);
		this._onDidChangeFile.fire([
			{ type: vscode.FileChangeType.Created, uri: destination },
		]);
	}

	private parseUri(uri: vscode.Uri): {
		context?: string;
		namespace?: string;
		pod?: string;
		path?: string;
	} {
		const parts = uri.path.split("/").filter((p) => p);
		if (parts.length === 0) return {};
		if (parts.length === 1) return { context: parts[0] };
		if (parts.length === 2) return { context: parts[0], namespace: parts[1] };
		if (parts.length === 3) {
			return {
				context: parts[0],
				namespace: parts[1],
				pod: parts[2],
				...(uri.path.endsWith("/") ? { path: "/" } : {}),
			};
		}
		return {
			context: parts[0],
			namespace: parts[1],
			pod: parts[2],
			path: `/${parts.slice(3).join("/")}`,
		};
	}
}
