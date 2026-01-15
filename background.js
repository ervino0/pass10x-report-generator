// Background service worker - handles file downloads
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
