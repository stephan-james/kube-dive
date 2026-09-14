# Changelog

All notable changes to this project will be documented in this file.

## [1.1.2] - 2026-09-14

### Fixed
- Fixed an issue where the extension would not correctly activate when opening a workspace containing a `kubedive:/` folder, which led to an `ENOPRO: No file system provider found for resource` error in VS Code. The `activationEvents` configuration was changed to `*` to ensure the file system provider is registered on startup.
