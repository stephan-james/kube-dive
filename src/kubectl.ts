import * as cp from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

export class KubectlClient {
	private get kubectlPath(): string {
		return (
			vscode.workspace.getConfiguration("kubedive").get("kubectlPath") ||
			"kubectl"
		);
	}
	private get maxBufferSizeMB(): number {
		return (
			vscode.workspace.getConfiguration("kubedive").get("maxBufferSizeMB") ||
			100
		);
	}
	private get timeoutSeconds(): number {
		return (
			vscode.workspace.getConfiguration("kubedive").get("timeoutSeconds") || 30
		);
	}

	async exec(args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const maxBuffer = this.maxBufferSizeMB * 1024 * 1024;
			const timeout = this.timeoutSeconds * 1000;
			cp.execFile(
				this.kubectlPath,
				args,
				{ maxBuffer, timeout },
				(err, stdout, stderr) => {
					if (err) {
						reject(new Error(stderr || err.message));
					} else {
						resolve(stdout);
					}
				},
			);
		});
	}

	async getContexts(): Promise<string[]> {
		const output = await this.exec(["config", "get-contexts", "-o", "name"]);
		const trimmed = output.trim();
		if (!trimmed) return [];
		return trimmed
			.split(/\s+/)
			.map((s) => s.replace(/^"|"$/g, ""))
			.filter((s) => s.length > 0);
	}

	async getNamespaces(context?: string): Promise<string[]> {
		const args = ["get", "ns", "-o", "jsonpath={.items[*].metadata.name}"];
		if (context) args.unshift(`--context=${context}`);
		const output = await this.exec(args);
		const trimmed = output.trim();
		if (!trimmed) return [];
		return trimmed
			.split(/\s+/)
			.map((s) => s.replace(/^"|"$/g, ""))
			.filter((s) => s.length > 0);
	}

	async getPods(namespace: string, context?: string): Promise<string[]> {
		const args = [
			"get",
			"pods",
			"-n",
			namespace,
			"-o",
			"jsonpath={.items[*].metadata.name}",
		];
		if (context) args.unshift(`--context=${context}`);
		const output = await this.exec(args);
		const trimmed = output.trim();
		if (!trimmed) return [];
		return trimmed
			.split(/\s+/)
			.map((s) => s.replace(/^"|"$/g, ""))
			.filter((s) => s.length > 0);
	}

	async ls(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<{ name: string; type: vscode.FileType }[]> {
		try {
			const args = ["exec", "-n", namespace, pod];
			if (context) args.unshift(`--context=${context}`);

			const script = `cd "$1" || exit 1; for f in * .*; do if [ "$f" != "." ] && [ "$f" != ".." ]; then stat -c "%A|%s|%n" "$f" 2>/dev/null; fi; done`;
			args.push("--", "sh", "-c", script, "--", path);

			const output = await this.exec(args);
			const lines = output.trim().split("\n");
			return lines
				.filter((l) => l)
				.map((line) => {
					const parts = line.split("|");
					if (parts.length < 3)
						return { name: line, type: vscode.FileType.File };

					const isDir = parts[0].startsWith("d");
					const name = parts.slice(2).join("|");

					return {
						name,
						type: isDir ? vscode.FileType.Directory : vscode.FileType.File,
					};
				});
		} catch (_e) {
			return [];
		}
	}

	async cat(
		namespace: string,
		pod: string,
		pathToRead: string,
		context?: string,
	): Promise<Uint8Array> {
		const tmpPath = path.join(
			os.tmpdir(),
			`kd-cat-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
		);

		try {
			await this.cpFromPod(namespace, pod, pathToRead, tmpPath, context);
			const content = await fs.readFile(tmpPath);
			return new Uint8Array(content);
		} finally {
			try {
				await fs.rm(tmpPath, { force: true });
			} catch (_e) {}
		}
	}

	async saveFile(
		namespace: string,
		pod: string,
		filePath: string,
		content: Uint8Array,
		context?: string,
	): Promise<void> {
		const tmpPath = path.join(
			os.tmpdir(),
			`kd-save-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
		);
		const tempRemotePath = `${filePath}.kd-download`;

		try {
			await fs.writeFile(tmpPath, content);
			await this.cpToPod(namespace, pod, tmpPath, tempRemotePath, context);
			await this.mv(namespace, pod, tempRemotePath, filePath, context);
		} catch (err) {
			try {
				await this.rm(namespace, pod, tempRemotePath, context);
			} catch (_e) {}
			throw err;
		} finally {
			try {
				await fs.rm(tmpPath, { force: true });
			} catch (_e) {}
		}
	}

	async mkdir(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<void> {
		const args = ["exec", "-n", namespace, pod, "--", "mkdir", "-p", path];
		if (context) args.unshift(`--context=${context}`);
		await this.exec(args);
	}

	async rm(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<void> {
		const args = ["exec", "-n", namespace, pod, "--", "rm", "-rf", path];
		if (context) args.unshift(`--context=${context}`);
		await this.exec(args);
	}

	async mv(
		namespace: string,
		pod: string,
		oldPath: string,
		newPath: string,
		context?: string,
	): Promise<void> {
		const args = ["exec", "-n", namespace, pod, "--", "mv", oldPath, newPath];
		if (context) args.unshift(`--context=${context}`);
		await this.exec(args);
	}

	async cpFromPod(
		namespace: string,
		pod: string,
		remotePath: string,
		localPath: string,
		context?: string,
	): Promise<void> {
		const args = [
			"cp",
			"--retries=-1",
			`${namespace}/${pod}:${remotePath}`,
			localPath,
		];
		if (context) args.unshift(`--context=${context}`);

		return new Promise((resolve, reject) => {
			const process = cp.spawn(this.kubectlPath, args, {
				stdio: ["ignore", "ignore", "pipe"],
			});
			let stderr = "";

			if (process.stderr) {
				process.stderr.on("data", (data) => {
					stderr += data.toString();
				});
			}

			process.on("close", (code) => {
				if (code !== 0) {
					reject(new Error(stderr || `Process exited with code ${code}`));
				} else {
					resolve();
				}
			});

			process.on("error", (err) => {
				reject(err);
			});
		});
	}

	async cpToPod(
		namespace: string,
		pod: string,
		localPath: string,
		remotePath: string,
		context?: string,
	): Promise<void> {
		const args = [
			"cp",
			"--retries=-1",
			localPath,
			`${namespace}/${pod}:${remotePath}`,
		];
		if (context) args.unshift(`--context=${context}`);

		return new Promise((resolve, reject) => {
			const process = cp.spawn(this.kubectlPath, args, {
				stdio: ["ignore", "ignore", "pipe"],
			});
			let stderr = "";

			if (process.stderr) {
				process.stderr.on("data", (data) => {
					stderr += data.toString();
				});
			}

			process.on("close", (code) => {
				if (code !== 0) {
					reject(new Error(stderr || `Process exited with code ${code}`));
				} else {
					resolve();
				}
			});

			process.on("error", (err) => {
				reject(err);
			});
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
		_isDirectory: boolean,
	): Promise<void> {
		const tmpPath = path.join(
			os.tmpdir(),
			`kd-transfer-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
		);

		try {
			await this.cpFromPod(srcNamespace, srcPod, srcPath, tmpPath, srcContext);
			await this.cpToPod(
				destNamespace,
				destPod,
				tmpPath,
				destPath,
				destContext,
			);
		} finally {
			try {
				await fs.rm(tmpPath, { recursive: true, force: true });
			} catch (_e) {}
		}
	}

	async stat(
		namespace: string,
		pod: string,
		path: string,
		context?: string,
	): Promise<vscode.FileStat | null> {
		try {
			const args = ["exec", "-n", namespace, pod];
			if (context) args.unshift(`--context=${context}`);

			args.push("--", "stat", "-c", "%A|%s|%n", path);
			const output = await this.exec(args);

			const parts = output.trim().split("|");
			if (parts.length < 3) return null;

			const permissions = parts[0];
			const isDir = permissions.startsWith("d");
			const size = parseInt(parts[1], 10);

			return {
				type: isDir ? vscode.FileType.Directory : vscode.FileType.File,
				ctime: 0,
				mtime: 0,
				size: Number.isNaN(size) ? 0 : size,
			};
		} catch (_e) {
			return null;
		}
	}
}
