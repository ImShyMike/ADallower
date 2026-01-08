    // ==UserScript==
    // @name         ADallower
    // @namespace    http://tampermonkey.net/
    // @version      2026-01-07
    // @description  makes your ads much better
    // @author       hackatimefraud
    // @match        https://*/*
    // @match        http://*/*
    // @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
    // @grant        GM_xmlhttpRequest
    // @grant        unsafeWindow
    // @run-at       document-start
    // @connect      *
    // ==/UserScript==

    (function() {
        'use strict';

        const ONLY_ADS = false; // true = only replace images from known ad domains
        const BACKEND = "http://localhost:5000"; // what url to use for the backend
        const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/i; // regex fallback for image urls
        const FALLBACK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

        // check how many images the server has
        let totalImages = 0;
        GM_xmlhttpRequest({
            method: "GET",
            url: `${BACKEND}/count`,
            onload: function(response) {
                totalImages = parseInt(response.responseText, 10) || 0;
            }
        })

        /*
        * convert an ArrayBuffer to a data URL
        */
        function bufferToDataUrl(buffer, contentType) {
            const bytes = new Uint8Array(buffer);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);
            const type = contentType || "image/png";
            return `data:${type};base64,${base64}`;
        }

        let cachedImages = {}; // cache each image index's promise
        /*
        * fetch a replament image from the backend
        */
        function fetchReplacement() {
            const index = Math.floor(Math.random() * totalImages);
            if (cachedImages[index]) {
                return cachedImages[index];
            }

            let imageResponse = new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: `${BACKEND}/image/${index}`,
                    responseType: "arraybuffer",
                    onload: resp => {
                        const header = resp.responseHeaders || "";
                        const match = header.match(/content-type:\s*([^\n;]+)/i);
                        const contentType = match ? match[1].trim() : "image/png";
                        try {
                            const dataUrl = bufferToDataUrl(resp.response, contentType);
                            resolve({ dataUrl, index, source: "backend" });
                        } catch (e) {
                            console.warn(`ADallower: failed to parse replacement index ${index}, using fallback`, e);
                            resolve({ dataUrl: FALLBACK_PIXEL, index, source: "fallback" });
                        }
                    },
                    onerror: () => {
                        console.warn(`ADallower: error fetching replacement index ${index}, using fallback`);
                        resolve({ dataUrl: FALLBACK_PIXEL, index, source: "fallback" });
                    },
                    ontimeout: () => {
                        console.warn(`ADallower: timeout fetching replacement index ${index}, using fallback`);
                        resolve({ dataUrl: FALLBACK_PIXEL, index, source: "fallback" });
                    }
                });
            });

            cachedImages[index] = imageResponse;
            return imageResponse;
        }

        /*
        * use the headers to check if it's an image request
        */
        function headerAccept(headers) {
            if (!headers) return null;
            try {
                if (headers.get) return headers.get("accept");
            } catch (_) { /* ignore */ }
            if (Array.isArray(headers)) {
                const match = headers.find(([k]) => String(k).toLowerCase() === "accept");
                return match ? match[1] : null;
            }
            if (typeof headers === "object") return headers["accept"] || headers["Accept"] || null;
            return null;
        }

        /*
        * check if the request looks like an image request
        */
        function looksLikeImageRequest(input, init) {
            const url = typeof input === "string" ? input : input?.url;
            if (url) {
                try {
                    const { pathname } = new URL(url, location.href);
                    if (IMAGE_EXT_RE.test(pathname)) return true;
                } catch (_) { /* ignore parse errors */ }
            }

            const accept = headerAccept(init?.headers) || headerAccept(input?.headers);
            return typeof accept === "string" && accept.toLowerCase().includes("image");
        }

        /*
        * patch the page's fetch function to intercept image requests
        */
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
            if (looksLikeImageRequest(input, init)) {
                return fetchReplacement().then(({ dataUrl, index, source }) => {
                    return originalFetch(dataUrl, init);
                });
            }
            return originalFetch(input, init);
        };

        const OriginalXHR = window.XMLHttpRequest;
        class RedirectingXHR extends OriginalXHR {
            open(method, url, async = true, user, password) {
                const target = looksLikeImageRequest(url) ? `${BACKEND}/image/${Math.floor(Math.random() * totalImages)}` : url;
                return super.open(method, target, async, user, password);
            }
        }
        window.XMLHttpRequest = RedirectingXHR;
        let BLOCKLIST = [];
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://raw.githubusercontent.com/sjhgvr/oisd/main/domainswild2_small.txt",
            onload: function(response) {
                BLOCKLIST = response.responseText.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));
            }
        });

        /**
         * to replace or not to replace :P
         */
        function handleImage(img) {
            if (!img || !img.src) return;

            const url = img.src;

            // no infnite loops here smh
            if (img.dataset.processed) return;
            img.dataset.processed = "true";

            // if ONLY_ADS is enabled, check against blocklist (otherwise always replace)
            let parsedUrl = URL.parse(url);
            if (!ONLY_ADS || BLOCKLIST.some(blocked => parsedUrl.hostname.includes(blocked))) {
                fetchReplacement().then(({ dataUrl, index, source }) => {
                    if (!img.isConnected) return;
                    img.src = dataUrl;
                });
            }
        }

        // intercept images while they load
        function interceptBeforeLoad(event) {
            const node = event.target;
            if (!(node instanceof HTMLImageElement)) return;

            // avoid reprocessing the same element
            if (node.dataset.processed) return;

            event.preventDefault();
            node.dataset.processed = "true";
            fetchReplacement().then(({ dataUrl, index, source }) => {
                if (!node.isConnected) return;
                node.src = dataUrl;
            });
        }

        /**
         * the all seeing eye (that slows doen your browser)
         */
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;

                    // image?
                    if (node.tagName === "IMG") {
                        handleImage(node);
                    }

                    // has an image?
                    node.querySelectorAll?.("img").forEach(handleImage);
                }

                if (mutation.type === "attributes" && mutation.target.tagName === "IMG") {
                    handleImage(mutation.target);
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "srcset"]
        });

        window.addEventListener("beforeload", interceptBeforeLoad, true);

        // scan on load
        document.querySelectorAll("img").forEach(handleImage);
    })();
