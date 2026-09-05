export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export enum FileChangeType {
	Changed = 1,
	Created = 2,
	Deleted = 3,
}

export enum ProgressLocation {
	SourceControl = 1,
	Window = 10,
	Notification = 15,
}

export class Uri {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;
	readonly fsPath: string;

	private constructor(
		scheme: string,
		authority: string,
		path: string,
		query: string,
		fragment: string,
	) {
		this.scheme = scheme;
		this.authority = authority;
		this.path = path;
		this.query = query;
		this.fragment = fragment;
		this.fsPath = path;
	}

	static parse(value: string): Uri {
		const schemeEnd = value.indexOf(":");
		const scheme = schemeEnd > 0 ? value.substring(0, schemeEnd) : "";
		const rest = value.substring(schemeEnd + 1);
		const path = rest.startsWith("//") ? rest.substring(2) : rest;
		return new Uri(
			scheme,
			"",
			path.startsWith("/") ? path : `/${path}`,
			"",
			"",
		);
	}

	static file(path: string): Uri {
		return new Uri("file", "", path, "", "");
	}

	static joinPath(base: Uri, ...pathSegments: string[]): Uri {
		let joined = base.path;
		for (const seg of pathSegments) {
			if (joined.endsWith("/")) {
				joined += seg;
			} else {
				joined += `/${seg}`;
			}
		}
		return new Uri(
			base.scheme,
			base.authority,
			joined,
			base.query,
			base.fragment,
		);
	}

	with(change: {
		scheme?: string;
		authority?: string;
		path?: string;
		query?: string;
		fragment?: string;
	}): Uri {
		return new Uri(
			change.scheme ?? this.scheme,
			change.authority ?? this.authority,
			change.path ?? this.path,
			change.query ?? this.query,
			change.fragment ?? this.fragment,
		);
	}

	toString(): string {
		return `${this.scheme}://${this.authority}${this.path}`;
	}
}

export class EventEmitter<T> {
	private listeners: Array<(e: T) => void> = [];
	readonly event = (listener: (e: T) => void) => {
		this.listeners.push(listener);
		return new Disposable(() => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		});
	};

	fire(data: T): void {
		for (const l of this.listeners) {
			l(data);
		}
	}

	dispose(): void {
		this.listeners = [];
	}
}

export class Disposable {
	constructor(private callOnDispose: () => void) {}
	dispose(): void {
		this.callOnDispose();
	}
}

export class ThemeColor {
	constructor(public id: string) {}
}

export class FileSystemError extends Error {
	code: string;

	constructor(messageOrUri?: string | Uri) {
		super(
			typeof messageOrUri === "string"
				? messageOrUri
				: messageOrUri?.toString(),
		);
		this.code = "";
		this.name = "FileSystemError";
	}

	static FileNotFound(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		e.code = "FileNotFound";
		return e;
	}

	static FileExists(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		e.code = "FileExists";
		return e;
	}

	static Unavailable(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		e.code = "Unavailable";
		return e;
	}

	static NoPermissions(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		e.code = "NoPermissions";
		return e;
	}

	static FileIsADirectory(messageOrUri?: string | Uri): FileSystemError {
		const e = new FileSystemError(messageOrUri);
		e.code = "FileIsADirectory";
		return e;
	}
}

export interface FileDecoration {
	badge?: string;
	tooltip?: string;
	color?: ThemeColor;
}

const defaultConfig: Record<string, any> = {
	kubectlPath: "kubectl",
	maxBufferSizeMB: 100,
	timeoutSeconds: 30,
};

let configOverrides: Record<string, any> = {};

export function setConfigOverride(key: string, value: any): void {
	configOverrides[key] = value;
}

export function resetConfigOverrides(): void {
	configOverrides = {};
}

export const workspace = {
	getConfiguration: (section?: string) => ({
		get: <T>(key: string, defaultValue?: T): T | undefined => {
			const fullKey = section ? `${key}` : key;
			if (fullKey in configOverrides) {
				return configOverrides[fullKey] as T;
			}
			if (fullKey in defaultConfig) {
				return defaultConfig[fullKey] as T;
			}
			return defaultValue;
		},
	}),
	workspaceFolders: [] as any[],
	registerFileSystemProvider: () => new Disposable(() => {}),
	updateWorkspaceFolders: () => false,
	fs: {
		stat: async (_uri: Uri) => {
			throw FileSystemError.FileNotFound(_uri);
		},
	},
};

export interface MessageCall {
	type: "info" | "warning" | "error";
	message: string;
	items: string[];
}

let _messageCalls: MessageCall[] = [];
let _warningReturnValue: string | undefined;

export function getMessageCalls(): MessageCall[] {
	return _messageCalls;
}

export function resetMessageCalls(): void {
	_messageCalls = [];
}

export function setWarningReturnValue(value: string | undefined): void {
	_warningReturnValue = value;
}

export const window = {
	showInformationMessage: async (message: string, ...items: any[]) => {
		_messageCalls.push({ type: "info", message, items });
		return undefined;
	},
	showWarningMessage: async (message: string, ...items: any[]) => {
		_messageCalls.push({ type: "warning", message, items });
		return _warningReturnValue;
	},
	showErrorMessage: async (message: string, ...items: any[]) => {
		_messageCalls.push({ type: "error", message, items });
		return undefined;
	},
	withProgress: async <T>(
		_options: any,
		task: (progress: any, token: any) => Thenable<T>,
	): Promise<T> => {
		return task(
			{ report: () => {} },
			{
				isCancellationRequested: false,
				onCancellationRequested: () => new Disposable(() => {}),
			},
		);
	},
	createTerminal: (_name: string) => ({
		sendText: () => {},
		show: () => {},
		dispose: () => {},
	}),
	showSaveDialog: async () => undefined as Uri | undefined,
	showOpenDialog: async () => undefined as Uri[] | undefined,
	registerFileDecorationProvider: () => new Disposable(() => {}),
};

const registeredCommands: Record<string, (...args: any[]) => any> = {};

export const commands = {
	registerCommand: (id: string, handler: (...args: any[]) => any) => {
		registeredCommands[id] = handler;
		return new Disposable(() => {
			delete registeredCommands[id];
		});
	},
	executeCommand: async (id: string, ...args: any[]) => {
		if (registeredCommands[id]) {
			return registeredCommands[id](...args);
		}
		throw new Error(`Command not found: ${id}`);
	},
};

export function getRegisteredCommands(): Record<
	string,
	(...args: any[]) => any
> {
	return registeredCommands;
}
