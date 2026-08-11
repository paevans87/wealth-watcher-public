let deferredInstallPrompt = null;

function isStandaloneDisplayMode() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function setupPwa() {
    const installButton = document.getElementById('install-app-btn');

    if ('serviceWorker' in navigator && (window.isSecureContext || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname))) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js', { scope: '/' })
                .catch(error => console.error('PWA service worker registration failed', error));
        }, { once: true });
    }

    if (!installButton || isStandaloneDisplayMode()) return;

    window.addEventListener('beforeinstallprompt', event => {
        // Intentionally defer the browser prompt until the user clicks Install.
        // Calling preventDefault here is the standards-compliant way to keep
        // beforeinstallprompt from opening automatically.
        event.preventDefault();
        deferredInstallPrompt = event;
        installButton.hidden = false;
    });

    installButton.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;

        installButton.disabled = true;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        installButton.hidden = true;
        installButton.disabled = false;
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        installButton.hidden = true;
    });
}
