// Background service worker - handles file downloads and OCR processing

// ===== OCR FUNCTIONALITY IN BACKGROUND =====
async function getGeminiApiKey() {
    const workerUrl = 'https://pass10x-report-generator.ervinong91.workers.dev';
    const authToken = 'wicJlS3cF^7OB*76!UCnjLRo6L7Ujh%J';
    const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

    // Check cache first
    const cache = await chrome.storage.local.get(['geminiApiKeyCache', 'geminiApiKeyCacheTimestamp']);
    const now = Date.now();

    if (cache.geminiApiKeyCache && cache.geminiApiKeyCacheTimestamp) {
        const age = now - cache.geminiApiKeyCacheTimestamp;
        if (age < CACHE_DURATION) {
            console.log('[Background] Using cached API key (age:', Math.round(age / 1000), 'seconds)');
            return cache.geminiApiKeyCache;
        }
    }

    // Cache expired or missing - fetch from Cloudflare Worker
    console.log('[Background] Fetching fresh API key from Cloudflare Worker...');
    const response = await fetch(workerUrl, {
        method: 'GET',
        headers: { 'X-Auth-Token': authToken },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch API key: ${response.status}`);
    }

    const data = await response.json();
    if (!data.apiKey) {
        throw new Error('No API key returned from worker.');
    }

    // Cache the API key
    await chrome.storage.local.set({
        geminiApiKeyCache: data.apiKey,
        geminiApiKeyCacheTimestamp: now
    });

    console.log('[Background] API key cached for 1 hour');
    return data.apiKey;
}

function normalizePlate(plate) {
    return plate.toUpperCase().replace(/\s+/g, '');
}

async function tryModelOCR(apiKey, modelName, base64Image, mimeType) {
    console.log(`[Background OCR] Trying model: ${modelName}`);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: "Extract license plates. Return only plate numbers, one per line. Return NONE if empty." },
                    { inline_data: { mime_type: mimeType, data: base64Image } }
                ]
            }]
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        const error = new Error(`${modelName} API error: ${response.status}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
    }

    return await response.json();
}

async function performBackgroundOCR(base64Image, mimeType) {
    // Model fallback order: flash-preview → flash-lite → flash
    const models = ['gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

    try {
        console.log('[Background OCR] Starting OCR process...');

        // Update storage to show processing
        await chrome.storage.local.set({
            ocrStatus: 'processing',
            ocrProgress: 'Fetching API key...'
        });

        const apiKey = await getGeminiApiKey();

        await chrome.storage.local.set({
            ocrProgress: 'Analyzing image with AI...'
        });

        let result = null;
        let lastError = null;

        // Try each model in sequence
        for (let i = 0; i < models.length; i++) {
            const modelName = models[i];

            try {
                result = await tryModelOCR(apiKey, modelName, base64Image, mimeType);
                console.log(`[Background OCR] Successfully used model: ${modelName}`);
                break; // Success - exit loop
            } catch (error) {
                lastError = error;

                // If rate limited (429) or overloaded (503), try next model
                if ((error.status === 429 || error.status === 503) && i < models.length - 1) {
                    console.log(`[Background OCR] ${modelName} returned ${error.status}, trying next model...`);
                    await chrome.storage.local.set({
                        ocrProgress: `Rate limited, trying alternate model...`
                    });
                    continue; // Try next model
                }

                // For other errors or if this is the last model, throw
                throw error;
            }
        }

        if (!result) {
            throw lastError || new Error('All models failed');
        }

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!text || text.trim() === 'NONE') {
            throw new Error('No license plates detected in the image.');
        }

        const plates = text
            .split('\n')
            .map(p => p.trim())
            .map(p => normalizePlate(p))
            .filter(p => p.length > 0)
            .filter(p => /^[A-Z0-9]+$/.test(p));

        if (plates.length === 0) {
            throw new Error('No valid license plates detected in the image.');
        }

        console.log('[Background OCR] Detected', plates.length, 'plates');

        // Store results
        await chrome.storage.local.set({
            ocrStatus: 'completed',
            ocrResults: plates,
            ocrTimestamp: Date.now()
        });

        return { success: true, plates };

    } catch (error) {
        console.error('[Background OCR Error]', error);

        let errorMessage = error.message;
        if (error.status === 429) {
            errorMessage = 'Rate limit exceeded. All backup models are also rate limited. Please try again in a few minutes.';
        } else if (error.status === 503) {
            errorMessage = 'Service temporarily unavailable. Please try again in a moment.';
        }

        await chrome.storage.local.set({
            ocrStatus: 'error',
            ocrError: errorMessage
        });

        return { success: false, error: errorMessage };
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startOCR') {
        console.log('[Background] Received OCR request');

        performBackgroundOCR(message.base64Image, message.mimeType)
            .then(result => {
                sendResponse(result);
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });

        return true; // Keep message channel open for async response
    }

    if (message.action === 'downloadCSV') {
        try {
            const { csvContent, filename } = message;

            // Use standard Data URI (more reliable for filenames than Blobs)
            // Add BOM for Excel compatibility
            const csvWithBOM = "\ufeff" + csvContent;
            const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvWithBOM);

            chrome.downloads.download({
                url: dataUrl,
                filename: filename,
                conflictAction: 'overwrite',
                saveAs: true // Prompts user to save, ensuring they see the filename
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('Download failed:', chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    console.log('Download started:', downloadId);
                    sendResponse({ success: true, downloadId });
                }
            });
        } catch (err) {
            console.error("Background error:", err);
            sendResponse({ success: false, error: err.message });
        }

        // Return true to indicate we'll respond asynchronously
        return true;
    }
});
