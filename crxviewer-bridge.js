(function() {
    'use strict';

    // Set zip workerScriptsPath so that zip.js knows where to find z-worker.js
    if (typeof zip !== 'undefined') {
        zip.workerScriptsPath = 'lib/zip.js/';
    }

    // Keep track of active object URLs for download links to prevent memory leaks
    let currentZipObjectUrl = null;
    let currentCrxObjectUrl = null;

    function cleanupObjectUrls() {
        if (currentZipObjectUrl) {
            URL.revokeObjectURL(currentZipObjectUrl);
            currentZipObjectUrl = null;
        }
        if (currentCrxObjectUrl) {
            URL.revokeObjectURL(currentCrxObjectUrl);
            currentCrxObjectUrl = null;
        }
    }

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

        // Handle saving user setting
        app.ports.saveSetting.subscribe(function(data) {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set({ [data.key]: data.value });
            } else {
                localStorage.setItem(data.key, data.value);
            }
        });

        // Port trigger to read ZIP/CRX
        app.ports.requestZipContents.subscribe(function(url) {
            loadZip(url);
        });

        // Load initially stored settings
        loadStoredSettings();
    }

    function loadStoredSettings() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(null, function(items) {
                if (chrome.runtime.lastError) return;
                app.ports.settingsLoaded.send(items);
            });
        } else {
            // Mock/localStorage load for testing
            const items = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                items[key] = localStorage.getItem(key);
            }
            app.ports.settingsLoaded.send(items);
        }
    }

    function handleAutoDownload(zipDownloadUrl, computedZipName) {
        if (getParam('auto-download') === '1') {
            if (typeof chrome !== 'undefined' && chrome.downloads) {
                chrome.downloads.onCreated.addListener(function createdListener(downloadItem) {
                    if (downloadItem.byExtensionId === chrome.runtime.id) {
                        chrome.downloads.onCreated.removeListener(createdListener);
                        const downloadId = downloadItem.id;
                        chrome.downloads.onChanged.addListener(function changedListener(delta) {
                            if (delta.id === downloadId && delta.state) {
                                if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
                                    chrome.downloads.onChanged.removeListener(changedListener);
                                    window.close();
                                }
                            }
                        });
                    }
                });
            }

            const autoLink = document.createElement('a');
            autoLink.href = zipDownloadUrl;
            autoLink.download = computedZipName;
            document.body.appendChild(autoLink);
            autoLink.click();
            document.body.removeChild(autoLink);

            if (typeof chrome === 'undefined' || !chrome.downloads) {
                setTimeout(function() {
                    window.close();
                }, 3000);
            }
            return true;
        }
        return false;
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

        const crxUrlParam = getParam('crx');
        const zipNameParam = getParam('zipname');

        // Compute Webstore URL
        let webstoreUrl = null;
        if (crxUrlParam && typeof get_webstore_url !== 'undefined') {
            webstoreUrl = get_webstore_url(crxUrlParam);
        }

        // Compute ZIP name
        let computedZipName = 'extension.zip';
        if (typeof get_zip_name !== 'undefined') {
            computedZipName = get_zip_name(crxUrlParam || (typeof urlOrBlob === 'string' ? urlOrBlob : ''), zipNameParam);
        } else if (zipNameParam) {
            computedZipName = zipNameParam;
        }

        // Compute CRX name
        const computedCrxName = computedZipName.replace(/\.zip$/i, '.crx');

        // Compute Open Viewer URL
        let openViewerUrl = 'crxviewer.html';
        if (crxUrlParam && typeof encodeQueryString !== 'undefined') {
            openViewerUrl += '?' + encodeQueryString({
                noview: 'on',
                crx: crxUrlParam
            });
        }

        // Use openCRXasZip to safely handle both URLs and Blobs, as well as stripping CRX headers
        if (typeof openCRXasZip !== 'undefined') {
            openCRXasZip(urlOrBlob, function(zipBlob, publicKey, raw_crx_data) {
                cleanupObjectUrls();
                currentZipObjectUrl = URL.createObjectURL(zipBlob);
                const zipDownloadUrl = currentZipObjectUrl;

                if (handleAutoDownload(zipDownloadUrl, computedZipName)) {
                    return;
                }

                let crxDownloadUrl = null;
                if (raw_crx_data) {
                    const crxBlob = new Blob([raw_crx_data], { type: 'application/octet-stream' });
                    currentCrxObjectUrl = URL.createObjectURL(crxBlob);
                    crxDownloadUrl = currentCrxObjectUrl;
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
                        app.ports.zipLoaded.send({
                            entries: mapped,
                            zipname: computedZipName,
                            downloadUrl: zipDownloadUrl,
                            crxDownloadUrl: crxDownloadUrl,
                            crxDownloadName: computedCrxName,
                            webstoreUrl: webstoreUrl,
                            openViewerUrl: openViewerUrl
                        });
                    });
                }, function(error) {
                    app.ports.zipLoadError.send("Reader creation failed: " + String(error));
                });
            }, function(error) {
                app.ports.zipLoadError.send("CRX unpacking failed: " + String(error));
            });
        } else {
            // Fallback if openCRXasZip is not loaded
            const processBlob = function(blob) {
                cleanupObjectUrls();
                currentZipObjectUrl = URL.createObjectURL(blob);
                const zipDownloadUrl = currentZipObjectUrl;

                if (handleAutoDownload(zipDownloadUrl, computedZipName)) {
                    return;
                }

                zip.createReader(new zip.BlobReader(blob), function(zipReader) {
                    activeZipReader = zipReader;
                    zipReader.getEntries(function(entries) {
                        loadedEntries = entries;
                        const mapped = entries.map(e => ({
                            path: e.filename,
                            size: e.uncompressedSize,
                            isDirectory: e.directory
                        }));
                        app.ports.zipLoaded.send({
                            entries: mapped,
                            zipname: computedZipName,
                            downloadUrl: zipDownloadUrl,
                            crxDownloadUrl: null,
                            crxDownloadName: null,
                            webstoreUrl: webstoreUrl,
                            openViewerUrl: openViewerUrl
                        });
                    });
                }, function(error) {
                    app.ports.zipLoadError.send(String(error));
                });
            };

            if (urlOrBlob instanceof Blob) {
                processBlob(urlOrBlob);
            } else if (typeof urlOrBlob === 'string') {
                fetch(urlOrBlob)
                    .then(r => r.blob())
                    .then(processBlob)
                    .catch(e => {
                        app.ports.zipLoadError.send("Failed to fetch zip: " + String(e));
                    });
            }
        }
    }

    // Hook initial load from parameters safely
    function handleInitialLoad() {
        const crx_url = getParam('crx');
        const zipname = getParam('zipname');
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
        cleanupObjectUrls();
        if (activeZipReader) {
            try {
                activeZipReader.close();
            } catch (e) {}
        }
    });
})();
