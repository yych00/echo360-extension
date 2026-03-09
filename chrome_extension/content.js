// 默认配置
const FALLBACK_DEFAULT_CONFIG = {
    ccTargetLang: 'zh-CN',
    ccFontSize: 22,
    ccEnglishFontSize: 20,
    ccTranslateColor: '#ffffff',
    ccEnglishColor: '#ffffff',
    ccBgOpacity: 0.6
};
let DEFAULT_CONFIG = { ...FALLBACK_DEFAULT_CONFIG };

async function loadDefaultConfig() {
    try {
        const response = await fetch(chrome.runtime.getURL('defaults.json'));
        if (!response.ok) {
            throw new Error(`Failed to load defaults.json: ${response.status}`);
        }

        const defaults = await response.json();
        DEFAULT_CONFIG = {
            ...FALLBACK_DEFAULT_CONFIG,
            ...(defaults || {})
        };
    } catch (error) {
        DEFAULT_CONFIG = { ...FALLBACK_DEFAULT_CONFIG };
        console.warn('[Echo360 CC] Failed to load defaults.json in content script, using fallback defaults.', error);
    }

    return DEFAULT_CONFIG;
}

function syncConfigToPage(config) {
    injectConfigToPage(config);
    document.documentElement.setAttribute(
        'data-echo360-cc-config',
        JSON.stringify(config)
    );
}

function injectConfigToPage(config) {
    const configScript = document.createElement('script');
    configScript.textContent = `
        window.__ECHO360_CC_CONFIG__ = ${JSON.stringify(config)};
        window.dispatchEvent(new CustomEvent('echo360-cc-config-updated', {
            detail: window.__ECHO360_CC_CONFIG__
        }));
    `;
    (document.head || document.documentElement).appendChild(configScript);
    configScript.remove();
}

// 监听来自 options 页面的配置变更消息，并立即写入 DOM 属性供 inject.js 读取
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CONFIG_CHANGED' && msg.config) {
        syncConfigToPage(msg.config);
    }
});

// 监听从网站里的 inject.js 传出来的进度消息并向外透传给插件 options
window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.source === 'echo360-cc-inject') {
        if (event.data.type === 'PROGRESS_UPDATE') {
            try {
                chrome.runtime.sendMessage(event.data, () => {
                    void chrome.runtime.lastError;
                });
            } catch (e) { }
        }

        if (event.data.type === 'TRANSCRIPT_EXPORT_UPDATE' && event.data.payload) {
            const exportPayload = {
                ...event.data.payload,
                capturedAt: new Date().toISOString()
            };

            chrome.storage.local.set({ echo360TranscriptExport: exportPayload }, () => {
                try {
                    chrome.runtime.sendMessage({
                        type: 'TRANSCRIPT_EXPORT_UPDATED',
                        payload: {
                            title: exportPayload.title,
                            cueCount: exportPayload.cues?.length || 0,
                            translatedCount: exportPayload.translatedCount || 0,
                            isTranslationComplete: !!exportPayload.isTranslationComplete
                        }
                    }, () => {
                        void chrome.runtime.lastError;
                    });
                } catch (e) { }
            });
        }
    }
});

loadDefaultConfig().finally(() => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
        // 1. 将配置作为全局变量打入主页面的 Window 环境中
        syncConfigToPage(items);

        // 2. 将真正的请求拦截和渲染引擎注入
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject.js');
        script.onload = function () {
            this.remove(); // 加载完后把标签移掉以保持 DOM 干净
        };
        (document.head || document.documentElement).appendChild(script);
    });
});

// 监听配置变化并实时打入页面 (实现免刷新应用设置)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
        chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
            // 通过 DOM 属性传递配置到 page world (content script 与页面共享 DOM，不受 CSP 限制)
            syncConfigToPage(items);
        });
    }
});

// 兜底机制：每 2 秒主动轮询 chrome.storage，确保配置一定能同步到 DOM 属性
// 不依赖任何事件，即使 onChanged / onMessage 在跨域 iframe 中不触发也能生效
setInterval(() => {
    try {
        chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
            if (chrome.runtime.lastError) return;
            syncConfigToPage(items);
        });
    } catch (e) {
        // 扩展上下文已失效 (页面没刷新但扩展被重载)，停止轮询
    }
}, 2000);
