import * as assert from "node:assert";
import { KubeFileSystemProvider } from "../kube-fs";
import type { KubectlClient } from "../kubectl";
import * as vscode from "./mocks/vscode";

class StubKubectlClient {
	calls: { method: string; args: any[] }[] = [];

	contextList: string[] = ["ctx-a", "ctx-b"];
	namespaceList: string[] = ["default", "kube-system"];
	podList: string[] = ["pod-1", "pod-2"];
	lsResult: { name: string; type: any }[] = [
		{ name: "bin", type: vscode.FileType.Directory },
		{ name: "app.js", type: vscode.FileType.File },
	];
	statResult: any = {
		type: vscode.FileType.File,
		ctime: 0,
		mtime: 0,
		size: 512,
	};
	catResult: Uint8Array = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

	async getContexts(): Promise<string[]> {
		this.calls.push({ method: "getContexts", args: [] });
		return this.contextList;
	}

	async getNamespaces(context?: string): Promise<string[]> {
		this.calls.push({ method: "getNamespaces", args: [context] });
		return this.namespaceList;
	}

	async getPods(namespace: string, context?: string): Promise<string[]> {
		this.calls.push({ method: "getPods", args: [namespace, context] });
		return this.podList;
	}

	async ls(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<{ name: string; type: any }[]> {
		this.calls.push({ method: "ls", args: [namespace, pod, path, context] });
		return this.lsResult;
	}

	async cat(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<Uint8Array> {
		this.calls.push({ method: "cat", args: [namespace, pod, path, context] });
		return this.catResult;
	}

	async saveFile(
		namespace: string,
		pod: string,
		filePath: string,
		content: Uint8Array,
		context?: string,
	): Promise<void> {
		this.calls.push({
			method: "saveFile",
			args: [namespace, pod, filePath, content, context],
		});
	}

	async stat(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<any> {
		this.calls.push({ method: "stat", args: [namespace, pod, path, context] });
		return this.statResult;
	}

	async mkdir(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<void> {
		this.calls.push({ method: "mkdir", args: [namespace, pod, path, context] });
	}

	async rm(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<void> {
		this.calls.push({ method: "rm", args: [namespace, pod, path, context] });
	}

	async mv(
		namespace: string,
		pod: string,
		oldPath: string,
		newPath: string,
		context?: string,
	): Promise<void> {
		this.calls.push({
			method: "mv",
			args: [namespace, pod, oldPath, newPath, context],
		});
	}

	async cpFromPod(
		namespace: string,
		pod: string,
		remotePath: string,
		localPath: string,
		context?: string,
	): Promise<void> {
		this.calls.push({
			method: "cpFromPod",
			args: [namespace, pod, remotePath, localPath, context],
		});
	}

	async cpToPod(
		namespace: string,
		pod: string,
		localPath: string,
		remotePath: string,
		context?: string,
	): Promise<void> {
		this.calls.push({
			method: "cpToPod",
			args: [namespace, pod, localPath, remotePath, context],
		});
	}

	async cpPodToPod(
		srcContext: string,
		srcNamespace: string,
		srcPod: string,
		srcPath: string,
		destContext: string,
		destNamespace: string,
		destPod: string,
		destPath: string,
		isDirectory: boolean,
	): Promise<void> {
		this.calls.push({
			method: "cpPodToPod",
			args: [
				srcContext,
				srcNamespace,
				srcPod,
				srcPath,
				destContext,
				destNamespace,
				destPod,
				destPath,
				isDirectory,
			],
		});
	}
}

describe("KubeFileSystemProvider", () => {
	let stubKubectl: StubKubectlClient;
	let provider: KubeFileSystemProvider;

	beforeEach(() => {
		stubKubectl = new StubKubectlClient();
		provider = new KubeFileSystemProvider(
			stubKubectl as unknown as KubectlClient,
		);
		vscode.resetConfigOverrides();
		vscode.resetMessageCalls();
	});

	describe("stat", () => {
		it("should return Directory for root URI", async () => {
			const uri = vscode.Uri.parse("kubedive:/") as any;
			const stat = await provider.stat(uri);
			assert.strictEqual(stat.type, vscode.FileType.Directory);
		});

		it("should return Directory for context-only URI", async () => {
			const uri = vscode.Uri.parse("kubedive:/my-context") as any;
			const stat = await provider.stat(uri);
			assert.strictEqual(stat.type, vscode.FileType.Directory);
		});

		it("should return Directory for namespace URI", async () => {
			const uri = vscode.Uri.parse("kubedive:/my-context/default") as any;
			const stat = await provider.stat(uri);
			assert.strictEqual(stat.type, vscode.FileType.Directory);
		});

		it("should return Directory for pod URI", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod",
			) as any;
			const stat = await provider.stat(uri);
			assert.strictEqual(stat.type, vscode.FileType.Directory);
		});

		it("should call kubectl.stat for file URI", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/etc/config",
			) as any;
			const stat = await provider.stat(uri);
			assert.strictEqual(stat.type, vscode.FileType.File);
			assert.strictEqual(stat.size, 512);
			const call = stubKubectl.calls.find((c) => c.method === "stat");
			assert.ok(call);
			assert.strictEqual(call?.args[0], "default");
			assert.strictEqual(call?.args[1], "my-pod");
			assert.strictEqual(call?.args[2], "/etc/config");
			assert.strictEqual(call?.args[3], "my-context");
		});

		it("should throw FileNotFound when kubectl.stat returns null", async () => {
			stubKubectl.statResult = null;
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/missing",
			) as any;
			await assert.rejects(
				() => provider.stat(uri),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});

		it("should throw FileNotFound for meta paths (.git, .vscode, node_modules, etc.)", async () => {
			const metaUris = [
				vscode.Uri.parse("kubedive:/.git"),
				vscode.Uri.parse("kubedive:/.vscode"),
				vscode.Uri.parse("kubedive:/node_modules"),
				vscode.Uri.parse("kubedive:/my-context/.git"),
				vscode.Uri.parse("kubedive:/my-context/.vscode"),
				vscode.Uri.parse("kubedive:/my-context/default/.git"),
			];

			for (const uri of metaUris) {
				await assert.rejects(
					() => provider.stat(uri as any),
					(err: any) => {
						assert.strictEqual(err.code, "FileNotFound");
						return true;
					},
					`Expected FileNotFound for ${uri.path}`,
				);
			}
		});
	});

	describe("readDirectory", () => {
		it("should list contexts at root", async () => {
			const uri = vscode.Uri.parse("kubedive:/") as any;
			const entries = await provider.readDirectory(uri);
			assert.deepStrictEqual(entries, [
				["ctx-a", vscode.FileType.Directory],
				["ctx-b", vscode.FileType.Directory],
			]);
		});

		it("should list namespaces for a context", async () => {
			const uri = vscode.Uri.parse("kubedive:/my-context") as any;
			const entries = await provider.readDirectory(uri);
			assert.deepStrictEqual(entries, [
				["default", vscode.FileType.Directory],
				["kube-system", vscode.FileType.Directory],
			]);
		});

		it("should list pods for a namespace", async () => {
			const uri = vscode.Uri.parse("kubedive:/my-context/default") as any;
			const entries = await provider.readDirectory(uri);
			assert.deepStrictEqual(entries, [
				["pod-1", vscode.FileType.Directory],
				["pod-2", vscode.FileType.Directory],
			]);
			const call = stubKubectl.calls.find((c) => c.method === "getPods");
			assert.ok(call);
			assert.strictEqual(call?.args[0], "default");
			assert.strictEqual(call?.args[1], "my-context");
		});

		it("should list files/dirs for a pod path", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod",
			) as any;
			const entries = await provider.readDirectory(uri);
			assert.deepStrictEqual(entries, [
				["bin", vscode.FileType.Directory],
				["app.js", vscode.FileType.File],
			]);
			const call = stubKubectl.calls.find((c) => c.method === "ls");
			assert.ok(call);
			assert.strictEqual(call?.args[0], "default");
			assert.strictEqual(call?.args[1], "my-pod");
			assert.strictEqual(call?.args[2], "/");
			assert.strictEqual(call?.args[3], "my-context");
		});

		it("should list files for a nested path", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/etc",
			) as any;
			const _entries = await provider.readDirectory(uri);
			const call = stubKubectl.calls.find((c) => c.method === "ls");
			assert.ok(call);
			assert.strictEqual(call?.args[2], "/etc");
		});

		it("should throw FileNotFound for meta paths in readDirectory", async () => {
			const metaUris = [
				vscode.Uri.parse("kubedive:/.git"),
				vscode.Uri.parse("kubedive:/my-context/.git"),
				vscode.Uri.parse("kubedive:/my-context/default/.git"),
			];
			for (const uri of metaUris) {
				await assert.rejects(
					() => provider.readDirectory(uri as any),
					(err: any) => {
						assert.strictEqual(err.code, "FileNotFound");
						return true;
					},
				);
			}
		});

		it("should lazy load and cache contexts, namespaces, and pods", async () => {
			// Initially, no calls to getContexts, getNamespaces, getPods
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getContexts").length,
				0,
			);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getNamespaces").length,
				0,
			);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getPods").length,
				0,
			);

			// 1. Reading root: only calls getContexts once
			await provider.readDirectory(vscode.Uri.parse("kubedive:/") as any);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getContexts").length,
				1,
			);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getNamespaces").length,
				0,
			);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getPods").length,
				0,
			);

			// Second root read uses cache:
			await provider.readDirectory(vscode.Uri.parse("kubedive:/") as any);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getContexts").length,
				1,
			);

			// 2. Reading a cluster: only loads namespaces for that cluster
			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-a") as any);
			const nsCallsA = stubKubectl.calls.filter(
				(c) => c.method === "getNamespaces" && c.args[0] === "ctx-a",
			);
			assert.strictEqual(nsCallsA.length, 1);
			// No pods loaded yet!
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getPods").length,
				0,
			);

			// Second read of ctx-a uses cache:
			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-a") as any);
			assert.strictEqual(
				stubKubectl.calls.filter(
					(c) => c.method === "getNamespaces" && c.args[0] === "ctx-a",
				).length,
				1,
			);

			// 3. Reading a namespace: only loads pods for that specific namespace
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);
			const podCallsDefault = stubKubectl.calls.filter(
				(c) =>
					c.method === "getPods" &&
					c.args[0] === "default" &&
					c.args[1] === "ctx-a",
			);
			assert.strictEqual(podCallsDefault.length, 1);

			// Second read of ctx-a/default uses cache:
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);
			assert.strictEqual(
				stubKubectl.calls.filter(
					(c) =>
						c.method === "getPods" &&
						c.args[0] === "default" &&
						c.args[1] === "ctx-a",
				).length,
				1,
			);
		});
	});

	describe("readFile", () => {
		it("should return file content from kubectl.cat", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/app.js",
			) as any;
			const content = await provider.readFile(uri);
			assert.deepStrictEqual(content, new Uint8Array([72, 101, 108, 108, 111]));
		});

		it("should throw FileNotFound for incomplete URIs", async () => {
			const uri = vscode.Uri.parse("kubedive:/my-context") as any;
			await assert.rejects(
				() => provider.readFile(uri),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});

		it("should throw FileIsADirectory when reading pod root", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/",
			) as any;
			await assert.rejects(
				() => provider.readFile(uri),
				(err: any) => {
					assert.strictEqual(err.code, "FileIsADirectory");
					return true;
				},
			);
		});

		it("should throw Unavailable when file exceeds maxBufferSize", async () => {
			vscode.setConfigOverride("maxBufferSizeMB", 1);
			stubKubectl.statResult = {
				type: vscode.FileType.File,
				ctime: 0,
				mtime: 0,
				size: 2 * 1024 * 1024,
			};
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/large-file",
			) as any;
			await assert.rejects(
				() => provider.readFile(uri),
				(err: any) => {
					assert.strictEqual(err.code, "Unavailable");
					return true;
				},
			);
		});
	});

	describe("writeFile", () => {
		it("should call kubectl.saveFile with correct args", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/app.js",
			) as any;
			const content = new Uint8Array([1, 2, 3]);
			await provider.writeFile(uri, content, { create: true, overwrite: true });
			const call = stubKubectl.calls.find((c) => c.method === "saveFile");
			assert.ok(call);
			assert.strictEqual(call?.args[0], "default");
			assert.strictEqual(call?.args[1], "my-pod");
			assert.strictEqual(call?.args[2], "/app.js");
			assert.deepStrictEqual(call?.args[3], new Uint8Array([1, 2, 3]));
			assert.strictEqual(call?.args[4], "my-context");
		});

		it("should throw FileIsADirectory when writing to pod root", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/",
			) as any;
			await assert.rejects(
				() =>
					provider.writeFile(uri, new Uint8Array([1]), {
						create: true,
						overwrite: true,
					}),
				(err: any) => {
					assert.strictEqual(err.code, "FileIsADirectory");
					return true;
				},
			);
		});

		it("should throw FileNotFound for incomplete URIs", async () => {
			const uri = vscode.Uri.parse("kubedive:/my-context/default") as any;
			await assert.rejects(
				() =>
					provider.writeFile(uri, new Uint8Array(), {
						create: true,
						overwrite: true,
					}),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});

		it("should throw FileExists when overwrite is false and file exists", async () => {
			stubKubectl.statResult = {
				type: vscode.FileType.File,
				ctime: 0,
				mtime: 0,
				size: 100,
			};
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/existing.txt",
			) as any;
			await assert.rejects(
				() =>
					provider.writeFile(uri, new Uint8Array(), {
						create: true,
						overwrite: false,
					}),
				(err: any) => {
					assert.strictEqual(err.code, "FileExists");
					return true;
				},
			);
		});

		it("should fire Changed event after successful write", async () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/app.js",
			) as any;
			await provider.writeFile(uri, new Uint8Array([1]), {
				create: true,
				overwrite: true,
			});
			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Changed);
		});
	});

	describe("createDirectory", () => {
		it("should call kubectl.mkdir and fire Created event", async () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/new-dir",
			) as any;
			await provider.createDirectory(uri);
			const call = stubKubectl.calls.find((c) => c.method === "mkdir");
			assert.ok(call);
			assert.strictEqual(call?.args[2], "/new-dir");
			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Created);
		});

		it("should throw FileNotFound for incomplete URIs", async () => {
			const uri = vscode.Uri.parse("kubedive:/my-context") as any;
			await assert.rejects(
				() => provider.createDirectory(uri),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});
	});

	describe("delete", () => {
		it("should call kubectl.rm and fire Deleted event", async () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/old-file",
			) as any;
			await provider.delete(uri, { recursive: true });
			const call = stubKubectl.calls.find((c) => c.method === "rm");
			assert.ok(call);
			assert.strictEqual(call?.args[2], "/old-file");
			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Deleted);
		});

		it("should throw NoPermissions when deleting pod root", async () => {
			const uri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/",
			) as any;
			await assert.rejects(
				() => provider.delete(uri, { recursive: true }),
				(err: any) => {
					assert.strictEqual(err.code, "NoPermissions");
					return true;
				},
			);
		});

		it("should throw FileNotFound for incomplete URIs", async () => {
			const uri = vscode.Uri.parse("kubedive:/") as any;
			await assert.rejects(
				() => provider.delete(uri, { recursive: false }),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});
	});

	describe("dispose", () => {
		it("should dispose resources without error", () => {
			assert.doesNotThrow(() => {
				provider.dispose();
			});
		});
	});

	describe("rename", () => {
		it("should call kubectl.mv and fire Deleted + Created events", async () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));
			const oldUri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/old-name",
			) as any;
			const newUri = vscode.Uri.parse(
				"kubedive:/my-context/default/my-pod/new-name",
			) as any;
			await provider.rename(oldUri, newUri, { overwrite: true });
			const call = stubKubectl.calls.find((c) => c.method === "mv");
			assert.ok(call);
			assert.strictEqual(call?.args[2], "/old-name");
			assert.strictEqual(call?.args[3], "/new-name");
			assert.strictEqual(events.length, 2);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Deleted);
			assert.strictEqual(events[1].type, vscode.FileChangeType.Created);
		});

		it("should throw error when renaming across pods", async () => {
			const oldUri = vscode.Uri.parse("kubedive:/ctx/ns/pod-a/file") as any;
			const newUri = vscode.Uri.parse("kubedive:/ctx/ns/pod-b/file") as any;
			await assert.rejects(
				() => provider.rename(oldUri, newUri, { overwrite: true }),
				(err: Error) => {
					assert.ok(err.message.includes("Cannot rename across pods"));
					return true;
				},
			);
		});

		it("should throw FileNotFound for incomplete old URI", async () => {
			const oldUri = vscode.Uri.parse("kubedive:/ctx") as any;
			const newUri = vscode.Uri.parse("kubedive:/ctx/ns/pod/file") as any;
			await assert.rejects(
				() => provider.rename(oldUri, newUri, { overwrite: true }),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});

		it("should throw FileNotFound for incomplete new URI path", async () => {
			const oldUri = vscode.Uri.parse("kubedive:/ctx/ns/pod/old-file") as any;
			const newUri = vscode.Uri.parse("kubedive:/ctx/ns/pod") as any;
			await assert.rejects(
				() => provider.rename(oldUri, newUri, { overwrite: true }),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});
	});

	describe("watch", () => {
		it("should return a disposable", () => {
			const uri = vscode.Uri.parse("kubedive:/") as any;
			const disposable = provider.watch(uri, {
				recursive: false,
				excludes: [],
			});
			assert.ok(disposable);
			assert.ok(typeof disposable.dispose === "function");
			disposable.dispose(); // should not throw
		});
	});

	describe("triggerFileChange", () => {
		it("should fire Created event when isCreated is true", () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));
			const uri = vscode.Uri.parse("kubedive:/ctx/ns/pod/file") as any;
			provider.triggerFileChange(uri, true);
			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Created);
		});

		it("should fire Changed event when isCreated is false", () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));
			const uri = vscode.Uri.parse("kubedive:/ctx/ns/pod/file") as any;
			provider.triggerFileChange(uri, false);
			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Changed);
		});
	});

	describe("copy", () => {
		it("should call cpPodToPod and mv for cross-pod copy", async () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));

			const src = vscode.Uri.parse(
				"kubedive:/ctx-a/ns-a/pod-a/src-file",
			) as any;
			const dest = vscode.Uri.parse(
				"kubedive:/ctx-b/ns-b/pod-b/dest-file",
			) as any;

			stubKubectl.statResult = {
				type: vscode.FileType.File,
				ctime: 0,
				mtime: 0,
				size: 100,
			};

			await provider.copy(src, dest, { overwrite: true });

			const cpCall = stubKubectl.calls.find((c) => c.method === "cpPodToPod");
			assert.ok(cpCall, "Expected cpPodToPod to be called");
			assert.strictEqual(cpCall?.args[0], "ctx-a");
			assert.strictEqual(cpCall?.args[1], "ns-a");
			assert.strictEqual(cpCall?.args[2], "pod-a");
			assert.strictEqual(cpCall?.args[3], "/src-file");

			const mvCall = stubKubectl.calls.find((c) => c.method === "mv");
			assert.ok(mvCall, "Expected mv to be called");

			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Created);
		});

		it("should throw FileNotFound for incomplete source URI", async () => {
			const src = vscode.Uri.parse("kubedive:/ctx") as any;
			const dest = vscode.Uri.parse("kubedive:/ctx/ns/pod/file") as any;
			await assert.rejects(
				() => provider.copy(src, dest, { overwrite: true }),
				(err: any) => {
					assert.strictEqual(err.code, "FileNotFound");
					return true;
				},
			);
		});

		it("should throw FileExists when overwrite is false and dest exists", async () => {
			stubKubectl.statResult = {
				type: vscode.FileType.File,
				ctime: 0,
				mtime: 0,
				size: 100,
			};
			const src = vscode.Uri.parse("kubedive:/ctx/ns/pod/src") as any;
			const dest = vscode.Uri.parse("kubedive:/ctx/ns/pod/dest") as any;
			await assert.rejects(
				() => provider.copy(src, dest, { overwrite: false }),
				(err: any) => {
					assert.strictEqual(err.code, "FileExists");
					return true;
				},
			);
		});
	});

	describe("refresh", () => {
		it("should clear all caches and notify on root refresh", async () => {
			// Populate caches
			await provider.readDirectory(vscode.Uri.parse("kubedive:/") as any);
			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-a") as any);
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);

			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getContexts").length,
				1,
			);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getNamespaces").length,
				1,
			);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getPods").length,
				1,
			);

			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));

			provider.refresh();

			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Changed);
			assert.strictEqual(events[0].uri.path, "/");

			// Subsequent reads should re-fetch from kubectl
			await provider.readDirectory(vscode.Uri.parse("kubedive:/") as any);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getContexts").length,
				2,
			);

			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-a") as any);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getNamespaces").length,
				2,
			);

			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);
			assert.strictEqual(
				stubKubectl.calls.filter((c) => c.method === "getPods").length,
				2,
			);
		});

		it("should clear specific context cache on context refresh", async () => {
			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-a") as any);
			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-b") as any);

			provider.refresh(vscode.Uri.parse("kubedive:/ctx-a") as any);

			// Reading ctx-b should still be cached
			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-b") as any);
			assert.strictEqual(
				stubKubectl.calls.filter(
					(c) => c.method === "getNamespaces" && c.args[0] === "ctx-b",
				).length,
				1,
			);

			// Reading ctx-a should re-fetch
			await provider.readDirectory(vscode.Uri.parse("kubedive:/ctx-a") as any);
			assert.strictEqual(
				stubKubectl.calls.filter(
					(c) => c.method === "getNamespaces" && c.args[0] === "ctx-a",
				).length,
				2,
			);
		});

		it("should clear specific namespace cache on namespace refresh", async () => {
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/kube-system") as any,
			);

			provider.refresh(vscode.Uri.parse("kubedive:/ctx-a/default") as any);

			// Reading kube-system should still be cached
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/kube-system") as any,
			);
			assert.strictEqual(
				stubKubectl.calls.filter(
					(c) =>
						c.method === "getPods" &&
						c.args[0] === "kube-system" &&
						c.args[1] === "ctx-a",
				).length,
				1,
			);

			// Reading default should re-fetch
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);
			assert.strictEqual(
				stubKubectl.calls.filter(
					(c) =>
						c.method === "getPods" &&
						c.args[0] === "default" &&
						c.args[1] === "ctx-a",
				).length,
				2,
			);
		});

		it("should fire Changed event and clear context podsCache on context refresh", async () => {
			// Populate pods cache for ctx-a:default
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);
			// Refresh ctx-a (this will clear podsCache entries starting with ctx-a:)
			provider.refresh(vscode.Uri.parse("kubedive:/ctx-a") as any);
			// Reading pods should re-fetch
			await provider.readDirectory(
				vscode.Uri.parse("kubedive:/ctx-a/default") as any,
			);
			assert.strictEqual(
				stubKubectl.calls.filter(
					(c) =>
						c.method === "getPods" &&
						c.args[0] === "default" &&
						c.args[1] === "ctx-a",
				).length,
				2,
			);
		});

		it("should fire Changed event on pod or file level refresh", () => {
			const events: any[] = [];
			provider.onDidChangeFile((e) => events.push(...e));

			const podUri = vscode.Uri.parse("kubedive:/ctx-a/default/pod-1") as any;
			provider.refresh(podUri);

			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].type, vscode.FileChangeType.Changed);
			assert.strictEqual(events[0].uri, podUri);
		});
	});
});
