// ===== Shared Utilities =====
// Used by both app.js (translator) and reader-app.js (reader)
(function () {
    // Detect encoding: try UTF-8 strict, fallback to GBK for Chinese .txt files
    function decodeBuffer(buf) {
        var bytes = new Uint8Array(buf);
        // Check UTF-8 BOM
        if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            return new TextDecoder('utf-8').decode(buf);
        }
        // Check UTF-16 LE/BE BOM
        if (bytes.length >= 2) {
            if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
            if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
        }
        // Try strict UTF-8 (fatal: true throws on invalid bytes)
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch (e) { /* Not valid UTF-8 */ }
        try {
            return new TextDecoder('gbk').decode(buf);
        } catch (e) { /* gbk not supported */ }
        try {
            return new TextDecoder('gb18030').decode(buf);
        } catch (e) { /* gb18030 not supported */ }
        // Last resort: lossy UTF-8
        return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function downloadFile(name, content, type) {
        var blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    window.VP = {
        decodeBuffer: decodeBuffer,
        escapeHtml: escapeHtml,
        formatSize: formatSize,
        downloadFile: downloadFile
    };
})();
