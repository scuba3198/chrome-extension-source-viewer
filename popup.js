/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint browser:true, devel:true */
/* globals chrome, get_crx_url, get_zip_name, can_viewsource_crx_url */
/* globals encodeQueryString */
/* globals getPlatformInfoAsync */
'use strict';
var cws_url;
var crx_url;
var filename;

// See bg-contextmenu for potential values, at MENU_ID_ACTION_MENU.
var gActionClickAction = 'popup';

initialize();

function initialize() {
    var storageIsReady = false;

    getPlatformInfoAsync(function() {
        // Hack: although not guaranteed by the API, the getPlatformInfoAsync
        // call resolves ealier than the later tabs.query call, in practice.
        console.assert(!crx_url, 'getPlatformInfoAsync() should run first');
    });

    // Get CWS URL. On failure, close the popup
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        if (!tabs || !tabs.length) {
            return;
        }
        cws_url = tabs[0].url;
        // Note: Assuming getPlatformInfoAsync() to have resolved first.
        crx_url = get_crx_url(cws_url);
        
        // Extract a clean extension name from the tab title
        var cleanedTitle = getExtensionNameFromTitle(tabs[0].title);
        filename = get_zip_name(crx_url, cleanedTitle);
        
        if (!can_viewsource_crx_url(crx_url)) {
            chrome.action.disable(tabs[0].id);
            window.close();
            return;
        }
        ready();
        if (storageIsReady) {
            ready2();
        }
    });
    chrome.storage.sync.get({
        actionClickAction: gActionClickAction,
    }, function(items) {
        gActionClickAction = items && items.actionClickAction || gActionClickAction;
        storageIsReady = true;
        if (crx_url) {
            ready2();
        }
    });
}

function ready() {
    document.getElementById('download').onclick = doDownload;
    document.getElementById('view-source').onclick = doViewSource;
}

function ready2() {
    if (gActionClickAction == 'popup') {
        // Default action is keeping this popup open.
        // Nothing else left to do.
    } else if (gActionClickAction == 'download') {
        doDownload();
    } else if (gActionClickAction == 'view-source') {
        doViewSource();
    }
}

function doDownload() {
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        if (!tabs || !tabs.length) return;
        var cleanedTitle = getExtensionNameFromTitle(tabs[0].title);
        var customFilename = get_zip_name(crx_url, cleanedTitle);
        
        chrome.tabs.create({
            url: chrome.runtime.getURL('crxviewer.html') +
                '?' + encodeQueryString({
                    crx: crx_url,
                    zipname: customFilename,
                    'auto-download': '1'
                }),
            active: false,
            index: tabs[0].index + 1,
        }, function() {
            window.close();
        });
    });
}

function doViewSource() {
    chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
    }, function(tabs) {
        chrome.tabs.create({
            url: chrome.runtime.getURL('crxviewer.html') +
                '?' + encodeQueryString({crx: crx_url, zipname: filename}),
            active: true,
            index: tabs && tabs.length ? tabs[0].index + 1 : undefined,
        }, function() {
            window.close();
        });
    });
}

function getExtensionNameFromTitle(title) {
    if (!title) return '';
    // Clean up CWS (old and new)
    title = title.replace(/\s*-\s*Chrome Web Store$/i, '');
    title = title.replace(/^Chrome Web Store\s*-\s*/i, '');
    // Clean up Firefox (AMO)
    title = title.replace(/\s*–\s*Get this Extension for\s+.+$/i, '');
    title = title.replace(/\s*–\s*Add-ons for\s+.+$/i, '');
    // Clean up Edge
    title = title.replace(/\s*-\s*Microsoft Edge Addons$/i, '');
    // Clean up Opera
    title = title.replace(/\s+extension\s*-\s*Opera\s+Add-ons$/i, '');
    // Clean up Thunderbird
    title = title.replace(/\s*–\s*Add-ons for\s+Thunderbird$/i, '');
    
    // Clean up any characters that are invalid in filenames
    title = title.replace(/[\\/:*?"<>|]/g, '_');
    return title.trim();
}
