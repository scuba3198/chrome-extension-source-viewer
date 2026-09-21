(function() {
    'use strict';

    zip.workerScriptsPath = 'lib/zip.js/';

    // Elm blocks innerHTML; only pass Prism's escaped output to this element.
    customElements.define('highlighted-source', class extends HTMLElement {
        set highlightedHtml(html) {
            this.innerHTML = html;
        }
    });

    // Helper to escape HTML characters (prevents HTML/XSS injection on Prism fallback)
    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    let app = null;

    // Initialize Elm safely after DOM is loaded
    function initElm() {
        const rootDiv = document.createElement('div');
        rootDiv.id = 'elm-app';
        document.body.appendChild(rootDiv);

        app = Elm.Main.init({
            node: rootDiv
        });

        setupPorts();
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initElm);
    } else {
        initElm();
    }

    // Keep reference of current active zip/entries
    let loadedEntries = [];
    let activeZipReader = null;

    // Extract URL params like legacy crxviewer did
    function getParam(name) {
        const params = new URLSearchParams(window.location.search);
        return params.get(name);
    }

    function setupPorts() {
        // Handle loading file contents
        app.ports.requestFileContent.subscribe(function(data) {
            const entry = loadedEntries.find(e => e.filename === data.path);
            if (!entry) {
                app.ports.zipLoadError.send("File not found in active zip");
                return;
            }

            const Writer = zip.TextWriter;
            entry.getData(new Writer(), function(text) {
                if (data.beautify && typeof beautify !== 'undefined') {
                    beautify({
                        text: text,
                        type: beautify.getType(entry.filename),
                        wrap: 0
                    }, function(formatted) {
                        app.ports.fileContentReceived.send({
                            path: entry.filename,
                            content: formatted,
                            isBeautified: true
                        });
                    });
                } else {
                    app.ports.fileContentReceived.send({
                        path: entry.filename,
                        content: text,
                        isBeautified: false
                    });
                }
            }, function(current, total) {
                // progress logs
            });
        });

        // Handle prism syntax highlighting request
        app.ports.requestHighlight.subscribe(function(data) {
            try {
                // Synchronous or asynchronous highlight from Prism helper
                const html = Prism.rob.highlightSource(data.content, data.path);
                app.ports.highlightedReceived.send({
                    path: data.path,
                    htmlContent: html
                });
            } catch (e) {
                // Safeguard content by escaping it to prevent HTML/script injection
                app.ports.highlightedReceived.send({
                    path: data.path,
                    htmlContent: `<ol><li>${escapeHtml(data.content)}</li></ol>`
                });
            }
        });
    }

    function loadZip(urlOrBlob) {
        // Clean up previous active zip reader/workers to prevent resource leakage
        if (activeZipReader) {
            try {
                activeZipReader.close();
            } catch (e) {
                console.error("Error closing old zip reader:", e);
            }
            activeZipReader = null;
        }

        openCRXasZip(urlOrBlob, function(zipBlob) {
            if (getParam('auto-download') === '1') {
                const url = URL.createObjectURL(zipBlob);
                let downloadId;
                function finish(item) {
                    if (item.id !== downloadId) return;
                    const state = typeof item.state === 'string' ? item.state : item.state && item.state.current;
                    if (state !== 'complete' && state !== 'interrupted') return;
                    chrome.downloads.onChanged.removeListener(finish);
                    URL.revokeObjectURL(url);
                    if (state === 'complete') window.close();
                    else app.ports.zipLoadError.send('ZIP download interrupted. Please try again.');
                }
                chrome.downloads.onChanged.addListener(finish);
                chrome.runtime.sendMessage({ type: 'download-zip', url, filename: getParam('zipname') || 'extension.zip' }, function(result) {
                    const error = chrome.runtime.lastError?.message || result?.error;
                    const id = result?.id;
                    if (error || id === undefined) {
                        chrome.downloads.onChanged.removeListener(finish);
                        URL.revokeObjectURL(url);
                        app.ports.zipLoadError.send('ZIP download failed: ' + (error || 'No download ID'));
                        return;
                    }
                    downloadId = id;
                    // Catch a download that finished before its ID was returned.
                    chrome.downloads.search({ id }, function(items) {
                        if (items && items[0]) finish(items[0]);
                    });
                });
                return;
            }
            zip.createReader(new zip.BlobReader(zipBlob), function(zipReader) {
                activeZipReader = zipReader;
                zipReader.getEntries(function(entries) {
                    loadedEntries = entries;
                    const mapped = entries.map(e => ({
                        path: e.filename,
                        size: e.uncompressedSize,
                        isDirectory: e.directory
                    }));
                    app.ports.zipLoaded.send(mapped);
                });
            }, function(error) {
                app.ports.zipLoadError.send("Reader creation failed: " + String(error));
            });
        }, function(error) {
            app.ports.zipLoadError.send("CRX unpacking failed: " + String(error));
        });
    }

    // Hook initial load from parameters safely
    function handleInitialLoad() {
        const crx_url = getParam('crx');
        const blob_url = getParam('blob');

        if (blob_url) {
            loadZip(blob_url);
        } else if (crx_url) {
            loadZip(crx_url);
        }
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', handleInitialLoad);
    } else {
        handleInitialLoad();
    }

    // Cleanup active resources on page unload
    window.addEventListener('unload', () => {
        if (activeZipReader) {
            try {
                activeZipReader.close();
            } catch (e) {}
        }
    });
})();
