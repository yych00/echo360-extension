/**
 * @author yuchenyang
 * @description Echo360 CC 字幕助手 Background Service Worker
 */

const ALLOWED_LANGS = new Set([
    'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'ar',
    'hi', 'vi', 'th', 'id', 'ms', 'it', 'nl', 'pl', 'tr', 'uk', 'en'
]);

function sanitizeLang(lang) {
    return ALLOWED_LANGS.has(lang) ? lang : 'zh-CN';
}

async function fetchTranslation(text, targetLang) {
    const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${sanitizeLang(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(gtUrl);

    if (!response.ok) {
        throw new Error(`Translate request failed: ${response.status}`);
    }

    return response.json();
}

function extractTranslatedText(data) {
    if (!data || !Array.isArray(data[0])) {
        throw new Error('Unexpected translation response payload.');
    }

    return data[0]
        .map((item) => item?.[0] || '')
        .join('');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || (message.type !== 'TRANSLATE_TEXT' && message.type !== 'TRANSLATE_TEXT_BATCH')) {
        return;
    }

    (async () => {
        try {
            if (message.type === 'TRANSLATE_TEXT') {
                const text = String(message.payload?.text || '');
                const targetLang = message.payload?.targetLang;
                const data = await fetchTranslation(text, targetLang);
                sendResponse({
                    success: true,
                    payload: {
                        translatedText: extractTranslatedText(data)
                    }
                });
                return;
            }

            const texts = Array.isArray(message.payload?.texts) ? message.payload.texts.map((item) => String(item || '')) : [];
            const separator = String(message.payload?.separator || '');
            if (texts.length === 0 || !separator) {
                throw new Error('Invalid batch translation payload.');
            }

            const requestText = texts.join(separator);
            const data = await fetchTranslation(requestText, message.payload?.targetLang);
            const translatedText = extractTranslatedText(data);
            const translatedTexts = translatedText.split(separator);

            if (translatedTexts.length !== texts.length) {
                throw new Error(`Batch translation split mismatch: expected ${texts.length}, got ${translatedTexts.length}`);
            }

            sendResponse({
                success: true,
                payload: {
                    translatedTexts
                }
            });
        } catch (error) {
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    })();

    return true;
});