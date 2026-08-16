/**
 * Small request lifecycle primitive for pages that can be reloaded while a
 * previous request is still in flight. A page only commits results for its
 * latest request token, preventing stale responses from overwriting the UI.
 */
export function createPageRequestController() {
    let requestId = 0;

    return {
        next() {
            requestId += 1;
            return requestId;
        },
        isCurrent(candidate) {
            return candidate === requestId;
        },
        get current() {
            return requestId;
        }
    };
}
