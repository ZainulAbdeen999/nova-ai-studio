/**
 * markdown.js — minimal, safe markdown-ish renderer.
 * Supports: fenced code blocks, **bold**, `inline code`, bullet lists, newlines.
 * All input is escaped first; output is safe to inject as innerHTML.
 */
(function (global) {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function inlineMd(s) {
        s = esc(s);
        s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        s = s.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
        return s.replace(/\n/g, '<br>');
    }

    function textBlocks(text) {
        const lines = text.split('\n');
        const out = [];
        let inUl = false;
        for (const raw of lines) {
            const t = raw.trim();
            if (/^[-*•]\s+/.test(t)) {
                if (!inUl) { out.push('<ul>'); inUl = true; }
                out.push('<li>' + inlineMd(t.replace(/^[-*•]\s+/, '')) + '</li>');
                continue;
            }
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (!t) { out.push('<br>'); continue; }
            out.push(inlineMd(t));
        }
        if (inUl) out.push('</ul>');
        return out.join('\n');
    }

    function renderMarkdown(src) {
        const parts = String(src || '').split(/```/);
        let out = '';
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 1) {
                let code = parts[i];
                const nl = code.indexOf('\n');
                if (nl !== -1) code = code.slice(nl + 1);
                out += '<pre><code>' + esc(code) + '</code></pre>';
            } else {
                out += textBlocks(parts[i]);
            }
        }
        return out;
    }

    global.renderMarkdown = renderMarkdown;
})(window);