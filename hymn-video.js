// Keep each response tied to the selection that requested it.
export function createHymnVideoLink(link, {
    fetchVideo = (...args) => fetch(...args),
    isOnline = () => navigator.onLine,
    hostname = window.location.hostname,
} = {}) {
    let selection = 0;
    let timer;
    let request;
    let currentHymn;

    function hide() {
        link.classList.remove('show');
        link.removeAttribute('href');
    }

    function select(hymnNumber, edition, delay = 0) {
        currentHymn = { hymnNumber, edition };
        const version = ++selection;
        clearTimeout(timer);
        request?.abort();
        hide();
        if (!hymnNumber || !isOnline()) return;

        timer = setTimeout(async () => {
            request = new AbortController();
            const base = ['localhost', '127.0.0.1'].includes(hostname)
                ? 'https://us-central1-shige-app-2022.cloudfunctions.net/getHymnYoutube'
                : '/api/getHymnYoutube';
            const query = new URLSearchParams({ hymnNumber, edition });
            try {
                const response = await fetchVideo(`${base}?${query}`, { signal: request.signal });
                if (!response.ok) return;
                const data = await response.json();
                if (version !== selection || !isOnline() || !data.success || !data.youtubeUrl) return;
                const url = new URL(data.youtubeUrl);
                if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' ||
                    url.username || url.password || url.port || url.pathname !== '/watch' ||
                    !/^[\w-]{11}$/.test(url.searchParams.get('v') || '')) return;
                link.href = url.href;
                link.classList.add('show');
            } catch (error) {
                if (error.name !== 'AbortError') console.warn('Unable to load hymn video:', error);
            }
        }, delay);
    }

    return {
        select,
        refresh() {
            if (currentHymn) select(currentHymn.hymnNumber, currentHymn.edition);
        },
    };
}
