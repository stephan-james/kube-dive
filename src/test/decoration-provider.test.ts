import * as assert from "node:assert";
import { KubeDecorationProvider } from "../decoration-provider";
import * as vscode from "./mocks/vscode";

describe("KubeDecorationProvider", () => {
	let provider: KubeDecorationProvider;

	beforeEach(() => {
		provider = new KubeDecorationProvider();
	});

	it("should return undefined for non-kubedive scheme", () => {
		const uri = vscode.Uri.parse("file:///some/path");
		const decoration = provider.provideFileDecoration(uri as any);
		assert.strictEqual(decoration, undefined);
	});

	it("should decorate context level (1 part) with yellow and helm badge", () => {
		const uri = vscode.Uri.parse("kubedive:/my-context");
		const decoration = provider.provideFileDecoration(uri as any);
		assert.ok(decoration, "Expected a decoration for context level");
		assert.strictEqual(decoration?.badge, "⎈");
		assert.strictEqual(decoration?.tooltip, "Kubernetes Context");
		assert.ok(decoration?.color instanceof vscode.ThemeColor);
		assert.strictEqual(
			(decoration?.color as vscode.ThemeColor).id,
			"charts.yellow",
		);
	});

	it("should decorate namespace level (2 parts) with green and grid badge", () => {
		const uri = vscode.Uri.parse("kubedive:/my-context/default");
		const decoration = provider.provideFileDecoration(uri as any);
		assert.ok(decoration, "Expected a decoration for namespace level");
		assert.strictEqual(decoration?.badge, "⛶");
		assert.strictEqual(decoration?.tooltip, "Kubernetes Namespace");
		assert.strictEqual(
			(decoration?.color as vscode.ThemeColor).id,
			"charts.green",
		);
	});

	it("should decorate pod level (3 parts) with blue and box badge", () => {
		const uri = vscode.Uri.parse("kubedive:/my-context/default/my-pod");
		const decoration = provider.provideFileDecoration(uri as any);
		assert.ok(decoration, "Expected a decoration for pod level");
		assert.strictEqual(decoration?.badge, "⊡");
		assert.strictEqual(decoration?.tooltip, "Kubernetes Pod");
		assert.strictEqual(
			(decoration?.color as vscode.ThemeColor).id,
			"charts.blue",
		);
	});

	it("should return undefined for file level (4+ parts)", () => {
		const uri = vscode.Uri.parse(
			"kubedive:/my-context/default/my-pod/etc/config",
		);
		const decoration = provider.provideFileDecoration(uri as any);
		assert.strictEqual(decoration, undefined);
	});

	it("should return undefined for root (0 parts)", () => {
		const uri = vscode.Uri.parse("kubedive:/");
		const decoration = provider.provideFileDecoration(uri as any);
		assert.strictEqual(decoration, undefined);
	});

	it("should expose onDidChangeFileDecorations event", () => {
		assert.ok(provider.onDidChangeFileDecorations, "Event should be defined");
	});

	it("should dispose resources without error", () => {
		assert.doesNotThrow(() => {
			provider.dispose();
		});
	});
});
