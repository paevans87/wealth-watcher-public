import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const demoHtmlArgumentIndex = process.argv.indexOf('--demo-html');
const demoHtmlPath = demoHtmlArgumentIndex >= 0
    ? path.resolve(process.cwd(), process.argv[demoHtmlArgumentIndex + 1])
    : path.join(repositoryRoot, 'WealthWatcher.UI', 'dist', 'index.html');

async function read(relativePath) {
    return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

function requireMatch(label, value, pattern) {
    assert.match(value, pattern, `${label} is missing ${pattern}`);
}

const landing = await read('github_pages/index.html');
const robots = await read('github_pages/robots.txt');
const sitemap = await read('github_pages/sitemap.xml');
const socialImage = await read('github_pages/og-image.svg');
const analytics = await read('github_pages/analytics.js');
const demoSource = await read('WealthWatcher.UI/index.html');
const viteConfig = await read('WealthWatcher.UI/vite.config.js');

requireMatch('landing title', landing, /<title>WealthWatcher/);
requireMatch('landing description', landing, /<meta name="description" content="[^"]+">/);
requireMatch('landing robots policy', landing, /<meta name="robots" content="index, follow">/);
requireMatch('landing canonical', landing, /<link rel="canonical" href="https:\/\/wealthwatcher\.co\.uk\/">/);
requireMatch('landing Open Graph metadata', landing, /property="og:type"/);
requireMatch('landing Twitter metadata', landing, /name="twitter:card"/);
requireMatch('landing structured data', landing, /"@type": "SoftwareApplication"/);
assert.ok((landing.match(/data-analytics-event="landing_cta_click"/g) || []).length >= 5, 'landing CTA instrumentation is incomplete');
assert.ok((landing.match(/href="demo\/"/g) || []).length >= 5, 'landing demo links are incomplete');

requireMatch('robots sitemap directive', robots, /^Sitemap: https:\/\/wealthwatcher\.co\.uk\/sitemap\.xml$/m);
requireMatch('sitemap landing URL', sitemap, /<loc>https:\/\/wealthwatcher\.co\.uk\/<\/loc>/);
requireMatch('social image title', socialImage, /WealthWatcher - see your whole financial picture/);

requireMatch('analytics event API', analytics, /window\.wealthWatcherTrack = trackEvent/);
requireMatch('analytics consent gate', analytics, /if \(\(!projectId && !measurementId\) \|\| !consentBanner/);
requireMatch('analytics scroll milestones', analytics, /scroll_milestone/);
assert.doesNotMatch(analytics, /localStorage\.getItem\([^)]*financial|dataLayer\.push\([^)]*asset/i, 'analytics code must not read or send financial data');

requireMatch('demo metadata marker', demoSource, /VITE_DEMO_METADATA/);
requireMatch('demo analytics marker', demoSource, /VITE_DEMO_ANALYTICS/);
requireMatch('demo consent controls', demoSource, /id="analytics-consent-accept"/);
requireMatch('demo action instrumentation', demoSource, /data-analytics-event="demo_action"/);
requireMatch('demo-only metadata transform', viteConfig, /noindex, follow/);
requireMatch('demo analytics scripts', viteConfig, /\.\.\/analytics\.js/);

try {
    const demoHtml = await readFile(demoHtmlPath, 'utf8');
    if (demoHtmlArgumentIndex < 0 && !demoHtml.includes('data-demo-mode="true"')) {
        console.log('Normal UI build detected; built demo checks are reserved for the Pages artifact.');
    } else {
    requireMatch('built demo mode', demoHtml, /data-demo-mode="true"/);
    requireMatch('built demo title', demoHtml, /<title>WealthWatcher live demo - explore the dashboard<\/title>/);
    requireMatch('built demo description', demoHtml, /Explore WealthWatcher with fictional data in your browser/);
    requireMatch('built demo robots policy', demoHtml, /<meta name="robots" content="noindex, follow">/);
    requireMatch('built demo canonical', demoHtml, /<link rel="canonical" href="https:\/\/wealthwatcher\.co\.uk\/">/);
    requireMatch('built demo analytics loader', demoHtml, /\.\.\/analytics\.js/);
    assert.equal((demoHtml.match(/<title>/g) || []).length, 1, 'built demo must contain exactly one title element');
    assert.doesNotMatch(demoHtml, /VITE_DEMO_METADATA|VITE_DEMO_ANALYTICS/, 'build markers must not leak into the demo artifact');
    }
} catch (error) {
    if (error.code !== 'ENOENT' || demoHtmlArgumentIndex >= 0) throw error;
    console.log('Built demo not present; source and transform checks passed.');
}

console.log('Public-site SEO, crawl, metadata, consent, and measurement checks passed.');
