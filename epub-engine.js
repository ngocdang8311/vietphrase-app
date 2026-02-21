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
                var file = findInZip(zip, href);
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
                // Strip fragment
                var cleanHref = href.split('#')[0];
                var file = findInZip(zip, cleanHref);
                if (!file) return Promise.reject(new Error('Chapter not found: ' + cleanHref));

                return file.async('text').then(function (html) {
                    // Collect all resource references: { raw, resolved }
                    var resourceMap = {}; // resolved -> [raw1, raw2, ...]

                    function addRef(rawRef) {
                        if (rawRef.indexOf('data:') === 0 || rawRef.indexOf('http://') === 0 || rawRef.indexOf('https://') === 0) return;
                        var resolved = resolveHref(cleanHref, rawRef);
                        if (!resourceMap[resolved]) resourceMap[resolved] = [];
                        if (resourceMap[resolved].indexOf(rawRef) === -1) {
                            resourceMap[resolved].push(rawRef);
                        }
                    }

                    // Find img src, image xlink:href, link href, source src
                    var srcRe = /(?:src|href|xlink:href)\s*=\s*["']([^"'#]+?)["']/gi;
                    var match;
                    while ((match = srcRe.exec(html)) !== null) {
                        addRef(match[1]);
                    }

                    // Find url() in inline styles and style tags
                    var urlRe = /url\(\s*["']?([^"')#]+?)["']?\s*\)/gi;
                    while ((match = urlRe.exec(html)) !== null) {
                        addRef(match[1]);
                    }

                    // Resolve all resources to blob URLs
                    var resolvedKeys = Object.keys(resourceMap);
                    var promises = resolvedKeys.map(function (rHref) {
                        return getResource(rHref).then(function (blobUrl) {
                            return { resolved: rHref, rawRefs: resourceMap[rHref], blobUrl: blobUrl };
                        });
                    });

                    return Promise.all(promises).then(function (mappings) {
                        var rewritten = html;
                        for (var i = 0; i < mappings.length; i++) {
                            if (!mappings[i].blobUrl) continue;
                            var blobUrl = mappings[i].blobUrl;
                            var rawRefs = mappings[i].rawRefs;

                            // Build alternation of all raw variants
                            var alts = rawRefs.map(escapeRegExp).join('|');

                            // Replace attribute references
                            rewritten = rewritten.replace(
                                new RegExp('((?:src|href|xlink:href)\\s*=\\s*["\'])(' + alts + ')(["\'])', 'gi'),
                                '$1' + blobUrl + '$3'
                            );

                            // Replace url() references
                            rewritten = rewritten.replace(
                                new RegExp('(url\\(\\s*["\']?)(' + alts + ')(["\']?\\s*\\))', 'gi'),
                                '$1' + blobUrl + '$3'
                            );
                        }

                        return rewritten;
                    });
                });
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

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    window.EpubEngine = {
        parse: parse
    };
})();
