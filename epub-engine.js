// ===== EpubEngine — Parse EPUB files using JSZip =====
(function () {
    'use strict';

    // Parse XML string into DOM document
    function parseXml(str) {
        return new DOMParser().parseFromString(str, 'application/xml');
    }

    // Resolve a relative href against a base path
    function resolveHref(base, href) {
        if (!href || href.indexOf('://') !== -1 || href.charAt(0) === '/') return href;
        // Decode first to avoid double-encoding
        try { href = decodeURIComponent(href); } catch (e) {}
        var parts = base.split('/');
        parts.pop(); // remove filename
        var hrefParts = href.split('/');
        for (var i = 0; i < hrefParts.length; i++) {
            if (hrefParts[i] === '..') {
                parts.pop();
            } else if (hrefParts[i] !== '.' && hrefParts[i] !== '') {
                parts.push(hrefParts[i]);
            }
        }
        return parts.join('/');
    }

    // Find a file in ZIP case-insensitively
    function findInZip(zip, path) {
        if (zip.file(path)) return zip.file(path);
        // Try case-insensitive
        var lower = path.toLowerCase();
        var found = null;
        zip.forEach(function (relativePath, entry) {
            if (!found && relativePath.toLowerCase() === lower) {
                found = entry;
            }
        });
        return found;
    }

    // Get MIME type from file extension
    function guessMime(href) {
        var ext = (href.split('?')[0].split('#')[0].match(/\.([^.]+)$/) || [])[1];
        if (!ext) return 'application/octet-stream';
        ext = ext.toLowerCase();
        var map = {
            'html': 'text/html', 'xhtml': 'application/xhtml+xml', 'htm': 'text/html',
            'css': 'text/css',
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
            'ttf': 'font/ttf', 'otf': 'font/otf', 'woff': 'font/woff', 'woff2': 'font/woff2',
            'mp3': 'audio/mpeg', 'mp4': 'video/mp4', 'ogg': 'audio/ogg',
            'js': 'text/javascript', 'json': 'application/json'
        };
        return map[ext] || 'application/octet-stream';
    }

    /**
     * Parse an EPUB ArrayBuffer.
     * Returns a Promise that resolves to an epub object.
     */
    function parse(arrayBuffer) {
        var zip, opfPath, opfBasePath;
        var manifest = {};  // id -> { href, mediaType, properties }
        var spine = [];     // [{ idref, href, mediaType }]
        var toc = [];       // [{ title, href }]
        var metadata = { title: '', author: '', language: '' };
        var blobUrls = [];  // track all created blob URLs for cleanup

        return JSZip.loadAsync(arrayBuffer).then(function (z) {
            zip = z;

            // Step 1: Read container.xml to find OPF path
            var containerFile = findInZip(zip, 'META-INF/container.xml');
            if (!containerFile) throw new Error('No META-INF/container.xml found');
            return containerFile.async('text');
        }).then(function (containerXml) {
            var doc = parseXml(containerXml);
            var rootfiles = doc.getElementsByTagName('rootfile');
            if (!rootfiles.length) throw new Error('No rootfile in container.xml');
            opfPath = rootfiles[0].getAttribute('full-path');
            if (!opfPath) throw new Error('No full-path in rootfile');

            var lastSlash = opfPath.lastIndexOf('/');
            opfBasePath = lastSlash >= 0 ? opfPath.substring(0, lastSlash + 1) : '';

            // Step 2: Read OPF
            var opfFile = findInZip(zip, opfPath);
            if (!opfFile) throw new Error('OPF file not found: ' + opfPath);
            return opfFile.async('text');
        }).then(function (opfXml) {
            var doc = parseXml(opfXml);

            // Parse metadata
            var titleEl = doc.getElementsByTagName('dc:title')[0] || doc.querySelector('title');
            if (titleEl) metadata.title = titleEl.textContent.trim();
            var authorEl = doc.getElementsByTagName('dc:creator')[0] || doc.querySelector('creator');
            if (authorEl) metadata.author = authorEl.textContent.trim();
            var langEl = doc.getElementsByTagName('dc:language')[0] || doc.querySelector('language');
            if (langEl) metadata.language = langEl.textContent.trim();

            // Parse manifest
            var manifestEl = doc.getElementsByTagName('manifest')[0];
            if (manifestEl) {
                var items = manifestEl.getElementsByTagName('item');
                for (var i = 0; i < items.length; i++) {
                    var item = items[i];
                    var id = item.getAttribute('id');
                    var href = item.getAttribute('href');
                    var mediaType = item.getAttribute('media-type');
                    var props = item.getAttribute('properties') || '';
                    if (id && href) {
                        manifest[id] = {
                            href: resolveHref(opfPath, href),
                            rawHref: href,
                            mediaType: mediaType || '',
                            properties: props
                        };
                    }
                }
            }

            // Parse spine
            var spineEl = doc.getElementsByTagName('spine')[0];
            var tocId = spineEl ? spineEl.getAttribute('toc') : null;
            if (spineEl) {
                var itemrefs = spineEl.getElementsByTagName('itemref');
                for (var j = 0; j < itemrefs.length; j++) {
                    var idref = itemrefs[j].getAttribute('idref');
                    if (idref && manifest[idref]) {
                        spine.push({
                            idref: idref,
                            href: manifest[idref].href,
                            mediaType: manifest[idref].mediaType
                        });
                    }
                }
            }

            // Parse TOC
            // Try EPUB3 nav first
            var navItem = null;
            for (var mid in manifest) {
                if (manifest.hasOwnProperty(mid) && manifest[mid].properties.indexOf('nav') !== -1) {
                    navItem = manifest[mid];
                    break;
                }
            }

            if (navItem) {
                var navFile = findInZip(zip, navItem.href);
                if (navFile) {
                    return navFile.async('text').then(function (navHtml) {
                        toc = parseEpub3Nav(navHtml, navItem.href);
                    });
                }
            } else if (tocId && manifest[tocId]) {
                // EPUB2: NCX
                var ncxFile = findInZip(zip, manifest[tocId].href);
                if (ncxFile) {
                    return ncxFile.async('text').then(function (ncxXml) {
                        toc = parseNcx(ncxXml, manifest[tocId].href);
                    });
                }
            }
        }).then(function () {
            // Fallback: if no TOC parsed, build from spine
            if (toc.length === 0 && spine.length > 0) {
                for (var i = 0; i < spine.length; i++) {
                    var fname = spine[i].href.split('/').pop().replace(/\.[^.]+$/, '');
                    toc.push({
                        title: fname || ('Chapter ' + (i + 1)),
                        href: spine[i].href
                    });
                }
            }

            // Resource cache for blob URLs
            var resourceCache = {};

            function getResource(href) {
                if (resourceCache[href]) return Promise.resolve(resourceCache[href]);
                // Strip query string for ZIP lookup (e.g. image.jpg?v=1)
                var cleanPath = href.split('?')[0];
                var file = findInZip(zip, cleanPath);
                if (!file) return Promise.resolve(null);
                return file.async('blob').then(function (blob) {
                    var mime = guessMime(href);
                    var typedBlob = new Blob([blob], { type: mime });
                    var url = URL.createObjectURL(typedBlob);
                    blobUrls.push(url);
                    resourceCache[href] = url;
                    return url;
                });
            }

            function getChapterContent(href) {
                // Strip fragment and query string
                var cleanHref = href.split('#')[0].split('?')[0];
                var file = findInZip(zip, cleanHref);
                if (!file) return Promise.reject(new Error('Chapter not found: ' + cleanHref));

                return file.async('text').then(function (html) {
                    // Use DOM to safely rewrite resource URLs without touching <a> links
                    // Parse as HTML (works for XHTML too, more forgiving)
                    var doc = new DOMParser().parseFromString(html, 'text/html');

                    // Collect all resource refs that need blob URL rewriting
                    var refEntries = []; // [{ el, attr, rawRef }]

                    // img/video/audio/source src
                    var srcEls = doc.querySelectorAll('img[src], video[src], audio[src], source[src], input[src]');
                    for (var si = 0; si < srcEls.length; si++) {
                        var val = srcEls[si].getAttribute('src');
                        if (val && !_isAbsolute(val)) refEntries.push({ el: srcEls[si], attr: 'src', rawRef: val });
                    }

                    // srcset on img and source
                    var srcsetEls = doc.querySelectorAll('img[srcset], source[srcset]');
                    for (var ss = 0; ss < srcsetEls.length; ss++) {
                        refEntries.push({ el: srcsetEls[ss], attr: 'srcset', rawRef: srcsetEls[ss].getAttribute('srcset') });
                    }

                    // link[href] (stylesheets) — NOT <a> tags
                    var linkEls = doc.querySelectorAll('link[href]');
                    for (var li = 0; li < linkEls.length; li++) {
                        var lval = linkEls[li].getAttribute('href');
                        if (lval && !_isAbsolute(lval)) refEntries.push({ el: linkEls[li], attr: 'href', rawRef: lval });
                    }

                    // SVG image xlink:href / href
                    var imgEls = doc.querySelectorAll('image');
                    for (var ii = 0; ii < imgEls.length; ii++) {
                        var xhref = imgEls[ii].getAttributeNS('http://www.w3.org/1999/xlink', 'href') || imgEls[ii].getAttribute('href');
                        if (xhref && !_isAbsolute(xhref)) {
                            refEntries.push({ el: imgEls[ii], attr: imgEls[ii].hasAttributeNS('http://www.w3.org/1999/xlink', 'href') ? 'xlink:href' : 'href', rawRef: xhref });
                        }
                    }

                    // Also collect url() refs from <style> and style attributes for pre-fetching
                    var cssUrlRe = /url\(\s*["']?([^"')]+?)["']?\s*\)/gi;
                    var styleEls2 = doc.querySelectorAll('style');
                    for (var csi = 0; csi < styleEls2.length; csi++) {
                        var cssMatch;
                        while ((cssMatch = cssUrlRe.exec(styleEls2[csi].textContent)) !== null) {
                            if (!_isAbsolute(cssMatch[1])) {
                                refEntries.push({ el: null, attr: 'css-url', rawRef: cssMatch[1] });
                            }
                        }
                    }
                    var styledEls2 = doc.querySelectorAll('[style]');
                    for (var csai = 0; csai < styledEls2.length; csai++) {
                        var cssMatch2;
                        while ((cssMatch2 = cssUrlRe.exec(styledEls2[csai].getAttribute('style'))) !== null) {
                            if (!_isAbsolute(cssMatch2[1])) {
                                refEntries.push({ el: null, attr: 'css-url', rawRef: cssMatch2[1] });
                            }
                        }
                    }

                    // Collect unique resolved paths
                    var resourceMap = {}; // resolved -> [{ entry, rawRef }]
                    for (var ri = 0; ri < refEntries.length; ri++) {
                        var entry = refEntries[ri];
                        if (entry.attr === 'srcset') {
                            // Parse srcset: "url1 1x, url2 2x" — each URL needs resolving
                            var parts = entry.rawRef.split(',');
                            for (var pi = 0; pi < parts.length; pi++) {
                                var trimmed = parts[pi].trim();
                                var spaceIdx = trimmed.indexOf(' ');
                                var srcUrl = spaceIdx > 0 ? trimmed.substring(0, spaceIdx) : trimmed;
                                if (srcUrl && !_isAbsolute(srcUrl)) {
                                    var resolved = resolveHref(cleanHref, srcUrl);
                                    if (!resourceMap[resolved]) resourceMap[resolved] = [];
                                    resourceMap[resolved].push({ entry: entry, rawUrl: srcUrl, partIndex: pi });
                                }
                            }
                        } else {
                            var rawClean = entry.rawRef.split('#')[0];
                            var resolved2 = resolveHref(cleanHref, rawClean);
                            if (!resourceMap[resolved2]) resourceMap[resolved2] = [];
                            // css-url entries only need pre-fetching into resourceCache, no DOM mutation
                            if (entry.attr !== 'css-url') {
                                resourceMap[resolved2].push({ entry: entry, rawUrl: null, partIndex: -1 });
                            } else if (!resourceMap[resolved2].length) {
                                // Ensure key exists so getResource is called
                                resourceMap[resolved2].push(null);
                            }
                        }
                    }

                    // Resolve all resources to blob URLs
                    var resolvedKeys = Object.keys(resourceMap);
                    var promises = resolvedKeys.map(function (rHref) {
                        return getResource(rHref).then(function (blobUrl) {
                            return { resolved: rHref, refs: resourceMap[rHref], blobUrl: blobUrl };
                        });
                    });

                    return Promise.all(promises).then(function (mappings) {
                        // Apply blob URLs to DOM elements
                        for (var mi = 0; mi < mappings.length; mi++) {
                            if (!mappings[mi].blobUrl) continue;
                            var blobUrl = mappings[mi].blobUrl;
                            var refs = mappings[mi].refs;
                            for (var ri2 = 0; ri2 < refs.length; ri2++) {
                                var ref = refs[ri2];
                                if (!ref || !ref.entry || !ref.entry.el) continue;
                                var el = ref.entry.el;
                                var attr = ref.entry.attr;
                                if (attr === 'srcset') {
                                    // Rewrite individual URL within srcset
                                    var curSrcset = el.getAttribute('srcset');
                                    if (curSrcset && ref.rawUrl) {
                                        el.setAttribute('srcset', curSrcset.split(ref.rawUrl).join(blobUrl));
                                    }
                                } else if (attr === 'xlink:href') {
                                    el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', blobUrl);
                                } else {
                                    el.setAttribute(attr, blobUrl);
                                }
                            }
                        }

                        // Rewrite url() in <style> tags and style attributes via text replacement
                        var styleEls = doc.querySelectorAll('style');
                        for (var sti = 0; sti < styleEls.length; sti++) {
                            styleEls[sti].textContent = _rewriteCssUrls(styleEls[sti].textContent, cleanHref);
                        }
                        // Inline style attributes
                        var styledEls = doc.querySelectorAll('[style]');
                        for (var stai = 0; stai < styledEls.length; stai++) {
                            var orig = styledEls[stai].getAttribute('style');
                            var rewritten = _rewriteCssUrls(orig, cleanHref);
                            if (rewritten !== orig) styledEls[stai].setAttribute('style', rewritten);
                        }

                        // Serialize back to HTML
                        // Use head + body content separately to preserve structure
                        var headHtml = doc.head ? doc.head.innerHTML : '';
                        var bodyHtml = doc.body ? doc.body.innerHTML : '';
                        return { head: headHtml, body: bodyHtml };
                    });
                });

                function _rewriteCssUrls(css, baseHref) {
                    return css.replace(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi, function (full, rawUrl) {
                        if (_isAbsolute(rawUrl)) return full;
                        var resolved = resolveHref(baseHref, rawUrl.split('#')[0]);
                        var cached = resourceCache[resolved];
                        return cached ? 'url(' + cached + ')' : full;
                    });
                }
            }

            function revokeAll() {
                for (var i = 0; i < blobUrls.length; i++) {
                    try { URL.revokeObjectURL(blobUrls[i]); } catch (e) {}
                }
                blobUrls = [];
                resourceCache = {};
            }

            return {
                metadata: metadata,
                manifest: manifest,
                spine: spine,
                toc: toc,
                getChapterContent: getChapterContent,
                getResource: getResource,
                revokeAll: revokeAll
            };
        });
    }

    // Parse EPUB3 navigation document
    function parseEpub3Nav(html, navHref) {
        var results = [];
        try {
            var doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
            // Find nav with epub:type="toc" or just first nav
            var navEls = doc.getElementsByTagName('nav');
            var tocNav = null;
            for (var i = 0; i < navEls.length; i++) {
                var epubType = navEls[i].getAttribute('epub:type') || navEls[i].getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '';
                if (epubType === 'toc') { tocNav = navEls[i]; break; }
            }
            if (!tocNav && navEls.length > 0) tocNav = navEls[0];
            if (!tocNav) return results;

            var links = tocNav.getElementsByTagName('a');
            for (var j = 0; j < links.length; j++) {
                var href = links[j].getAttribute('href');
                var title = links[j].textContent.trim();
                if (href && title) {
                    results.push({
                        title: title,
                        href: resolveHref(navHref, href.split('#')[0])
                    });
                }
            }
        } catch (e) {
            // If XHTML parsing fails, try as HTML
            try {
                var htmlDoc = new DOMParser().parseFromString(html, 'text/html');
                var navEls2 = htmlDoc.querySelectorAll('nav[epub\\:type="toc"], nav');
                var tocNav2 = navEls2[0];
                if (tocNav2) {
                    var links2 = tocNav2.querySelectorAll('a[href]');
                    for (var k = 0; k < links2.length; k++) {
                        var href2 = links2[k].getAttribute('href');
                        var title2 = links2[k].textContent.trim();
                        if (href2 && title2) {
                            results.push({
                                title: title2,
                                href: resolveHref(navHref, href2.split('#')[0])
                            });
                        }
                    }
                }
            } catch (e2) {}
        }

        // Deduplicate consecutive entries with same href
        var deduped = [];
        for (var d = 0; d < results.length; d++) {
            if (d === 0 || results[d].href !== results[d - 1].href) {
                deduped.push(results[d]);
            }
        }
        return deduped;
    }

    // Parse EPUB2 NCX table of contents
    function parseNcx(ncxXml, ncxHref) {
        var results = [];
        try {
            var doc = parseXml(ncxXml);
            var navPoints = doc.getElementsByTagName('navPoint');
            for (var i = 0; i < navPoints.length; i++) {
                var textEl = navPoints[i].getElementsByTagName('text')[0];
                var contentEl = navPoints[i].getElementsByTagName('content')[0];
                if (textEl && contentEl) {
                    var src = contentEl.getAttribute('src');
                    if (src) {
                        results.push({
                            title: textEl.textContent.trim(),
                            href: resolveHref(ncxHref, src.split('#')[0])
                        });
                    }
                }
            }
        } catch (e) {}

        // Deduplicate
        var deduped = [];
        for (var d = 0; d < results.length; d++) {
            if (d === 0 || results[d].href !== results[d - 1].href) {
                deduped.push(results[d]);
            }
        }
        return deduped;
    }

    function _isAbsolute(url) {
        return !url || url.indexOf('data:') === 0 || url.indexOf('http://') === 0 ||
            url.indexOf('https://') === 0 || url.indexOf('blob:') === 0;
    }

    window.EpubEngine = {
        parse: parse
    };
})();
