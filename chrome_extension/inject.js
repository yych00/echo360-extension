/**
 * @author yuchenyang
 * @description Echo360 CC 字幕助手 Inject Script
 */
(function () {
    'use strict';

    console.log("[Echo360 CC Plugin] Injection script loaded and listening for subtitle API...");

    let transcriptData = null;
    let subtitleInjected = false;
    const BASE_CONFIG = {
        ccEnableSubtitles: true,
        ccTargetLang: 'zh-CN',
        ccFontSize: 22,
        ccEnglishFontSize: 20,
        ccTranslateColor: '#ffffff',
        ccEnglishColor: '#ffffff',
        ccBgOpacity: 0.6,
        ccShowChinese: true,
        ccShowEnglish: true
    };
    let activeConfig = {
        ...BASE_CONFIG,
        ...(window.__ECHO360_CC_CONFIG__ || {})
    };
    const TRANSLATION_BATCH_SIZE = 8;
    const FORWARD_PRIORITY_RANGE = 18;
    const BACKWARD_PRIORITY_RANGE = 6;
    const PRELOAD_AHEAD_COUNT = 2;
    const TRANSLATION_COOLDOWN_MS = 100;
    const translationState = {
        runId: 0,
        cues: null,
        focusIndex: -1,
        processing: false,
        targetLang: 'zh-CN'
    };

    // ========= 兼容性极强的数据解析引擎 =========
    function parseVTT(vttStr) {
        const lines = vttStr.split(/\r?\n/);
        const cues = [];
        let i = 0;
        while (i < lines.length) {
            if (lines[i].includes('-->')) {
                const timeMatch = lines[i].split('-->');
                const parseTime = (str) => {
                    const parts = str.trim().split(':');
                    let sec = 0;
                    if (parts.length === 3) sec = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
                    else if (parts.length === 2) sec = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
                    return sec * 1000;
                };
                try {
                    let start = parseTime(timeMatch[0]);
                    let end = parseTime(timeMatch[1]);
                    i++;
                    let text = "";
                    while (i < lines.length && lines[i].trim() !== "") {
                        text += lines[i] + "\n";
                        i++;
                    }
                    cues.push({ start, end, text: text.trim().replace(/<[^>]+>/g, '') });
                } catch (e) { i++; }
            } else {
                i++;
            }
        }
        return cues;
    }

    function extractCuesFromPayload(data) {
        if (typeof data === 'string' && data.trim().startsWith('WEBVTT')) {
            return parseVTT(data);
        }

        let rawCues = [];
        if (Array.isArray(data)) rawCues = data;
        else if (data && data.data && Array.isArray(data.data)) rawCues = data.data;
        else if (data && data.cues && Array.isArray(data.cues)) rawCues = data.cues;
        else if (data && data.data && data.data.contentJSON && Array.isArray(data.data.contentJSON.cues)) {
            // Echo360 真实最新接口防线结构
            rawCues = data.data.contentJSON.cues;
        }
        else if (data && typeof data === 'object') {
            for (let key in data) {
                if (Array.isArray(data[key])) { rawCues = data[key]; break; }
            }
        }

        return rawCues.map(c => {
            let start = c.start ?? c.startTime ?? c.startMs ?? c.begin ?? 0;
            let end = c.end ?? c.endTime ?? c.endMs ?? 0;
            let text = c.text ?? c.content ?? c.words ?? c.transcript ?? "";

            // 如果数据是以秒为单位，转为毫秒
            if (start > 0 && start < 150000 && String(start).includes('.')) {
                start = Math.floor(start * 1000);
                end = Math.floor(end * 1000);
            }
            return { start, end, text };
        });
    }

    // ========= 字幕上下文智能合并引擎 (解决碎句不断闪烁的问题) =========
    function mergeSentences(cues) {
        if (!cues || cues.length === 0) return [];
        let merged = [];
        let currentCue = null;

        for (let i = 0; i < cues.length; i++) {
            let cue = cues[i];

            if (!cue.text || cue.text.trim() === "") continue;

            if (!currentCue) {
                currentCue = { start: cue.start, end: cue.end, text: cue.text.trim() };
            } else {
                // 如果没有遇到句末符号，就把新字幕连在后面，并拉伸结束时间到当前这一拍
                currentCue.text += " " + cue.text.trim();
                currentCue.end = cue.end;
            }

            let text = currentCue.text;
            // 判断英文结尾有无句号问号等，或是中文句号结尾
            let isEndOfSentence = /[.?!。？！]\s*$/.test(text) || /[.?!。？！]["']\s*$/.test(text);

            let isGapTooLarge = false;
            // 如果两句话直接老师停顿超过 1.5 秒，也强制断开，防止黏连在一大片中
            if (i < cues.length - 1 && (cues[i + 1].start - cue.end > 1500)) {
                isGapTooLarge = true;
            }

            if (isEndOfSentence || isGapTooLarge || i === cues.length - 1) {
                currentCue.text = currentCue.text.replace(/\s+/g, ' ').trim();
                merged.push(currentCue);
                currentCue = null;
            }
        }

        console.log(`[Echo360 CC Plugin] Sentence Engine: Combined ${cues.length} fragments into ${merged.length} coherent sentences.`);
        return merged;
    }

    function sendProgress(percent, msg) {
        window.postMessage({ source: 'echo360-cc-inject', type: 'PROGRESS_UPDATE', percent, msg }, '*');
    }

    function normalizeTitleText(text) {
        return (text || '')
            .replace(/\s+/g, ' ')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .trim();
    }

    function collectTextsFromSelectors(selectors) {
        const values = [];
        const seen = new Set();

        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(node => {
                const text = normalizeTitleText(node.textContent);
                if (!text || text.length < 4 || seen.has(text)) return;
                seen.add(text);
                values.push(text);
            });
        });

        return values;
    }

    function cleanDocumentTitle(rawTitle) {
        const cleaned = normalizeTitleText(rawTitle)
            .replace(/\s*[|·-]\s*Echo360.*$/i, '')
            .replace(/\s*[|·]\s*Canvas.*$/i, '')
            .trim();

        return cleaned || 'echo360-subtitles';
    }

    function extractExportTitle() {
        const breadcrumbTexts = collectTextsFromSelectors([
            'nav[aria-label*="breadcrumb" i] a',
            'nav[aria-label*="breadcrumb" i] span',
            '[class*="breadcrumb"] a',
            '[class*="breadcrumb"] span'
        ]).filter(text => !/home|dashboard|courses/i.test(text));

        const primaryTitle = normalizeTitleText(
            document.querySelector('h1')?.textContent ||
            document.querySelector('[data-testid*="title" i]')?.textContent ||
            document.querySelector('[class*="title" i]')?.textContent ||
            document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
            ''
        );

        const secondaryCandidates = collectTextsFromSelectors([
            '[data-testid*="subtitle" i]',
            '[data-testid*="section" i]',
            '[class*="subtitle" i]',
            '[class*="section" i]',
            '[class*="course" i]'
        ]).filter(text => text !== primaryTitle && !text.includes(primaryTitle));

        let finalTitle = '';

        if (breadcrumbTexts.length >= 2) {
            const tail = breadcrumbTexts.slice(-2);
            finalTitle = `${tail[0]} / ${tail[1]}`;
        } else if (primaryTitle && secondaryCandidates.length > 0) {
            finalTitle = `${primaryTitle} / ${secondaryCandidates[0]}`;
        } else if (primaryTitle) {
            finalTitle = primaryTitle;
        } else {
            finalTitle = cleanDocumentTitle(document.title);
        }

        const dateCandidates = collectTextsFromSelectors([
            'time',
            '[data-testid*="date" i]',
            '[class*="date" i]',
            '[data-testid*="time" i]'
        ]).filter(text => text && !finalTitle.includes(text) && text.length > 4 && text.length < 30 && (/\d/.test(text)));

        if (dateCandidates.length > 0) {
            finalTitle += ` - ${dateCandidates[0]}`;
        }

        return finalTitle;
    }

    function buildTranscriptExportPayload() {
        if (!transcriptData || transcriptData.length === 0) return null;

        const targetLang = getTargetLang();
        const cues = transcriptData.map(cue => ({
            start: cue.start,
            end: cue.end,
            text: cue.text || '',
            zhText: cue.zhText || ''
        }));
        const translatedCount = cues.filter(cue => cue.zhText && cue.zhText.trim() !== '').length;

        return {
            title: extractExportTitle(),
            pageUrl: location.href,
            targetLang,
            cueCount: cues.length,
            translatedCount,
            isTranslationComplete: translatedCount === cues.length,
            cues
        };
    }

    function broadcastTranscriptExport() {
        const payload = buildTranscriptExportPayload();
        if (!payload) return;

        window.postMessage({
            source: 'echo360-cc-inject',
            type: 'TRANSCRIPT_EXPORT_UPDATE',
            payload
        }, '*');
    }

    function getTargetLang() {
        const config = activeConfig || window.__ECHO360_CC_CONFIG__ || { ccTargetLang: 'zh-CN' };
        return config.ccTargetLang || 'zh-CN';
    }

    function renderOverlaySubtitle(overlay, cue, config) {
        if (!overlay) return;

        if (!cue || !cue.text) {
            overlay.style.display = 'none';
            overlay.replaceChildren();
            return;
        }

        const showEn = config.ccShowEnglish !== false;
        const showZh = config.ccShowChinese !== false;

        // 中英文均不显示时，直接隐藏 overlay
        if (!showEn && !showZh) {
            overlay.style.display = 'none';
            overlay.replaceChildren();
            return;
        }

        const zhTextRaw = cue.zhText || cue._tempDisplay || '排队翻译中...';
        const enColor = config.ccEnglishColor || '#ffffff';
        const zhColor = config.ccTranslateColor || '#ffffff';
        const enFontSize = config.ccEnglishFontSize || 20;
        const zhFontSize = config.ccFontSize || 22;
        const makeSubtitleLine = (role, text, styleMap) => {
            const line = document.createElement('div');
            line.dataset.echo360Role = role;
            line.textContent = text;
            Object.assign(line.style, {
                width: '100%',
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word'
            }, styleMap);
            return line;
        };

        const subtitleNodes = [];

        if (showEn) {
            subtitleNodes.push(makeSubtitleLine('en', cue.text, {
                fontSize: `${enFontSize}px`,
                opacity: '0.9',
                color: enColor
            }));
        }

        if (showZh) {
            subtitleNodes.push(makeSubtitleLine('zh', zhTextRaw, {
                fontSize: `${zhFontSize}px`,
                color: zhColor,
                fontWeight: 'bold',
                fontFamily: 'Microsoft YaHei, sans-serif'
            }));
        }

        overlay.replaceChildren(...subtitleNodes);
        overlay.style.display = 'block';
    }

    function applyConfigImmediately(nextConfig) {
        activeConfig = {
            ...BASE_CONFIG,
            ...(nextConfig || {})
        };
        window.__ECHO360_CC_CONFIG__ = activeConfig;

        const overlay = document.getElementById('echo360-cc-overlay');
        if (overlay) {
            const bgOp = activeConfig.ccBgOpacity !== undefined ? activeConfig.ccBgOpacity : 0.6;
            overlay.style.setProperty('background', `rgba(0, 0, 0, ${bgOp})`, 'important');
            overlay.style.setProperty('box-shadow', bgOp === 0 ? 'none' : '0 4px 6px rgba(0,0,0,0.3)', 'important');

            if (transcriptData && transcriptData.length > 0) {
                const currentTimeMs = getCurrentPlaybackTimeMs();
                const activeIndex = getActiveCueIndexByTime(transcriptData, currentTimeMs);
                const activeCue = activeIndex >= 0 ? transcriptData[activeIndex] : null;
                renderOverlaySubtitle(overlay, activeCue, activeConfig);
            }
        }

        if (transcriptData && activeConfig.ccTargetLang && window._LAST_CC_LANG !== activeConfig.ccTargetLang) {
            const currentTimeMs = getCurrentPlaybackTimeMs();
            console.log(`[Echo360 CC] Immediate config apply: language changed from ${window._LAST_CC_LANG} to ${activeConfig.ccTargetLang}.`);
            transcriptData.forEach(cue => {
                delete cue.zhText;
                delete cue._tempDisplay;
                delete cue._isTranslating;
            });
            broadcastTranscriptExport();
            window._LAST_CC_LANG = activeConfig.ccTargetLang;
            translationState.runId += 1;
            translationState.cues = transcriptData;
            translationState.targetLang = activeConfig.ccTargetLang;
            translationState.focusIndex = getCueIndexByTime(transcriptData, currentTimeMs);
            queueFocusedTranslation(transcriptData, translationState.focusIndex);
        }
    }

    window.addEventListener('echo360-cc-config-updated', (event) => {
        applyConfigImmediately(event.detail || {});
    });

    // 轮询 DOM 属性获取配置更新 (content script 写 DOM 属性，page world 读 DOM 属性，100% 可靠)
    let _lastSeenConfigAttr = '';
    setInterval(() => {
        try {
            const raw = document.documentElement.getAttribute('data-echo360-cc-config');
            if (raw && raw !== _lastSeenConfigAttr) {
                _lastSeenConfigAttr = raw;
                const config = JSON.parse(raw);
                console.log('[Echo360 CC] Config update detected via DOM polling:', config);
                applyConfigImmediately(config);
            }
        } catch (e) { }
    }, 500);

    function getCueIndexByTime(cues, currentTimeMs) {
        if (!cues || cues.length === 0) return -1;

        for (let i = 0; i < cues.length; i++) {
            const cue = cues[i];
            if (currentTimeMs >= cue.start && currentTimeMs <= cue.end) {
                return i;
            }
            if (cue.start > currentTimeMs) {
                return i;
            }
        }

        return cues.length - 1;
    }

    function getActiveCueIndexByTime(cues, currentTimeMs) {
        if (!cues || cues.length === 0) return -1;

        for (let i = 0; i < cues.length; i++) {
            const cue = cues[i];
            if (currentTimeMs >= cue.start && currentTimeMs <= cue.end) {
                return i;
            }
        }

        return -1;
    }

    function getCurrentPlaybackTimeMs() {
        const videos = findAllVideos(document);
        if (!videos || videos.length === 0) return 0;

        const targetVideo = videos.find(v => !v.paused && v.currentTime > 0) || videos[0];
        return targetVideo ? targetVideo.currentTime * 1000 : 0;
    }

    function hasMissingTranslationsAroundIndex(cues, centerIndex, aheadCount) {
        if (!cues || cues.length === 0 || centerIndex < 0) return false;

        const lastIndex = Math.min(cues.length - 1, centerIndex + aheadCount);
        for (let i = centerIndex; i <= lastIndex; i++) {
            const cue = cues[i];
            if (cue && cue.text && cue.zhText === undefined && !cue._isTranslating) {
                return true;
            }
        }

        return false;
    }

    async function translateCue(cue, targetLang) {
        if (!cue || !cue.text || cue.zhText !== undefined || cue._isTranslating) return false;

        cue._isTranslating = true;
        try {
            const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(cue.text)}`;
            const res = await fetch(gtUrl);
            const data = await res.json();

            let transText = '';
            if (data && data[0]) {
                data[0].forEach(t => {
                    if (t[0]) transText += t[0];
                });
            }

            cue.zhText = transText || '[翻译为空]';
            delete cue._tempDisplay;
            return true;
        } catch (e) {
            console.error('[Echo360 CC Plugin] Translate failed for cue:', cue.text, e);
            cue.zhText = '[网络限制]';
            return false;
        } finally {
            cue._isTranslating = false;
        }
    }

    function buildPriorityIndexes(cues, focusIndex) {
        const orderedIndexes = [];
        const seenIndexes = new Set();

        const pushIndex = (index) => {
            if (index < 0 || index >= cues.length || seenIndexes.has(index)) return;
            seenIndexes.add(index);
            orderedIndexes.push(index);
        };

        const pushRange = (start, end) => {
            for (let i = start; i <= end; i++) {
                pushIndex(i);
            }
        };

        if (focusIndex >= 0) {
            pushIndex(focusIndex);
            pushRange(focusIndex + 1, Math.min(cues.length - 1, focusIndex + FORWARD_PRIORITY_RANGE));
            pushRange(Math.max(0, focusIndex - BACKWARD_PRIORITY_RANGE), focusIndex - 1);
            pushRange(focusIndex + FORWARD_PRIORITY_RANGE + 1, cues.length - 1);
            pushRange(0, Math.max(-1, focusIndex - BACKWARD_PRIORITY_RANGE - 1));
        } else {
            pushRange(0, cues.length - 1);
        }

        return orderedIndexes;
    }

    function pickNextBatch(cues, focusIndex, batchSize) {
        const batch = [];
        const orderedIndexes = buildPriorityIndexes(cues, focusIndex);

        for (const index of orderedIndexes) {
            const cue = cues[index];
            if (!cue || !cue.text || cue.zhText !== undefined || cue._isTranslating) continue;
            batch.push(cue);
            if (batch.length >= batchSize) break;
        }

        return batch;
    }

    async function processTranslationQueue(runId) {
        if (translationState.processing) return;
        translationState.processing = true;

        try {
            while (runId === translationState.runId && translationState.cues && translationState.cues.length > 0) {
                const cues = translationState.cues;
                const batch = pickNextBatch(cues, translationState.focusIndex, TRANSLATION_BATCH_SIZE);

                if (batch.length === 0) {
                    sendProgress(100, '✅ 当前课程字幕已完成优先翻译');
                    console.log('[Echo360 CC Plugin] Priority translation queue drained.');
                    break;
                }

                await Promise.all(batch.map(cue => translateCue(cue, translationState.targetLang)));

                broadcastTranscriptExport();

                const translatedCount = cues.filter(cue => cue.zhText !== undefined).length;
                const percent = Math.min(100, Math.round((translatedCount / cues.length) * 100));
                const focusLabel = translationState.focusIndex >= 0 ? `第 ${translationState.focusIndex + 1} 句附近优先中` : '按顺序预加载中';
                sendProgress(percent, `🧠 ${focusLabel}，向后补齐字幕`);

                await new Promise(resolve => setTimeout(resolve, TRANSLATION_COOLDOWN_MS));
            }
        } finally {
            translationState.processing = false;
            if (runId !== translationState.runId && translationState.cues && translationState.cues.length > 0) {
                processTranslationQueue(translationState.runId);
            }
        }
    }

    function queueFocusedTranslation(cues, focusIndex) {
        if (!cues || cues.length === 0) return;

        const targetLang = getTargetLang();
        const isNewTask = translationState.cues !== cues || translationState.targetLang !== targetLang;

        if (isNewTask) {
            translationState.runId += 1;
            translationState.cues = cues;
            translationState.targetLang = targetLang;
            sendProgress(0, '🔄 翻译任务初始化...');
            console.log(`[Echo360 CC Plugin] Priority Translation Queue started for ${cues.length} sentences.`);
        }

        if (typeof focusIndex === 'number' && focusIndex >= 0) {
            translationState.focusIndex = focusIndex;
        } else if (isNewTask) {
            translationState.focusIndex = 0;
        }

        if (!translationState.processing) {
            processTranslationQueue(translationState.runId);
        }
    }

    // ============== 主动发现字幕 API 并自行请求（无需 hook 原生 API）==============

    // 已请求过的 URL 去重，防止重复处理
    const _fetchedTranscriptUrls = new Set();

    async function fetchTranscriptFromUrl(url) {
        if (_fetchedTranscriptUrls.has(url)) return;
        _fetchedTranscriptUrls.add(url);

        console.log('[Echo360 CC Plugin] Actively fetching transcript from:', url);
        try {
            // credentials: include 确保携带登录 Cookie，与页面原请求行为一致
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                console.warn('[Echo360 CC Plugin] Transcript fetch failed:', res.status);
                return;
            }

            const textData = await res.text();
            let parsedData = null;
            try { parsedData = JSON.parse(textData); }
            catch (e) { parsedData = textData; } // 可能是 VTT 格式

            const cues = extractCuesFromPayload(parsedData);
            if (cues && cues.length > 0) {
                console.log(`[Echo360 CC Plugin] Successfully fetched ${cues.length} subtitles!`);
                transcriptData = mergeSentences(cues);
                const initialFocusIndex = getCueIndexByTime(transcriptData, getCurrentPlaybackTimeMs());
                broadcastTranscriptExport();
                injectSubtitles();
                queueFocusedTranslation(transcriptData, initialFocusIndex);
            } else {
                console.error('[Echo360 CC Plugin] Parsed empty subtitles from:', url, textData.substring(0, 100));
            }
        } catch (e) {
            console.error('[Echo360 CC Plugin] Failed to fetch transcript:', url, e);
        }
    }

    // 检查页面已有的 performance 记录（适用于插件比 Echo360 晚加载的情况）
    function checkExistingPerformanceEntries() {
        performance.getEntries()
            .filter(e => e.name && e.name.includes('/transcript'))
            .forEach(e => fetchTranscriptFromUrl(e.name));
    }

    // 用 PerformanceObserver 监听未来的网络请求（echo360 播放时主动请求字幕接口）
    const _transcriptObserver = new PerformanceObserver((list) => {
        list.getEntries()
            .filter(e => e.name && e.name.includes('/transcript'))
            .forEach(e => fetchTranscriptFromUrl(e.name));
    });
    _transcriptObserver.observe({ entryTypes: ['resource'] });

    // 立即扫描已有记录
    checkExistingPerformanceEntries();

    // ==========================================
    // 核心引擎：定时器轮询模式 (终极防御覆盖和React重构)
    // ==========================================

    let overlayLoopInterval = null;

    // 递归查找视频及穿透 iframe / shadow DOM (全地图扫描)
    function findAllVideos(root, videos = []) {
        if (!root) return videos;
        try {
            const vids = root.querySelectorAll ? root.querySelectorAll('video') : [];
            vids.forEach(v => videos.push(v));

            const els = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (let i = 0; i < els.length; i++) {
                if (els[i].shadowRoot) {
                    findAllVideos(els[i].shadowRoot, videos);
                }
                if (els[i].tagName === 'IFRAME') {
                    try {
                        if (els[i].contentDocument) {
                            findAllVideos(els[i].contentDocument, videos);
                        }
                    } catch (e) { } // 忽略跨域 iframe 报错
                }
            }
        } catch (e) { }
        return videos;
    }

    function injectSubtitles() {
        if (!transcriptData) return;

        console.log(`[Echo360 CC Plugin] Subtitle data stored (${transcriptData.length} cues). Starting rendering engine...`);

        if (overlayLoopInterval) clearInterval(overlayLoopInterval);

        let debugTick = 0;

        // 每 100 毫秒高频轮询一次
        overlayLoopInterval = setInterval(() => {
            if (!transcriptData) return;
            debugTick++;

            // 每次循环直接从 DOM 属性读取最新配置 (content script 写入，page world 读取，100% 可靠)
            try {
                const rawAttr = document.documentElement.getAttribute('data-echo360-cc-config');
                if (rawAttr) {
                    const parsed = JSON.parse(rawAttr);
                    activeConfig = { ...BASE_CONFIG, ...parsed };
                    window.__ECHO360_CC_CONFIG__ = activeConfig;
                }
            } catch (e) { }

            const config = activeConfig || window.__ECHO360_CC_CONFIG__ || {};

            // 实时寻找页面上存活的 Video 标签
            const videos = findAllVideos(document);

            if (videos.length === 0) {
                if (debugTick % 30 === 0) console.log("[Echo360 CC Debug] 渲染引擎处于活跃状态，但没有在当前帧 (Frame) 或 Shadow DOM 中找到 <video> 节点。当前页面可能只是一个外层的 iframe。");
                return;
            }

            // 找一个正在播放的视频
            let targetVideo = videos.find(v => !v.paused && v.currentTime > 0) || videos[0];
            const currentTimeMs = targetVideo.currentTime * 1000;

            // 检查语言是否发生变更，如果变更了，清空翻译缓存触发重新翻译
            if (config.ccTargetLang && window._LAST_CC_LANG !== config.ccTargetLang) {
                console.log(`[Echo360 CC] Language changed from ${window._LAST_CC_LANG} to ${config.ccTargetLang}, flushing translations...`);
                transcriptData.forEach(cue => {
                    delete cue.zhText;
                    delete cue._tempDisplay;
                    delete cue._isTranslating;
                });
                broadcastTranscriptExport();
                window._LAST_CC_LANG = config.ccTargetLang;
                translationState.runId += 1;
                translationState.cues = transcriptData;
                translationState.targetLang = config.ccTargetLang;
                translationState.focusIndex = getCueIndexByTime(transcriptData, currentTimeMs);
                queueFocusedTranslation(transcriptData, translationState.focusIndex);
            }

            // 确保 overlay 长期存活
            let overlay = document.getElementById('echo360-cc-overlay');
            const bgOp = config.ccBgOpacity !== undefined ? config.ccBgOpacity : 0.6;

            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'echo360-cc-overlay';
                overlay.style.cssText = `
                    position: fixed; 
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    text-align: center; 
                    color: #ffffff; 
                    padding: 8px 18px; 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    border-radius: 6px; 
                    pointer-events: none; 
                    z-index: 2147483647; 
                    font-weight: 600; 
                    width: max-content;
                    max-width: min(80vw, calc(100vw - 24px));
                    white-space: normal;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                    line-height: 1.4;
                    text-shadow: 1px 1px 2px #000;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                    transform: translateX(-50%); /* 确保居中锚点永远是自身的水平中线 */
                    margin: 0;
                    box-sizing: border-box;
                `;
                document.body.appendChild(overlay);
                console.log("[Echo360 CC Debug] CC Overlay 元素已成功创建并附加到 body!");
            }

            // 响应最新的背景透明度设置
            overlay.style.setProperty('background', `rgba(0, 0, 0, ${bgOp})`, 'important');
            // 如果全透明，把阴影也隐去，显得更干净
            overlay.style.setProperty('box-shadow', bgOp === 0 ? 'none' : '0 4px 6px rgba(0,0,0,0.3)', 'important');

            // 全屏处理 & 动态对齐视频画面中心
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (fsEl) {
                if (!fsEl.contains(overlay)) {
                    fsEl.appendChild(overlay);
                }
                const fullscreenRect = fsEl.getBoundingClientRect();
                const fullscreenMaxWidth = Math.max(160, Math.floor(fullscreenRect.width - 24));
                overlay.style.position = 'absolute';
                overlay.style.left = '50%';
                overlay.style.bottom = '5%';
                overlay.style.maxWidth = fullscreenMaxWidth + 'px';
                overlay.style.transform = 'translateX(-50%)';
            } else {
                if (overlay.parentElement !== document.body) {
                    document.body.appendChild(overlay);
                }
                overlay.style.position = 'fixed';
                // 实时追踪真实视频节点的在屏幕上的方位角
                // 解决双屏 (Video1, Video2 并排) 问题：计算所有可见视频的联合大容器边界
                const visibleVideos = videos.filter(v => {
                    const r = v.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                });

                if (visibleVideos.length > 0) {
                    let minLeft = Infinity;
                    let maxRight = -Infinity;
                    let maxBottom = -Infinity;

                    // 遍历双轨/单轨所有实际显示的视频，画一个无形的大框把它们包起来
                    visibleVideos.forEach(v => {
                        const r = v.getBoundingClientRect();
                        if (r.left < minLeft) minLeft = r.left;
                        if (r.right > maxRight) maxRight = r.right;
                        if (r.bottom > maxBottom) maxBottom = r.bottom;
                    });

                    const combinedWidth = maxRight - minLeft;
                    const boundedWidth = Math.max(160, Math.floor(combinedWidth - 24));

                    // 设为所有视频框【联合大容器】的绝对水平中心点
                    overlay.style.left = (minLeft + combinedWidth / 2) + 'px';
                    // 距离屏幕底部的高度 = 视口高度 - 联合最深的底片高度 + 留出 15px 控制栏余量
                    const absoluteBottom = window.innerHeight - maxBottom + 15;
                    overlay.style.bottom = absoluteBottom + 'px';
                    overlay.style.maxWidth = boundedWidth + 'px';
                    overlay.style.transform = 'translateX(-50%)'; // 强行拉回字幕自身宽度的一半实现绝对居中
                }
            }

            // 更新文本内容
            if (config.ccEnableSubtitles === false) {
                renderOverlaySubtitle(overlay, null, config);
            } else {
                const currentTextIndex = getActiveCueIndexByTime(transcriptData, currentTimeMs);
                const currentTextObj = currentTextIndex >= 0 ? transcriptData[currentTextIndex] : null;

                if (debugTick % 30 === 0) {
                    console.log(`[Echo360 CC Debug] 状态存活 -> 视频数: ${videos.length} | 毫秒: ${Math.floor(currentTimeMs)} | 中文状态: ${currentTextObj?.zhText || '未翻译'} | 命中: ${currentTextObj?.text || "None"}`);
                }

                if (currentTextObj && currentTextObj.text) {
                    const shouldRefreshLookahead = hasMissingTranslationsAroundIndex(transcriptData, currentTextIndex, PRELOAD_AHEAD_COUNT);

                    if (currentTextObj.zhText === undefined) {
                        currentTextObj._tempDisplay = '正在优先翻译当前片段...';
                    }

                    if (shouldRefreshLookahead || translationState.focusIndex !== currentTextIndex || !translationState.processing) {
                        queueFocusedTranslation(transcriptData, currentTextIndex);
                    }

                    renderOverlaySubtitle(overlay, currentTextObj, config);
                } else {
                    renderOverlaySubtitle(overlay, null, config);
                }
            }
        }, 100);
    }

})();
