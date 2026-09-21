const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const run = (context, file) => vm.runInContext(read(file), context, { filename: file });

test('every page script exists', () => {
    for (const page of ['crxviewer.html', 'popup.html', 'options.html']) {
        for (const match of read(page).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
            assert.ok(existsSync(path.join(root, match[1])), `${page}: ${match[1]}`);
        }
    }
});

test('viewer loads, reads, formats, highlights, reports errors and closes its reader', () => {
    for (const failure of [null, 'unpack', 'reader']) {
        const events = {}, handlers = {}, messages = {};
        const ports = {};
        for (const name of ['requestFileContent', 'requestHighlight', 'zipLoaded', 'zipLoadError', 'fileContentReceived', 'highlightedReceived']) {
            ports[name] = {
                subscribe: fn => { handlers[name] = fn; },
                send: value => { messages[name] = value; }
            };
        }
        let closed = false, SourceElement;
        const context = vm.createContext({ console, URLSearchParams,
            HTMLElement: class {},
            customElements: { define: (name, element) => { SourceElement = element; } },
            document: { readyState: 'loading', createElement: () => ({}), body: { appendChild() {} } },
            window: { location: { search: '?crx=https%3A%2F%2Fexample.com%2Faddon.crx' },
                addEventListener: (name, fn) => (events[name] ||= []).push(fn) },
            Elm: { Main: { init: () => ({ ports }) } },
            openCRXasZip: (url, done, error) => {
                assert.equal(url, 'https://example.com/addon.crx');
                failure === 'unpack' ? error('bad archive') : done('zip blob');
            },
            zip: {
                TextWriter: function() {}, BlobReader: function(blob) { assert.equal(blob, 'zip blob'); },
                createReader: (blob, done, error) => failure === 'reader' ? error('bad zip') : done({
                    close: () => { closed = true; },
                    getEntries: done => done([{ filename: 'main.js', uncompressedSize: 20, directory: false,
                        getData: (writer, done) => done('const x={value:1};') }])
                })
            }
        });
        run(context, 'lib/prettify/prism.js');
        run(context, 'lib/prettify/prism-source-extensions.js');
        run(context, 'lib/beautify/beautifier.js');
        context.beautify = (data, done) => done(context.beautifier.js(data.text, {}));
        context.beautify.getType = () => 'js';
        run(context, 'crxviewer-bridge.js');
        assert.ok(existsSync(path.join(root, context.zip.workerScriptsPath || '', 'z-worker.js')));
        events.DOMContentLoaded.forEach(fn => fn());
        if (failure) {
            assert.match(messages.zipLoadError, failure === 'unpack' ? /CRX unpacking failed/ : /Reader creation failed/);
            continue;
        }
        assert.equal(messages.zipLoaded[0].path, 'main.js');
        handlers.requestFileContent({ path: 'main.js', beautify: false });
        assert.equal(messages.fileContentReceived.content, 'const x={value:1};');
        handlers.requestFileContent({ path: 'main.js', beautify: true });
        assert.match(messages.fileContentReceived.content, /\n/);
        handlers.requestHighlight({ path: 'main.js', content: messages.fileContentReceived.content });
        assert.match(messages.highlightedReceived.htmlContent, /token keyword/);
        const source = new SourceElement();
        source.highlightedHtml = messages.highlightedReceived.htmlContent;
        assert.match(source.innerHTML, /token keyword/);
        context.Prism.rob.highlightSource = () => { throw Error('highlight failed'); };
        handlers.requestHighlight({ path: 'main.js', content: '<script>&"\'' });
        assert.equal(messages.highlightedReceived.htmlContent, '<ol><li>&lt;script&gt;&amp;&quot;&#39;</li></ol>');
        source.highlightedHtml = messages.highlightedReceived.htmlContent;
        assert.ok(!source.innerHTML.includes('<script>'));
        handlers.requestFileContent({ path: 'missing.js' });
        assert.match(messages.zipLoadError, /File not found/);
        events.unload.forEach(fn => fn());
        assert.ok(closed);
    }
});

test('CRX loader keeps the original URL and strips CRX2 headers', async () => {
    let xhr;
    const context = vm.createContext({ console, Blob, Uint8Array, btoa,
        XMLHttpRequest: function() { xhr = this; this.open = (method, url) => { this.url = url; }; this.send = () => {}; }
    });
    run(context, 'lib/crx-to-zip.js');
    const url = 'https://example.com/addon.crx?a=1&b=2';
    let result;
    context.openCRXasZip(url, blob => { result = blob; }, error => assert.fail(error));
    assert.equal(xhr.url, url);
    xhr.response = Uint8Array.from([67, 114, 50, 52, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 75, 3, 4]).buffer;
    xhr.onload();
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [80, 75, 3, 4]);
    let error;
    context.openCRXasZip(new Uint8Array([1, 2, 3]), () => assert.fail('accepted invalid CRX'), message => { error = message; });
    assert.match(error, /Invalid header/);
});

test('auto-download saves the ZIP and closes only on success', () => {
    for (const outcome of ['complete', 'interrupted', 'failed', 'already-complete']) {
        const events = {};
        let changed, closed = false, revoked = false, error;
        const context = vm.createContext({ console, URLSearchParams,
            HTMLElement: class {}, customElements: { define() {} },
            document: { readyState: 'loading', createElement: () => ({}), body: { appendChild() {} } },
            window: { location: { search: '?crx=addon.crx&auto-download=1&zipname=My%20Extension.zip' },
                addEventListener: (name, fn) => (events[name] ||= []).push(fn), close: () => { closed = true; } },
            Elm: { Main: { init: () => ({ ports: {
                requestFileContent: { subscribe() {} }, requestHighlight: { subscribe() {} },
                zipLoadError: { send: value => { error = value; } }
            } }) } },
            zip: { createReader: () => assert.fail('download must bypass viewer') },
            openCRXasZip: (url, done) => done('converted zip'),
            URL: { createObjectURL: blob => { assert.equal(blob, 'converted zip'); return 'blob:zip'; },
                revokeObjectURL: url => { assert.equal(url, 'blob:zip'); revoked = true; } },
            chrome: { runtime: {}, downloads: {
                onChanged: { addListener: fn => { changed = fn; }, removeListener: fn => { assert.equal(fn, changed); changed = null; } },
                download: (options, done) => {
                    assert.equal(options.url, 'blob:zip');
                    assert.equal(options.filename, 'My Extension.zip');
                    if (outcome === 'failed') context.chrome.runtime.lastError = { message: 'Canceled' };
                    done(outcome === 'failed' ? undefined : 42);
                },
                search: (query, done) => done([{ id: 42, state: outcome === 'already-complete' ? 'complete' : 'in_progress' }])
            } }
        });
        context.chrome.runtime.sendMessage = (message, done) => context.chrome.downloads.download(message, id => done({ id }));
        run(context, 'crxviewer-bridge.js');
        events.DOMContentLoaded.forEach(fn => fn());
        if (changed) {
            changed({ id: 99, state: { current: 'complete' } });
            assert.equal(closed, false);
            assert.equal(revoked, false);
            changed({ id: 42, state: { current: outcome } });
        }
        assert.equal(closed, outcome === 'complete' || outcome === 'already-complete');
        assert.equal(revoked, true);
        assert.equal(changed, null);
        assert.equal(Boolean(error), outcome === 'failed' || outcome === 'interrupted');
    }
});

test('background suggests the extension name after the download ID is returned', () => {
    let request, determine, options;
    const context = vm.createContext({ Map, chrome: {
        runtime: { id: 'viewer', getURL: file => 'chrome-extension://viewer/' + file,
            onMessage: { addListener: fn => { request = fn; } },
            onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
        extension: { inIncognitoContext: false },
        downloads: {
            onDeterminingFilename: { addListener: fn => { determine = fn; } },
            download: (value, done) => { options = value; done(42); }
        }
    } });
    run(context, 'background.js');
    const url = 'blob:chrome-extension://viewer/random-id';
    request({ type: 'download-zip', url, filename: 'My Extension.zip' }, { id: 'viewer' }, result => assert.equal(result.id, 42));
    assert.equal(options.filename, 'My Extension.zip');
    determine({ url: 'https://example.com/unrelated.zip' }, suggestion => assert.equal(suggestion, undefined));
    determine({ url }, suggestion => {
        assert.equal(suggestion.filename, 'My Extension.zip');
        assert.equal(suggestion.conflictAction, 'uniquify');
    });
    determine({ url }, suggestion => assert.equal(suggestion, undefined));
    request({ type: 'download-zip', url: 'https://example.com', filename: 'bad.zip' }, { id: 'viewer' }, result => assert.match(result.error, /Invalid/));
});
