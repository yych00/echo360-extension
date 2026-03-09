// 这个脚本运行在 extension 沙盒里 (Isolated World)
// 因为沙盒里的 fetch/xhr 和页面的不互通，我们需要把拦截代码直接注入到页面的主环境 (Main World) 中。

// 默认配置
const DEFAULT_CONFIG = {
    ccTargetLang: 'zh-CN',
    ccFontSize: 24,
    ccEnglishFontSize: 20,
    ccTranslateColor: '#ffffff',
    ccEnglishColor: '#ffffff'
};

chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
    // 1. 将配置作为全局变量打入主页面的 Window 环境中
    const configScript = document.createElement('script');
    configScript.textContent = `window.__ECHO360_CC_CONFIG__ = ${JSON.stringify(items)};`;
    (document.head || document.documentElement).appendChild(configScript);
    configScript.remove(); // 隐藏痕迹

    // 2. 将真正的请求拦截和渲染引擎注入
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function () {
        this.remove(); // 加载完后把标签移掉以保持 DOM 干净
    };
    (document.head || document.documentElement).appendChild(script);
});
