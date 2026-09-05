# Kube Dive

[![CI](https://github.com/stephan-james/kube-dive/actions/workflows/ci.yml/badge.svg)](https://github.com/stephan-james/kube-dive/actions/workflows/ci.yml)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Stephan-James-Dick.kube-dive?label=VS%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=Stephan-James-Dick.kube-dive)
[![Open VSX Version](https://img.shields.io/open-vsx/v/Stephan-James-Dick/kube-dive?label=Open%20VSX&logo=eclipseche)](https://open-vsx.org/extension/Stephan-James-Dick/kube-dive)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE.txt)

Kube Dive is a VS Code extension that allows you to explore your Kubernetes clusters as a virtual filesystem. Dive into your pods, browse files, edit them directly, and manage your resources without leaving your editor.

## Features

*   **Virtual Filesystem**: Browse Contexts, Namespaces, Pods, and their file systems directly in the VS Code Explorer.
*   **Multi-Cluster Support**: Seamlessly switch between different Kubernetes contexts (clusters).
*   **File Operations**:
    *   **Open/Read**: View files from your pods.
    *   **Edit/Save**: Edit files and save them back to the pod transparently.
    *   **Rename**: Rename files and directories.
    *   **Delete**: Delete files and directories.
    *   **Create**: Create new files and directories.
    *   **Download**: Download files from a pod to your local machine (loaded via buffer, subject to `maxBufferSizeMB`).
    *   **Download file**: Download files directly to a local directory bypassing any buffer size limits (suitable for very large files).
*   **Integrated Shell**:
    *   Right-click on a Pod to open a shell (`sh`) in the root directory.
    *   Right-click on a folder or file to open a shell directly in that directory.

## Requirements

*   **kubectl**: This extension relies on the `kubectl` command-line tool. Ensure it is installed and available in your system's PATH, or configure the path in the extension settings.
*   **Kubeconfig**: Your `~/.kube/config` (or equivalent) must be configured with access to the clusters you wish to explore.

## Extension Settings

This extension contributes the following settings:

*   `kubedive.kubectlPath`: Specifies the absolute path to the `kubectl` binary. Default is `kubectl` (uses system PATH).
*   `kubedive.maxBufferSizeMB`: Maximum standard output buffer size in MB when executing `kubectl` commands. Default is `100`. Increase this if you encounter "stdout maxBuffer length exceeded" errors when opening very large files.
*   `kubedive.timeoutSeconds`: Timeout in seconds for kubectl commands. Default is `30`. Prevents the Explorer progress bar from spinning indefinitely when a cluster is unreachable.

## Development & Testing

You can validate your changes locally prior to pushing or opening a pull request:

```bash
# Fast local check: Linter, Formatter & Coverage (without Docker)
npm run ci:local

# Full GitHub Actions simulation in local Docker containers (requires `act` & Docker)
npm run ci:act
```

## Known Issues

*   Large file transfers might be slow as they are piped through `kubectl exec`.
*   The extension currently assumes `sh` is available in the target pods.

## Release Notes

### 1.0.0

Initial release of Kube Dive.

### 1.0.1

Minor changes to the README.

### 1.0.2

Minor changes to the UI.

### 1.0.3

Added download to local directory and download to workspace commands.

### 1.0.4

Added more feeback for kubectl file transfer commands.

### 1.1.0

Added lazy loading for clusters and namespaces, caching, and refresh command.