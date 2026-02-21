// ===== EPUB Bridge — ES module exposing foliate-js to classic scripts =====
import { makeBook } from './foliate-js/view.js'

function flattenToc(items, depth) {
    if (!items) return [];
    depth = depth || 0;
    var result = [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        result.push({
            title: item.label || '',
            href: item.href || '',
            depth: depth
        });
        if (item.subitems && item.subitems.length) {
            result = result.concat(flattenToc(item.subitems, depth + 1));
        }
    }
    return result;
}

function extractMeta(book) {
    var meta = book.metadata || {};
    var title = '';
    if (typeof meta.title === 'string') title = meta.title;
    else if (meta.title && typeof meta.title === 'object') {
        var vals = Object.values(meta.title);
        title = vals[0] || '';
    }
    var author = '';
    if (Array.isArray(meta.author)) {
        var names = meta.author.map(function(a) {
            return typeof a === 'string' ? a : (a.name || '');
        });
        author = names.join(', ');
    } else if (typeof meta.author === 'string') {
        author = meta.author;
    } else if (meta.author && typeof meta.author === 'object') {
        var avals = Object.values(meta.author);
        author = avals[0] || '';
    }
    return { title: title, author: author };
}

window.EpubBridge = {
    ready: true,

    // Extract metadata without rendering (for import)
    // filename is used by makeBook to detect format (cbz, fb2, fbz by extension)
    async parseMetadata(arrayBuffer, filename) {
        var file = new File([arrayBuffer], filename || 'book.epub', { type: 'application/octet-stream' });
        var book = await makeBook(file);
        var metadata = extractMeta(book);
        var toc = flattenToc(book.toc);
        var sectionCount = book.sections ? book.sections.length : 0;
        return { metadata: metadata, toc: toc, sectionCount: sectionCount };
    },

    createView: function() {
        return document.createElement('foliate-view');
    },

    flattenToc: flattenToc,
    extractMeta: extractMeta
};

// Signal readiness for classic scripts waiting via waitForBridge()
if (window._epubBridgeResolve) window._epubBridgeResolve();
