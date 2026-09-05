const Module = require("node:module");
const path = require("node:path");

const vscodeMock = require(path.join(__dirname, "mocks", "vscode"));

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (
	request: string,
	parent: any,
	isMain: boolean,
	options: any,
) {
	if (request === "vscode") {
		return "vscode";
	}
	return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.cache.vscode = {
	id: "vscode",
	filename: "vscode",
	loaded: true,
	exports: vscodeMock,
	parent: null,
	children: [],
	paths: [],
	path: "",
	isPreloading: false,
	require: require,
} as any;
