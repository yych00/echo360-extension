/**
 * @author yuchenyang
 * @description Echo360 CC 字幕助手 Background Service Worker
 */

const ALLOWED_LANGS = new Set([
    'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'ar',
    'hi', 'vi', 'th', 'id', 'ms', 'it', 'nl', 'pl', 'tr', 'uk', 'en'
]);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRY_ATTEMPTS = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function sanitizeLang(lang) {
    return ALLOWED_LANGS.has(lang) ? lang : 'zh-CN';
}

function createTranslationError(message, options = {}) {
    const error = new Error(message);
    error.code = options.code || 'TRANSLATE_UNKNOWN_ERROR';
    error.category = options.category || 'unknown';
    error.status = options.status || 0;
    error.retryable = !!options.retryable;
    return error;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRetryDelay(attempt) {
    return 400 * attempt;
}

function classifyHttpError(status) {
    const retryable = RETRYABLE_STATUS_CODES.has(status);

    if (status === 429) {
        return createTranslationError('翻译服务限流，请稍后重试。', {
            code: 'TRANSLATE_RATE_LIMITED',
            category: 'rate-limit',
            status,
            retryable: true
        });
    }

    if (status >= 500) {
        return createTranslationError(`翻译服务暂时不可用 (${status})。`, {
            code: 'TRANSLATE_SERVER_ERROR',
            category: 'server',
            status,
            retryable: true
        });
    }

    if (status === 408) {
        return createTranslationError('翻译请求超时，请稍后重试。', {
            code: 'TRANSLATE_REQUEST_TIMEOUT',
            category: 'timeout',
            status,
            retryable: true
        });
    }

    if (status >= 400) {
        return createTranslationError(`翻译请求被拒绝 (${status})。`, {
            code: 'TRANSLATE_BAD_RESPONSE',
            category: 'http',
            status,
            retryable
        });
    }

    return createTranslationError(`翻译请求失败 (${status || 'unknown'})。`, {
        code: 'TRANSLATE_HTTP_ERROR',
        category: 'http',
        status,
        retryable
    });
}

async function fetchTranslation(text, targetLang, attempt = 1) {
    const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${sanitizeLang(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(gtUrl, { signal: controller.signal });

        if (!response.ok) {
            throw classifyHttpError(response.status);
        }

        return response.json();
    } catch (error) {
        let normalizedError = error;

        if (error?.name === 'AbortError') {
            normalizedError = createTranslationError('翻译请求超时，请检查网络后重试。', {
                code: 'TRANSLATE_TIMEOUT',
                category: 'timeout',
                retryable: true
            });
        } else if (!(error instanceof Error)) {
            normalizedError = createTranslationError(String(error), {
                code: 'TRANSLATE_UNKNOWN_ERROR',
                category: 'unknown',
                retryable: false
            });
        } else if (!error.code) {
            normalizedError = createTranslationError('翻译网络请求失败，请检查连接后重试。', {
                code: 'TRANSLATE_NETWORK_ERROR',
                category: 'network',
                retryable: true
            });
        }

        if (normalizedError.retryable && attempt <= MAX_RETRY_ATTEMPTS) {
            await delay(buildRetryDelay(attempt));
            return fetchTranslation(text, targetLang, attempt + 1);
        }

        throw normalizedError;
    } finally {
        clearTimeout(timeoutId);
    }
}

function extractTranslatedText(data) {
    if (!data || !Array.isArray(data[0])) {
        throw createTranslationError('翻译返回格式异常。', {
            code: 'TRANSLATE_INVALID_PAYLOAD',
            category: 'payload',
            retryable: false
        });
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
                throw createTranslationError('批量翻译请求参数无效。', {
                    code: 'TRANSLATE_INVALID_BATCH_REQUEST',
                    category: 'request',
                    retryable: false
                });
            }

            const requestText = texts.join(separator);
            const data = await fetchTranslation(requestText, message.payload?.targetLang);
            const translatedText = extractTranslatedText(data);
            const translatedTexts = translatedText.split(separator);

            if (translatedTexts.length !== texts.length) {
                throw createTranslationError(`批量翻译返回条数异常，期望 ${texts.length} 条，实际 ${translatedTexts.length} 条。`, {
                    code: 'TRANSLATE_BATCH_MISMATCH',
                    category: 'payload',
                    retryable: false
                });
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
                error: error instanceof Error ? error.message : String(error),
                errorCode: error?.code || 'TRANSLATE_UNKNOWN_ERROR',
                errorCategory: error?.category || 'unknown',
                retryable: !!error?.retryable,
                status: error?.status || 0
            });
        }
    })();

    return true;
});