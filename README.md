# Chrome Extension Source Viewer

A browser extension that allows you to view the source code of any Chrome Extension, Firefox Add-on, Opera Extension, or Edge Add-on directly in the browser, or download it as a zip file.

This repository features a customized version with a robust background download mechanism and clean, automatic filename generation based on the extension's actual name.

## Features

- **Direct Source Viewing**: Inspect extension files (HTML, CSS, JS, manifest.json, etc.) right from the browser.
- **Download as ZIP**: Convert and download any extension as a clean ZIP package with a single click.
- **Automatic Clean Filenames**: Automatically names download packages using the extension's actual name (e.g. `CRX Extractor_Downloader.zip`) instead of arbitrary hashes or extension IDs.
- **File Filtering**: Filter files by name and file type.
- **Code Formatting & Highlighting**: Integrated syntax highlighting and automatic code beautification (JS/CSS formatting).

## Installation

Since this is a customized developer version, you can install it using Developer Mode:

1. Download the latest release `.zip` file from the **Releases** section of this repository.
2. Extract the downloaded ZIP file to a folder on your computer.
3. Open your browser (Brave, Chrome, Edge) and navigate to the Extensions page:
   - Brave: `brave://extensions`
   - Chrome: `chrome://extensions`
4. Toggle **Developer mode** on (typically in the top-right corner).
5. Click **Load unpacked** (top-left) and select the folder where you extracted the extension files.

## How It Works

- **Popup Quick Actions**: Click the extension icon in your toolbar when on an extension store page (Chrome Web Store, AMO, Edge Add-ons, etc.) to quickly download the extension as a ZIP or view its source.
- **Safe Background Downloads**: Employs a robust background-tab processing strategy to fetch, compile, and download ZIP files without being aborted by popup closure.

## Technical Architecture

The core viewer UI (`src/Main.elm`) uses Elm v0.19.1, with browser operations handled by `crxviewer-bridge.js`.
- **Elm Architecture (TEA):** Elm handles all UI state, rendering, search filtering, and view modes.
- **Port Bridges:** Heavy or specialized tasks (such as unzipping with zip.js, beautifying JS/CSS, and Prism syntax highlighting) are handled in JavaScript and bridged via Elm Ports.

## Development

Run `npm ci`, `npm run build`, and `npm test` to install the compiler, rebuild the viewer, and check the viewer bridge and CRX loading paths.

## License

This project is licensed under the MIT License.
