import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml, safeCssColor } from './html.js';

test('escapeHtml encodes every HTML-sensitive character', () => {
    assert.equal(
        escapeHtml(`<script>alert("x")</script> & 'quoted'`),
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;'
    );
});

test('safeCssColor only allows hexadecimal colors', () => {
    assert.equal(safeCssColor('#abc'), '#aabbcc');
    assert.equal(safeCssColor('#12AbEf'), '#12AbEf');
    assert.equal(safeCssColor('red; background: url(javascript:alert(1))'), '#64748b');
    assert.equal(safeCssColor(''), '#64748b');
});
