import * as assert from "node:assert";
import * as cp from "node:child_process";
import * as fs from "node:fs/promises";
import { KubectlClient } from "../kubectl";
import * as vscode from "./mocks/vscode";

let execFileStub:
	| ((
			file: string,
			args: string[],
			opts: any,
			cb: (err: Error | null, stdout: string, stderr: string) => void,
	  ) => void)
	| null = null;
const originalExecFile = cp.execFile;

function mockExec(
	handler: (cmd: string) => {
		stdout?: string;
		stderr?: string;
		err?: Error | null;
	},
) {
	execFileStub = (
		file: string,
		args: string[],
		_opts: any,
		cb: (err: Error | null, stdout: string, stderr: string) => void,
	) => {
		const cmd = args && args.length > 0 ? `${file} ${args.join(" ")}` : file;
		const result = handler(cmd);
		cb(result.err || null, result.stdout || "", result.stderr || "");
	};
	(cp as any).execFile = execFileStub;
}

function restoreExec() {
	(cp as any).execFile = originalExecFile;
	execFileStub = null;
}

let _spawnStub: ((cmd: string, args: string[], opts: any) => any) | null = null;
const originalSpawn = cp.spawn;

function mockSpawn(
	handler: (
		cmd: string,
		args: string[],
	) => { exitCode: number; stderr?: string; error?: Error },
) {
	(cp as any).spawn = (cmd: string, args: string[], _opts: any) => {
		const result = handler(cmd, args);
		const { EventEmitter } = require("node:events");
		const { Readable } = require("node:stream");

		const proc = new EventEmitter();
		const stderrStream = new Readable({ read() {} });
		if (result.stderr) {
			stderrStream.push(result.stderr);
		}
		stderrStream.push(null);
		proc.stderr = stderrStream;
		proc.stdout = null;
		proc.stdin = null;

		process.nextTick(() => {
			if (result.error) {
				proc.emit("error", result.error);
			} else {
				proc.emit("close", result.exitCode);
			}
		});
		return proc;
	};
}

function restoreSpawn() {
	(cp as any).spawn = originalSpawn;
	_spawnStub = null;
}

describe("KubectlClient", () => {
	let client: KubectlClient;

	beforeEach(() => {
		client = new KubectlClient();
		vscode.resetConfigOverrides();
	});

	afterEach(() => {
		restoreExec();
		restoreSpawn();
	});

	describe("exec", () => {
		it("should resolve with stdout on success", async () => {
			mockExec(() => ({ stdout: "hello world\n" }));
			const result = await client.exec(["get", "pods"]);
			assert.strictEqual(result, "hello world\n");
		});

		it("should reject with stderr on failure", async () => {
			mockExec(() => ({
				err: new Error("fail"),
				stderr: "connection refused",
			}));
			await assert.rejects(
				() => client.exec(["get", "pods"]),
				(err: any) => {
					assert.strictEqual(err.message, "connection refused");
					return true;
				},
			);
		});

		it("should reject with err.message when no stderr", async () => {
			mockExec(() => ({ err: new Error("something broke") }));
			await assert.rejects(
				() => client.exec(["get", "pods"]),
				(err: any) => {
					assert.strictEqual(err.message, "something broke");
					return true;
				},
			);
		});

		it("should use configured kubectlPath", async () => {
			vscode.setConfigOverride("kubectlPath", "/usr/local/bin/kubectl");
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: "ok" };
			});
			await client.exec(["version"]);
			assert.ok(
				capturedCmd.startsWith("/usr/local/bin/kubectl"),
				`Expected custom path, got: ${capturedCmd}`,
			);
		});

		it("should use configured maxBufferSizeMB", async () => {
			vscode.setConfigOverride("maxBufferSizeMB", 200);
			let capturedOpts: any = {};
			const origExecFile = (cp as any).execFile;
			(cp as any).execFile = (
				_cmd: string,
				_args: string[],
				opts: any,
				cb: (err: Error | null, stdout: string, stderr: string) => void,
			) => {
				capturedOpts = opts;
				cb(null, "ok", "");
			};
			await client.exec(["version"]);
			assert.strictEqual(capturedOpts.maxBuffer, 200 * 1024 * 1024);
			(cp as any).execFile = origExecFile;
		});

		it("should use configured timeoutSeconds", async () => {
			vscode.setConfigOverride("timeoutSeconds", 15);
			let capturedOpts: any = {};
			const origExecFile = (cp as any).execFile;
			(cp as any).execFile = (
				_cmd: string,
				_args: string[],
				opts: any,
				cb: (err: Error | null, stdout: string, stderr: string) => void,
			) => {
				capturedOpts = opts;
				cb(null, "ok", "");
			};
			await client.exec(["version"]);
			assert.strictEqual(capturedOpts.timeout, 15 * 1000);
			(cp as any).execFile = origExecFile;
		});
	});

	describe("getContexts", () => {
		it("should parse context names from output", async () => {
			mockExec(() => ({ stdout: "ctx-a\nctx-b\nctx-c\n" }));
			const contexts = await client.getContexts();
			assert.deepStrictEqual(contexts, ["ctx-a", "ctx-b", "ctx-c"]);
		});

		it("should handle single context", async () => {
			mockExec(() => ({ stdout: "only-one\n" }));
			const contexts = await client.getContexts();
			assert.deepStrictEqual(contexts, ["only-one"]);
		});
	});

	describe("getNamespaces", () => {
		it("should parse namespace names", async () => {
			mockExec(() => ({ stdout: '"default kube-system monitoring"' }));
			const ns = await client.getNamespaces();
			assert.deepStrictEqual(ns, ["default", "kube-system", "monitoring"]);
		});

		it("should handle empty namespace output", async () => {
			mockExec(() => ({ stdout: "   " }));
			const ns = await client.getNamespaces();
			assert.deepStrictEqual(ns, []);
		});

		it("should prepend context flag when provided", async () => {
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: '"default"' };
			});
			await client.getNamespaces("my-ctx");
			assert.ok(
				capturedCmd.includes("--context=my-ctx"),
				`Expected context flag, got: ${capturedCmd}`,
			);
		});
	});

	describe("getPods", () => {
		it("should parse pod names", async () => {
			mockExec(() => ({ stdout: '"pod-a pod-b"' }));
			const pods = await client.getPods("default");
			assert.deepStrictEqual(pods, ["pod-a", "pod-b"]);
		});

		it("should handle empty pod output when no pods exist in namespace", async () => {
			mockExec(() => ({ stdout: "" }));
			const pods = await client.getPods("default");
			assert.deepStrictEqual(pods, []);
		});

		it("should prepend context flag when provided", async () => {
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: '"pod-a"' };
			});
			await client.getPods("default", "my-ctx");
			assert.ok(
				capturedCmd.includes("--context=my-ctx"),
				`Expected context flag, got: ${capturedCmd}`,
			);
		});
	});

	describe("ls", () => {
		it("should parse directory entries with type indicators", async () => {
			mockExec(() => ({
				stdout:
					"drwxr-xr-x|4096|bin\ndrwxr-xr-x|4096|etc\n-rw-r--r--|1024|README.md\n-rwxr-xr-x|1024|app\n-rw-r--r--|1024|link\n-rw-r--r--|1024|pipe\n",
			}));
			const items = await client.ls("default", "my-pod", "/");
			assert.deepStrictEqual(items, [
				{ name: "bin", type: vscode.FileType.Directory },
				{ name: "etc", type: vscode.FileType.Directory },
				{ name: "README.md", type: vscode.FileType.File },
				{ name: "app", type: vscode.FileType.File },
				{ name: "link", type: vscode.FileType.File },
				{ name: "pipe", type: vscode.FileType.File },
			]);
		});

		it("should return empty array on exec failure", async () => {
			mockExec(() => ({ err: new Error("command failed"), stderr: "error" }));
			const items = await client.ls("default", "my-pod", "/nonexistent");
			assert.deepStrictEqual(items, []);
		});

		it("should prepend context flag when provided", async () => {
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: "file.txt\n" };
			});
			await client.ls("default", "my-pod", "/", "my-ctx");
			assert.ok(capturedCmd.includes("--context=my-ctx"));
		});

		it("should handle empty directory", async () => {
			mockExec(() => ({ stdout: "" }));
			const items = await client.ls("default", "my-pod", "/empty");
			assert.deepStrictEqual(items, []);
		});
	});

	describe("stat", () => {
		it("should parse directory stat", async () => {
			mockExec(() => ({
				stdout: "drwxr-xr-x|4096|.\n",
			}));
			const stat = await client.stat("default", "my-pod", "/");
			assert.ok(stat);
			assert.strictEqual(stat?.type, vscode.FileType.Directory);
			assert.strictEqual(stat?.size, 4096);
		});

		it("should parse file stat", async () => {
			mockExec(() => ({
				stdout: "-rw-r--r--|1234|config.yaml\n",
			}));
			const stat = await client.stat("default", "my-pod", "/config.yaml");
			assert.ok(stat);
			assert.strictEqual(stat?.type, vscode.FileType.File);
			assert.strictEqual(stat?.size, 1234);
		});

		it("should return null on failure", async () => {
			mockExec(() => ({ err: new Error("No such file"), stderr: "error" }));
			const stat = await client.stat("default", "my-pod", "/missing");
			assert.strictEqual(stat, null);
		});

		it("should prepend context flag when provided", async () => {
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: "-rw-r--r--|100|f\n" };
			});
			await client.stat("default", "my-pod", "/f", "my-ctx");
			assert.ok(capturedCmd.includes("--context=my-ctx"));
		});
	});

	describe("mkdir", () => {
		it("should call exec with correct args", async () => {
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: "" };
			});
			await client.mkdir("default", "my-pod", "/new-dir", "my-ctx");
			assert.ok(capturedCmd.includes("mkdir -p /new-dir"));
			assert.ok(capturedCmd.includes("--context=my-ctx"));
		});
	});

	describe("rm", () => {
		it("should call exec with correct args", async () => {
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: "" };
			});
			await client.rm("default", "my-pod", "/tmp/file", "my-ctx");
			assert.ok(capturedCmd.includes("rm -rf /tmp/file"));
			assert.ok(capturedCmd.includes("--context=my-ctx"));
		});
	});

	describe("mv", () => {
		it("should call exec with correct args", async () => {
			let capturedCmd = "";
			mockExec((cmd) => {
				capturedCmd = cmd;
				return { stdout: "" };
			});
			await client.mv("default", "my-pod", "/old", "/new", "my-ctx");
			assert.ok(capturedCmd.includes("mv /old /new"));
			assert.ok(capturedCmd.includes("--context=my-ctx"));
		});
	});

	describe("cpFromPod", () => {
		it("should resolve on exit code 0", async () => {
			mockSpawn(() => ({ exitCode: 0 }));
			await client.cpFromPod(
				"default",
				"my-pod",
				"/remote/file",
				"/local/file",
				"my-ctx",
			);
		});

		it("should reject on non-zero exit code", async () => {
			mockSpawn(() => ({ exitCode: 1, stderr: "cp failed" }));
			await assert.rejects(
				() =>
					client.cpFromPod("default", "my-pod", "/remote/file", "/local/file"),
				(err: Error) => {
					assert.ok(err.message.includes("cp failed"));
					return true;
				},
			);
		});

		it("should reject on spawn error", async () => {
			mockSpawn(() => ({ exitCode: 0, error: new Error("spawn ENOENT") }));
			await assert.rejects(
				() =>
					client.cpFromPod("default", "my-pod", "/remote/file", "/local/file"),
				(err: Error) => {
					assert.ok(err.message.includes("ENOENT"));
					return true;
				},
			);
		});
	});

	describe("cat", () => {
		it("should copy file from pod and read content", async () => {
			mockSpawn(() => ({ exitCode: 0 }));
			// Intercept fs.readFile for the temporary file
			const origReadFile = (fs as any).readFile;
			(fs as any).readFile = async () => Buffer.from("test file content");

			try {
				const result = await client.cat(
					"default",
					"my-pod",
					"/path/to/file",
					"my-ctx",
				);
				assert.deepStrictEqual(
					result,
					new Uint8Array(Buffer.from("test file content")),
				);
			} finally {
				(fs as any).readFile = origReadFile;
			}
		});
	});

	describe("saveFile", () => {
		it("should write to temp file, cpToPod and mv", async () => {
			mockSpawn(() => ({ exitCode: 0 }));
			let capturedMvArgs = "";
			mockExec((cmd) => {
				capturedMvArgs = cmd;
				return { stdout: "" };
			});

			const origWriteFile = (fs as any).writeFile;
			(fs as any).writeFile = async () => {};

			try {
				await client.saveFile(
					"default",
					"my-pod",
					"/remote/app.js",
					new Uint8Array([1, 2, 3]),
					"my-ctx",
				);
				assert.ok(capturedMvArgs.includes("mv"));
				assert.ok(capturedMvArgs.includes("/remote/app.js"));
			} finally {
				(fs as any).writeFile = origWriteFile;
			}
		});

		it("should clean up remote temp file and rethrow if mv fails", async () => {
			mockSpawn(() => ({ exitCode: 0 }));
			let rmCalled = false;
			mockExec((cmd) => {
				if (cmd.includes("mv")) {
					return { err: new Error("mv failed"), stderr: "mv failed" };
				}
				if (cmd.includes("rm -rf")) {
					rmCalled = true;
					return { stdout: "" };
				}
				return { stdout: "" };
			});

			const origWriteFile = (fs as any).writeFile;
			(fs as any).writeFile = async () => {};

			try {
				await assert.rejects(
					() =>
						client.saveFile(
							"default",
							"my-pod",
							"/remote/app.js",
							new Uint8Array([1, 2, 3]),
							"my-ctx",
						),
					(err: Error) => {
						assert.ok(err.message.includes("mv failed"));
						return true;
					},
				);
				assert.strictEqual(rmCalled, true);
			} finally {
				(fs as any).writeFile = origWriteFile;
			}
		});
	});

	describe("cpPodToPod", () => {
		it("should copy from srcPod and upload to destPod", async () => {
			let spawnCount = 0;
			mockSpawn(() => {
				spawnCount++;
				return { exitCode: 0 };
			});

			await client.cpPodToPod(
				"src-ctx",
				"src-ns",
				"src-pod",
				"/src/file",
				"dest-ctx",
				"dest-ns",
				"dest-pod",
				"/dest/file",
				false,
			);
			assert.strictEqual(spawnCount, 2);
		});
	});

	describe("cpToPod", () => {
		it("should resolve on exit code 0", async () => {
			mockSpawn(() => ({ exitCode: 0 }));
			await client.cpToPod(
				"default",
				"my-pod",
				"/local/file",
				"/remote/file",
				"my-ctx",
			);
		});

		it("should reject on non-zero exit code", async () => {
			mockSpawn(() => ({ exitCode: 1, stderr: "upload failed" }));
			await assert.rejects(
				() =>
					client.cpToPod("default", "my-pod", "/local/file", "/remote/file"),
				(err: Error) => {
					assert.ok(err.message.includes("upload failed"));
					return true;
				},
			);
		});

		it("should reject on spawn error", async () => {
			mockSpawn(() => ({ exitCode: 0, error: new Error("spawn error") }));
			await assert.rejects(
				() =>
					client.cpToPod("default", "my-pod", "/local/file", "/remote/file"),
				(err: Error) => {
					assert.ok(err.message.includes("spawn error"));
					return true;
				},
			);
		});
	});
});
