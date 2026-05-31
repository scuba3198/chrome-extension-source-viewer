/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint esversion:6 */
/* globals navigator */
/* globals chrome, cws_match_patterns, mea_match_pattern, ows_match_pattern, amo_match_patterns, atn_match_patterns,
   cws_pattern, mea_pattern, ows_pattern, amo_pattern, atn_pattern,
    */

'use strict';

  // Work-around for crbug.com/1132684: static event_rules disappear after a
  // restart, so we register rules dynamically instead, on install.
function registerEventRules() {
    if (registerEventRules.hasRunOnce) {
        return;
    }
    registerEventRules.hasRunOnce = true;

    var pageUrlFilters = [{
        hostEquals: "chrome.google.com",
        pathPrefix: "/webstore/detail/"
    }, {
        hostEquals: "chromewebstore.google.com",
        pathPrefix: "/detail/"
    }, {
        hostEquals: "microsoftedge.microsoft.com",
        pathPrefix: "/webstore/detail/"
    }, {
        hostEquals: "addons.opera.com",
        pathContains: "extensions/details/"
    }, {
        hostEquals: "addons.mozilla.org",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons.mozilla.org",
        pathContains: "review/"
    }, {
        hostEquals: "addons.allizom.org",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons.allizom.org",
        pathContains: "review/"
    }, {
        hostEquals: "addons-dev.allizom.org",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons-dev.allizom.org",
        pathContains: "review/"
    }, {
        hostEquals: "addons.thunderbird.net",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons-stage.thunderbird.net",
        pathContains: "addon/"
    }];

    if (!chrome.declarativeContent.ShowAction) {
        // Chrome < 97.
        chrome.declarativeContent.ShowAction = chrome.declarativeContent.ShowPageAction;
    }

    var rule = {
        conditions: pageUrlFilters.map(function(pageUrlFilter) {
            return new chrome.declarativeContent.PageStateMatcher({
                pageUrl: pageUrlFilter,
            });
        }),
        actions: [
            new chrome.declarativeContent.ShowAction(),
        ],
    };

    chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
        chrome.declarativeContent.onPageChanged.addRules([rule], function() {
            // Visibility of action fully controlled by declarativeContent.
            chrome.action.disable();
        });
    });
}
  // The documentation recommends to use runtime.onInstalled to register
  // declarativeContent rules. Due to bugs, additional work-arounds are needed
  // to ensure that the declarativeContent rules are registered correctly.
chrome.runtime.onInstalled.addListener(registerEventRules);
  // Work-around for crbug.com/388231: onInstalled is not fired when the
  // extension was disabled during an update.
chrome.runtime.onStartup.addListener(registerEventRules);
  // Work-around for crbug.com/264963: onInstalled is not fired when the
  // extension is run in incognito mode. Although not documented, incognito
  // contexts have their own declarativeContent rule store.
if (chrome.extension.inIncognitoContext) {
    chrome.declarativeContent.onPageChanged.getRules(function(rules) {
        if (!rules.length) {
            registerEventRules();
        }
    });
}


