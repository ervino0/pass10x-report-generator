// Pass 10x Report Generator Extension
// Features: Dual-mode (Report + Check Plates), smart token detection, data caching

console.log('[Pass10x] Extension loaded - v3.0.0');

// ===== GLOBAL STATE =====
let cachedRecords = null; // Stores fetched violation records (filtered)
let cachedRawRecords = null; // Stores ALL fetched records including passes (unfiltered)
let cachedActivePasses = null; // Stores active parking passes
let currentMode = 'check'; // 'report' or 'check'
let allResults = []; // Stores all check results for filtering
let activeFilters = { tow: true, fine: true, warning: true, activePass: true }; // Active filter state
let ocrUsed = false; // Tracks if OCR was used for current plates
let selectedImageFile = null; // Stores selected image file for OCR

// ===== PERSISTENCE =====
function saveState() {
    try {
        localStorage.setItem('pass10x_cachedRecords', JSON.stringify(cachedRecords));
        localStorage.setItem('pass10x_cachedRawRecords', JSON.stringify(cachedRawRecords));
        localStorage.setItem('pass10x_cachedActivePasses', JSON.stringify(cachedActivePasses));
        localStorage.setItem('pass10x_allResults', JSON.stringify(allResults));
        localStorage.setItem('pass10x_currentMode', currentMode);
        localStorage.setItem('pass10x_activeFilters', JSON.stringify(activeFilters));
        localStorage.setItem('pass10x_plateInput', document.getElementById('plateInput')?.value || '');
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

function loadState() {
    try {
        const savedCachedRecords = localStorage.getItem('pass10x_cachedRecords');
        const savedCachedRawRecords = localStorage.getItem('pass10x_cachedRawRecords');
        const savedCachedActivePasses = localStorage.getItem('pass10x_cachedActivePasses');
        const savedAllResults = localStorage.getItem('pass10x_allResults');
        const savedCurrentMode = localStorage.getItem('pass10x_currentMode');
        const savedActiveFilters = localStorage.getItem('pass10x_activeFilters');
        const savedPlateInput = localStorage.getItem('pass10x_plateInput');

        if (savedCachedRecords) {
            cachedRecords = JSON.parse(savedCachedRecords);
        }

        if (savedCachedRawRecords) {
            cachedRawRecords = JSON.parse(savedCachedRawRecords);
        }

        if (savedCachedActivePasses) {
            cachedActivePasses = JSON.parse(savedCachedActivePasses);
        }

        if (savedAllResults) {
            const parsedResults = JSON.parse(savedAllResults);
            if (parsedResults && parsedResults.length > 0) {
                allResults = parsedResults;
                // Only restore results if we're in check mode
                if (currentMode === 'check') {
                    displayResults(allResults);
                }
            }
        }

        if (savedCurrentMode) {
            currentMode = savedCurrentMode;
            const checkModeBtn = document.getElementById('checkModeBtn');
            const reportModeBtn = document.getElementById('reportModeBtn');
            const checkContainer = document.getElementById('checkModeContainer');
            const reportContainer = document.getElementById('reportModeContainer');

            if (currentMode === 'check') {
                checkModeBtn.classList.add('active');
                reportModeBtn.classList.remove('active');
                checkContainer.style.display = 'block';
                reportContainer.style.display = 'none';
            } else {
                reportModeBtn.classList.add('active');
                checkModeBtn.classList.remove('active');
                reportContainer.style.display = 'block';
                checkContainer.style.display = 'none';
            }
        }

        if (savedActiveFilters) {
            activeFilters = JSON.parse(savedActiveFilters);
            document.getElementById('filterTow').classList.toggle('active', activeFilters.tow);
            document.getElementById('filterFine').classList.toggle('active', activeFilters.fine);
            document.getElementById('filterWarning').classList.toggle('active', activeFilters.warning);
            document.getElementById('filterActivePass').classList.toggle('active', activeFilters.activePass);
            if (allResults.length > 0) {
                applyFilters();
            }
        }

        if (savedPlateInput) {
            document.getElementById('plateInput').value = savedPlateInput;
        }
    } catch (e) {
        console.error('Failed to load state:', e);
    }
}

// ===== MODE TOGGLE =====
function initializeModeToggle() {
    const reportModeBtn = document.getElementById('reportModeBtn');
    const checkModeBtn = document.getElementById('checkModeBtn');
    const reportContainer = document.getElementById('reportModeContainer');
    const checkContainer = document.getElementById('checkModeContainer');

    reportModeBtn.addEventListener('click', () => {
        currentMode = 'report';
        reportModeBtn.classList.add('active');
        checkModeBtn.classList.remove('active');
        reportContainer.style.display = 'block';
        checkContainer.style.display = 'none';
        saveState();
    });

    checkModeBtn.addEventListener('click', () => {
        currentMode = 'check';
        checkModeBtn.classList.add('active');
        reportModeBtn.classList.remove('active');
        reportContainer.style.display = 'none';
        checkContainer.style.display = 'block';
        saveState();
    });
}

// ===== DATA FETCHING =====
async function fetchViolationRecords(excludeWarning0, includeNotes) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [excludeWarning0, includeNotes],
        func: (excludeWarning0, includeNotes) => {
            return new Promise(async (resolve) => {
                console.log("=== Pass 10x Report Generator ===");

                // --- TOKEN DETECTION ---
                let authToken = null;
                try {
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key.endsWith('.LastAuthUser')) {
                            const lastUser = localStorage.getItem(key);
                            const parts = key.split('.');
                            if (parts.length >= 2) {
                                authToken = localStorage.getItem(`CognitoIdentityServiceProvider.${parts[1]}.${lastUser}.idToken`);
                                if (authToken) break;
                            }
                        }
                    }
                } catch (e) { }

                if (!authToken) {
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key.includes('idToken')) {
                            authToken = localStorage.getItem(key);
                            break;
                        }
                    }
                }

                if (!authToken) {
                    resolve({ error: "Not logged in! Please log in to Pass10x first." });
                    return;
                }

                try {
                    // --- FETCH VIOLATIONS ---
                    const violationsBody = {
                        action: "GET_PARKPASS_FILTER",
                        data: { lockey: "20104", status: "ALL", mins: 259200, pptype: "all", "__APPVERSION__": "1.0.170" }
                    };

                    const violationsResponse = await fetch('https://b3t3jo9o62.execute-api.us-east-2.amazonaws.com/prod/yacall', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify(violationsBody)
                    });

                    if (violationsResponse.status === 401) {
                        resolve({ error: "Session Expired! Please reload the page." });
                        return;
                    }

                    let records = await violationsResponse.json();
                    if (!Array.isArray(records)) {
                        records = records.body ? (typeof records.body === 'string' ? JSON.parse(records.body) : records.body) : records.data;
                    }

                    // --- EXTRACT ACTIVE PASSES ---
                    // Active visitor/staff passes are already in the records we fetched
                    // Filter for passes that are currently active (endtime > now) and are visitor/staff passes
                    const now = Date.now();
                    let activePasses = (records || []).filter(pass => {
                        const isVisitorOrStaff = pass.type === 'visitor' || pass.type === 'staff';
                        const isActive = pass.endtime && pass.endtime > now;
                        const hasNoViolation = !pass.nowarn && !pass.noticket && !pass.notow;
                        return isVisitorOrStaff && isActive && hasNoViolation;
                    });

                    console.log(`[Pass10x] Found ${activePasses.length} active passes (endtime > ${now})`);
                    console.log('[Pass10x] Sample active passes:', activePasses.slice(0, 5));

                    // --- FILTER RECORDS ---
                    const cleanWarnings = records.filter(v => {
                        const hasWarning = v.nowarn !== null && v.nowarn !== undefined && v.nowarn !== "";
                        const hasFine = v.noticket !== null && v.noticket !== undefined && v.noticket !== "";
                        const hasTow = v.notow !== null && v.notow !== undefined && v.notow !== "";
                        const isNote = !hasWarning && !hasFine && !hasTow;
                        const passesWarningFilter = excludeWarning0 && hasWarning && !hasFine && !hasTow ? v.nowarn > 0 : true;
                        const includeRecord = (hasWarning || hasFine || hasTow) || (isNote && includeNotes);
                        return includeRecord && passesWarningFilter;
                    });

                    resolve({ records: cleanWarnings, rawRecords: records, activePasses: activePasses });

                } catch (err) {
                    resolve({ error: err.message });
                }
            });
        }
    });

    const result = results[0]?.result;
    if (!result || result.error) {
        throw new Error(result?.error || "Unknown Error");
    }

    return result;
}

// ===== CSV GENERATION =====
function generateCSVReport(cleanWarnings) {
    const toPST = (ts) => new Date(ts).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    }).replace(/,/g, "");

    const suiteGroups = {};
    const unregisteredGroups = {};

    cleanWarnings.forEach(v => {
        const s = v.suite ? v.suite.toUpperCase() : "BM01";

        let violationType = "";
        if (v.notow !== null && v.notow !== undefined && v.notow !== "") {
            violationType = `Tow #${v.notow}`;
        } else if (v.noticket !== null && v.noticket !== undefined && v.noticket !== "") {
            violationType = `Fine #${v.noticket}`;
        } else if (v.nowarn !== null && v.nowarn !== undefined && v.nowarn !== "") {
            violationType = `Warning #${v.nowarn}`;
        } else {
            violationType = "Note";
        }

        const row = [s, v.plate, toPST(v.starttime), violationType, `"${(v.name || "").replace(/"/g, '""')}"`];

        if (["BM01", "STRATA1", "UNKNOWN", ""].includes(s)) {
            if (!unregisteredGroups[v.plate]) unregisteredGroups[v.plate] = [];
            unregisteredGroups[v.plate].push(row);
        } else {
            if (!suiteGroups[s]) suiteGroups[s] = [];
            suiteGroups[s].push(row);
        }
    });

    // --- CSV GENERATION ---
    let csvRows = ["\ufeff"]; // BOM for Excel

    csvRows.push("SECTION 1: TOW ELIGIBLE SUITES");
    csvRows.push("Suite,Plate,Date/Time (PST),Violation Type,Notes");
    Object.keys(suiteGroups).sort().forEach(s => {
        if (suiteGroups[s].length >= 2) {
            suiteGroups[s].forEach(line => csvRows.push(line.join(",")));
            csvRows.push(",,,,");
        }
    });

    csvRows.push("");
    csvRows.push("SECTION 2: UNREGISTERED PLATES - REPEAT OFFENDERS (2+ HITS)");
    csvRows.push("Suite,Plate,Date/Time (PST),Violation Type,Notes");
    Object.keys(unregisteredGroups).sort().forEach(p => {
        if (unregisteredGroups[p].length >= 2) {
            unregisteredGroups[p].forEach(line => csvRows.push(line.join(",")));
            csvRows.push(",,,,");
        }
    });

    csvRows.push("");
    csvRows.push("SECTION 3: UNREGISTERED PLATES - SINGLE HIT ONLY");
    csvRows.push("Suite,Plate,Date/Time (PST),Violation Type,Notes");

    const singleHitEntries = [];
    Object.keys(unregisteredGroups).forEach(p => {
        if (unregisteredGroups[p].length === 1) {
            const entry = unregisteredGroups[p][0];
            const plateRecord = cleanWarnings.find(v => v.plate === entry[1]);
            singleHitEntries.push({
                row: entry,
                timestamp: plateRecord ? plateRecord.starttime : 0
            });
        }
    });

    singleHitEntries.sort((a, b) => b.timestamp - a.timestamp);
    singleHitEntries.forEach(entry => {
        csvRows.push(entry.row.join(","));
    });

    const stats = {
        total: cleanWarnings.length,
        towEligibleSuites: Object.keys(suiteGroups).filter(s => suiteGroups[s].length >= 2).length,
        unregisteredRepeat: Object.keys(unregisteredGroups).filter(p => unregisteredGroups[p].length >= 2).length,
        unregisteredSingle: Object.keys(unregisteredGroups).filter(p => unregisteredGroups[p].length === 1).length
    };

    return { csvContent: csvRows.join("\n"), stats };
}

// ===== PLATE NORMALIZATION =====
function normalizePlate(plate) {
    // Remove all spaces from license plates (BC and other formats)
    // Pass10x doesn't use spaces in their format
    return plate.toUpperCase().replace(/\s+/g, '');
}

// ===== OCR FUNCTIONALITY =====
async function getGeminiApiKey() {
    // Hardcoded settings - no configuration needed
    const workerUrl = 'https://pass10x-report-generator.ervinong91.workers.dev';
    const authToken = 'wicJlS3cF^7OB*76!UCnjLRo6L7Ujh%J';

    // Fetch API key from Cloudflare Worker
    const response = await fetch(workerUrl, {
        method: 'GET',
        headers: {
            'X-Auth-Token': authToken,
        },
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Authentication failed. Please check your Auth Token in Settings.');
        }
        throw new Error(`Failed to fetch API key: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.apiKey) {
        throw new Error('No API key returned from worker.');
    }

    return data.apiKey;
}

async function performOCR(imageFile) {
    try {
        // Get API key from Cloudflare Worker
        const apiKey = await getGeminiApiKey();

        // Convert image to base64
        const base64Image = await fileToBase64(imageFile);

        // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
        const base64Data = base64Image.split(',')[1];

        // Determine MIME type
        const mimeType = imageFile.type || 'image/jpeg';

        // Call Gemini Vision API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            text: "Extract all license plate numbers from this image. Return ONLY the plate numbers, one per line, with no additional text, explanations, or formatting. If there are no license plates visible, return 'NONE'."
                        },
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: base64Data
                            }
                        }
                    ]
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Gemini API error: ${response.status} - ${JSON.stringify(errorData)}`);
        }

        const result = await response.json();

        // Extract text from Gemini response
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!text || text.trim() === 'NONE') {
            throw new Error('No license plates detected in the image.');
        }

        // Parse and normalize plates
        const plates = text
            .split('\n')
            .map(p => p.trim())
            .map(p => normalizePlate(p))
            .filter(p => p.length > 0)
            .filter(p => /^[A-Z0-9]+$/.test(p));

        if (plates.length === 0) {
            throw new Error('No valid license plates detected in the image.');
        }

        return plates;

    } catch (error) {
        console.error('[OCR Error]', error);
        throw error;
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Compress image to reduce size and speed up OCR
// Optimized for speed - license plates don't need high resolution
async function compressImage(file, maxWidth = 1024, maxHeight = 768, quality = 0.65) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate new dimensions while maintaining aspect ratio
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = width * ratio;
                    height = height * ratio;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to blob
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                }, 'image/jpeg', quality);
            };

            img.onerror = reject;
            img.src = e.target.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ===== PLATE CHECKING =====
function parsePlateInput(inputText) {
    if (!inputText || !inputText.trim()) {
        return [];
    }

    const plates = inputText
        .toUpperCase()
        .split(/[\n,\s]+/)
        .map(p => p.trim())
        .map(p => normalizePlate(p)) // Normalize each plate (remove spaces)
        .filter(p => p.length > 0)
        .filter(p => /^[A-Z0-9]+$/.test(p)); // Only letters and numbers, no spaces or special chars

    const uniquePlates = [...new Set(plates)];

    if (uniquePlates.length > 100) {
        alert(`Warning: Only the first 100 plates will be checked. You entered ${uniquePlates.length} plates.`);
    }

    return uniquePlates.slice(0, 100);
}

function isValidViolation(v) {
    // Exclude violations where warning/fine/tow number is <= 0 (removed violations)
    const warnValid = v.nowarn !== null && v.nowarn !== undefined && v.nowarn !== "" && v.nowarn > 0;
    const fineValid = v.noticket !== null && v.noticket !== undefined && v.noticket !== "" && v.noticket > 0;
    const towValid = v.notow !== null && v.notow !== undefined && v.notow !== "" && v.notow > 0;

    return warnValid || fineValid || towValid;
}

function determineEnforcementAction(plate, records, activePasses = [], rawRecords = null) {
    // Helper function to get suite info from any record (active passes, expired passes, or violations)
    const getSuiteFromRecords = (plate, allRecords) => {
        if (!allRecords || allRecords.length === 0) return null;

        // Search through all records to find suite association
        const record = allRecords.find(r =>
            r.plate && r.plate.toUpperCase() === plate.toUpperCase() && r.suite
        );

        return record?.suite || null;
    };

    // Helper function to get active pass details (expiration, monthly count)
    const getActivePassDetails = (plate, suite, allRecords) => {
        const details = { hasActivePass: false, passExpiration: null, monthlyPassCount: 0 };

        // Check for active pass
        if (activePasses && activePasses.length > 0) {
            const activePass = activePasses.find(pass => {
                const plateMatch = pass.plate && pass.plate.toUpperCase() === plate.toUpperCase();
                const suiteMatch = suite && pass.suite && pass.suite.toUpperCase() === suite.toUpperCase();
                return plateMatch || suiteMatch;
            });

            if (activePass) {
                details.hasActivePass = true;
                details.passExpiration = activePass.endtime;
            }
        }

        // Count ALL passes (including expired) for this suite in current month
        if (suite && allRecords && allRecords.length > 0) {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth(); // 0-11

            details.monthlyPassCount = allRecords.filter(record => {
                // Check if it's a pass (visitor/staff) for this suite
                if (!record.suite || record.suite.toUpperCase() !== suite.toUpperCase()) {
                    return false;
                }
                if (record.type !== 'visitor' && record.type !== 'staff') {
                    return false;
                }
                if (!record.starttime) {
                    return false;
                }

                // Check if pass was ISSUED (created) this month
                const passDate = new Date(record.starttime);
                return passDate.getFullYear() === currentYear && passDate.getMonth() === currentMonth;
            }).length;
        }

        return details;
    };

    // Use rawRecords for monthly pass counting if available, otherwise fall back to records
    const recordsForPassCounting = rawRecords || records || [];

    if (!records || records.length === 0) {
        // Try to get suite from all records (including expired passes)
        const suiteFromRecords = getSuiteFromRecords(plate, recordsForPassCounting);
        const isSuite = suiteFromRecords && !["BM01", "STRATA1", "UNKNOWN", ""].includes(suiteFromRecords.toUpperCase());

        // Get active pass details using rawRecords for accurate monthly counting
        const passDetails = getActivePassDetails(plate, suiteFromRecords, recordsForPassCounting);

        // Determine status based on whether plate has active pass
        let status, details;
        if (passDetails.hasActivePass) {
            // Has active pass - no action needed
            status = '🟢 NO VIOLATIONS';
            details = isSuite ? `Suite: ${suiteFromRecords}. No violations.` : 'No violations found in the last 180 days.';
        } else {
            // No active pass - unregistered plate should get warning
            status = '🟢 WARNING ONLY';
            details = isSuite ? `Suite: ${suiteFromRecords}. No violations.` : 'Unregistered plate. No violations.';
        }

        return {
            plate: plate,
            action: 'warning',
            status: status,
            violationCount: 0,
            details: details,
            isSuite: isSuite,
            suite: suiteFromRecords,
            violations: [],
            hasActivePass: passDetails.hasActivePass,
            passExpiration: passDetails.passExpiration,
            monthlyPassCount: passDetails.monthlyPassCount
        };
    }

    // First, find if this plate is registered to a suite
    const plateRecord = records.find(v => v.plate && v.plate.toUpperCase() === plate.toUpperCase());

    if (!plateRecord) {
        // Try to get suite from all records (including expired passes)
        const suiteFromRecords = getSuiteFromRecords(plate, recordsForPassCounting);
        const isSuite = suiteFromRecords && !["BM01", "STRATA1", "UNKNOWN", ""].includes(suiteFromRecords.toUpperCase());

        // CRITICAL: For suite plates, check for suite-wide violations before returning
        // Don't return early if this plate belongs to a suite - need to check suite violations
        if (isSuite) {
            // Check if the suite has any violations (from any plate)
            const suiteViolations = records.filter(v =>
                v.suite && v.suite.toUpperCase() === suiteFromRecords.toUpperCase() && isValidViolation(v)
            );

            if (suiteViolations.length > 0) {
                // Suite has violations - don't return early, let the main logic handle it
                // Create a synthetic plate record to continue processing
                plateRecord = { plate: plate, suite: suiteFromRecords };
            }
        }

        // If still no plate record (unregistered plate), return early
        if (!plateRecord) {
            // Get active pass details using rawRecords for accurate monthly counting
            const passDetails = getActivePassDetails(plate, suiteFromRecords, recordsForPassCounting);

            // Determine status based on whether plate has active pass
            let status, details;
            if (passDetails.hasActivePass) {
                // Has active pass - no action needed
                status = '🟢 NO VIOLATIONS';
                details = isSuite ? `Suite: ${suiteFromRecords}. No violations.` : 'No violations found in the last 180 days.';
            } else {
                // No active pass - unregistered plate should get warning
                status = '🟢 WARNING ONLY';
                details = isSuite ? `Suite: ${suiteFromRecords}. No violations.` : 'Unregistered plate. No violations.';
            }

            return {
                plate: plate,
                action: 'warning',
                status: status,
                violationCount: 0,
                details: details,
                isSuite: isSuite,
                suite: suiteFromRecords,
                violations: [],
                hasActivePass: passDetails.hasActivePass,
                passExpiration: passDetails.passExpiration,
                monthlyPassCount: passDetails.monthlyPassCount
            };
        }
    }

    const suite = plateRecord.suite ? plateRecord.suite.toUpperCase() : "BM01";
    const isSuite = !["BM01", "STRATA1", "UNKNOWN", ""].includes(suite);

    // Get active pass details using rawRecords for accurate monthly counting
    const passDetails = getActivePassDetails(plate, isSuite ? suite : null, recordsForPassCounting);

    console.log(`[Pass10x] Plate ${plate}, Suite ${suite}, isSuite=${isSuite}, hasActivePass=${passDetails.hasActivePass}, activePasses.length=${activePasses ? activePasses.length : 0}`);

    // CRITICAL FIX: For suite plates, count ALL violations for the SUITE
    // For unregistered plates, count violations for the PLATE
    let allViolations;
    if (isSuite) {
        // Count all violations for this SUITE (not just this plate)
        allViolations = records.filter(v =>
            v.suite && v.suite.toUpperCase() === suite && isValidViolation(v)
        );
    } else {
        // Count violations for this specific PLATE
        allViolations = records.filter(v =>
            v.plate && v.plate.toUpperCase() === plate.toUpperCase() && isValidViolation(v)
        );
    }

    const violationCount = allViolations.length;

    // Format violations for display
    const toPST = (ts) => new Date(ts).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    }).replace(/,/g, "");

    // For suite plates: show ALL suite violations with plate numbers
    // For unregistered plates: show only violations for this plate
    const violationsToDisplay = isSuite ? allViolations : allViolations;

    const formattedViolations = violationsToDisplay.map(v => {
        let type = "";
        let number = "";

        if (v.notow && v.notow > 0) {
            type = "Tow";
            number = v.notow;
        } else if (v.noticket && v.noticket > 0) {
            type = "Fine";
            number = v.noticket;
        } else if (v.nowarn && v.nowarn > 0) {
            type = "Warning";
            number = v.nowarn;
        }

        return {
            plate: v.plate || "",
            date: toPST(v.starttime),
            type: type,
            number: number,
            notes: v.name || ""
        };
    });

    let action, status, details;

    if (isSuite) {
        // Suite enforcement rules - use SUITE violation count
        if (violationCount === 0) {
            action = 'warning';
            status = '🟢 WARNING ONLY';
            details = `Suite: ${suite}. No violations.`;
        } else if (violationCount === 1) {
            action = 'fine';
            status = '🟡 ISSUE FINE';
            details = `Suite: ${suite}. 1 violation (suite-wide).`;
        } else {
            action = 'tow';
            status = '🔴 TOW IMMEDIATELY';
            details = `Suite: ${suite}. ${violationCount} violations (suite-wide). TOW ELIGIBLE.`;
        }
    } else {
        // Unregistered plate enforcement rules
        if (violationCount === 0) {
            action = 'warning';
            status = '🟢 WARNING ONLY';
            details = 'Unregistered plate. No violations.';
        } else {
            action = 'tow';
            status = '🔴 TOW IMMEDIATELY';
            details = `Unregistered plate. ${violationCount} violation${violationCount > 1 ? 's' : ''} found.`;
        }
    }

    return {
        plate: plate,
        action: action,
        status: status,
        violationCount: violationCount,
        details: details,
        isSuite: isSuite,
        suite: isSuite ? suite : null,
        violations: formattedViolations,
        hasActivePass: passDetails.hasActivePass,
        passExpiration: passDetails.passExpiration,
        monthlyPassCount: passDetails.monthlyPassCount
    };
}

function createResultCard(result) {
    let violationsHTML = '';
    let activePassWarning = '';

    // Show active pass warning with expiration and monthly count
    if (result.hasActivePass) {
        let warningMessage = '';

        // If no violations, no action needed
        if (result.violationCount === 0) {
            warningMessage = '✅ HAS ACTIVE PASS - NO ACTION NEEDED';
        } else {
            // If there are prior violations, the next one would escalate to fine/tow
            // So we warn based on what the action WOULD be without the pass
            if (result.action === 'tow') {
                warningMessage = '⚠️ HAS ACTIVE PASS - DO NOT TOW';
            } else {
                // For any prior violations (1+), warn DO NOT FINE
                // because the next violation would be at fine/tow level
                warningMessage = '⚠️ HAS ACTIVE PASS - DO NOT FINE';
            }
        }

        // Format expiration date
        let expirationText = '';
        if (result.passExpiration) {
            const expDate = new Date(result.passExpiration);
            const formatted = expDate.toLocaleString("en-US", {
                timeZone: "America/Los_Angeles",
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            });
            expirationText = `<div style="font-size: 11px; margin-top: 4px; color: #1e293b;">Expires: ${formatted}</div>`;
        }

        // Monthly pass count
        let monthlyCountText = '';
        if (result.monthlyPassCount > 0) {
            monthlyCountText = `<div style="font-size: 11px; margin-top: 2px; color: #64748b;">This Month: ${result.monthlyPassCount} pass${result.monthlyPassCount > 1 ? 'es' : ''}</div>`;
        }

        activePassWarning = `
            <div style="
                background: #fffbeb;
                border: 1px solid #f59e0b;
                border-radius: 6px;
                padding: 10px 12px;
                margin-top: 8px;
                font-size: 12px;
                font-weight: 600;
                color: #1e293b;
                text-align: center;
                line-height: 1.4;
            ">
                ${warningMessage}
                ${expirationText}
                ${monthlyCountText}
            </div>
        `;
    }

    if (result.violations && result.violations.length > 0) {
        const headerRow = result.isSuite
            ? '<tr><th>Plate</th><th>Date/Time</th><th>Type</th><th>Notes</th></tr>'
            : '<tr><th>Date/Time</th><th>Type</th><th>Notes</th></tr>';

        const dataRows = result.violations.map(v => {
            if (result.isSuite) {
                return `
                    <tr>
                        <td style="font-family: 'Courier New', monospace; font-weight: bold;">${v.plate}</td>
                        <td>${v.date}</td>
                        <td>${v.type} #${v.number}</td>
                        <td>${v.notes}</td>
                    </tr>
                `;
            } else {
                return `
                    <tr>
                        <td>${v.date}</td>
                        <td>${v.type} #${v.number}</td>
                        <td>${v.notes}</td>
                    </tr>
                `;
            }
        }).join('');

        violationsHTML = `
            <div class="expand-btn">▶ View ${result.violations.length} violation${result.violations.length > 1 ? 's' : ''}</div>
            <div class="violation-details">
                <table>
                    <thead>
                        ${headerRow}
                    </thead>
                    <tbody>
                        ${dataRows}
                    </tbody>
                </table>
            </div>
        `;
    }

    const plateDisplay = result.isSuite && result.suite
        ? `${result.plate} <span style="color: #64748b; font-size: 11px;">(Suite ${result.suite})</span>`
        : result.plate;

    // Show monthly pass count for suites without active passes (to avoid duplication)
    let monthlyPassInfo = '';
    if (result.isSuite && result.monthlyPassCount > 0 && !result.hasActivePass) {
        monthlyPassInfo = `
            <div style="
                font-size: 10px;
                color: #64748b;
                margin-top: 4px;
                font-style: italic;
            ">
                📊 This Month: ${result.monthlyPassCount} pass${result.monthlyPassCount > 1 ? 'es' : ''} issued
            </div>
        `;
    }

    return `
    <div class="result-card ${result.action}" data-action="${result.action}">
      <div class="result-plate">${plateDisplay}</div>
      <div class="result-status">${result.status}</div>
      <div class="result-details">${result.details}</div>
      ${monthlyPassInfo}
      ${activePassWarning}
      ${violationsHTML}
    </div>
  `;
}

function toggleViolationDetails(btn) {
    const card = btn.closest('.result-card');
    const details = card.querySelector('.violation-details');

    if (details.classList.contains('expanded')) {
        details.classList.remove('expanded');
        btn.textContent = btn.textContent.replace('▼', '▶');
    } else {
        details.classList.add('expanded');
        btn.textContent = btn.textContent.replace('▶', '▼');
    }
}

function displayResults(results, saveToGlobal = true) {
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsList = document.getElementById('resultsList');
    const resultCount = document.getElementById('resultCount');
    const inputSection = document.getElementById('inputSection');
    const actionButtons = document.getElementById('actionButtons');
    const checkHelpInfo = document.getElementById('checkHelpInfo');
    const minimizedInput = document.getElementById('minimizedInput');

    if (saveToGlobal) {
        allResults = results;
        saveState(); // Save results
    }

    if (results.length === 0) {
        resultsContainer.style.display = 'none';
        if (minimizedInput) minimizedInput.style.display = 'none';
        if (inputSection) inputSection.style.display = 'block';
        if (actionButtons) actionButtons.style.display = 'flex';
        if (checkHelpInfo) checkHelpInfo.style.display = 'block';
        return;
    }

    // Minimize input section when showing results
    if (inputSection) inputSection.style.display = 'none';
    if (actionButtons) actionButtons.style.display = 'none';
    if (checkHelpInfo) checkHelpInfo.style.display = 'none';
    if (minimizedInput) minimizedInput.style.display = 'block';

    // Sort by urgency: TOW > FINE > WARNING
    const sortOrder = { 'tow': 1, 'fine': 2, 'warning': 3 };
    results.sort((a, b) => sortOrder[a.action] - sortOrder[b.action]);

    // Apply filters with active pass filter handling
    const filteredResults = results.filter(r => {
        // If plate has active pass and activePass filter is OFF, hide it
        if (r.hasActivePass && !activeFilters.activePass) {
            return false;
        }

        // Otherwise, check the action filter
        return activeFilters[r.action];
    });

    resultsList.innerHTML = filteredResults.map(r => createResultCard(r)).join('');
    resultCount.textContent = filteredResults.length;

    resultsContainer.style.display = 'block';
}

function applyFilters() {
    displayResults(allResults, false);
}

// ===== EVENT HANDLERS =====

// Report Mode: Fetch & Download
document.getElementById('prepPage').addEventListener('click', async () => {
    const btn = document.getElementById('prepPage');
    const status = document.getElementById('status');
    const help = document.getElementById('helpInfo');

    btn.disabled = true;
    btn.innerText = "⏳ Fetching Data...";
    btn.style.opacity = "0.7";
    help.style.display = "none";
    status.style.display = "block";
    status.innerText = "⏳ Connecting to database...";

    try {
        const excludeWarning0 = document.getElementById('excludeWarning0').checked;
        const includeNotes = document.getElementById('includeNotes').checked;

        status.innerText = "⏳ Fetching 180 days of records...";

        const fetchedData = await fetchViolationRecords(excludeWarning0, includeNotes);
        cachedRecords = fetchedData.records; // Cache for check mode
        cachedRawRecords = fetchedData.rawRecords || fetchedData.records; // Cache raw records for monthly pass counting
        cachedActivePasses = fetchedData.activePasses || []; // Cache active passes
        console.log(`[Pass10x Report Mode] Cached ${cachedRecords.length} violations and ${cachedActivePasses.length} active passes`);
        console.log('[Pass10x] First 3 active passes:', cachedActivePasses.slice(0, 3));
        saveState(); // Save cached data

        status.innerText = "⏳ Processing data...";

        const { csvContent, stats } = generateCSVReport(fetchedData.records);

        status.innerText = "✅ Generating CSV...";

        // Download CSV
        const date = new Date().toISOString().split('T')[0];
        const filename = `Enforcement_Report_${date}.csv`;

        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);

        // Success UI
        btn.innerText = "✅ Download Complete";
        btn.style.background = "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)";
        const totalUnregisteredTow = stats.unregisteredRepeat + stats.unregisteredSingle;
        status.innerHTML = `
            <span style="color:white; font-weight:bold;">Stats:</span><br>
            <div style="font-size:11px; line-height:1.4; margin-top:5px;">
            • ${stats.total} Total Records<br>
            • ${stats.towEligibleSuites} Tow Eligible Suites (2+ violations)<br>
            • ${totalUnregisteredTow} Tow Eligible Unregistered Plates<br>
            &nbsp;&nbsp;(${stats.unregisteredRepeat} with 2+ violations, ${stats.unregisteredSingle} with 1 violation)
            </div>
        `;

        setTimeout(() => {
            btn.disabled = false;
            btn.innerText = "📥 Fetch & Download Report";
            btn.style.opacity = "1";
        }, 3000);

    } catch (e) {
        status.innerText = "❌ Error Occurred";
        status.style.color = "#ff4757";
        alert("Error: " + e.message);

        btn.disabled = false;
        btn.innerText = "📥 Fetch & Download Report";
        btn.style.opacity = "1";
    }
});

// Check Plates Mode: Check Plates Button
document.getElementById('checkPlatesBtn').addEventListener('click', async () => {
    const plateInput = document.getElementById('plateInput');
    const checkStatus = document.getElementById('checkStatus');
    const checkHelpInfo = document.getElementById('checkHelpInfo');
    const checkBtn = document.getElementById('checkPlatesBtn');

    const inputText = plateInput.value;

    if (!inputText || !inputText.trim()) {
        alert('Please enter at least one license plate.');
        plateInput.focus();
        return;
    }

    const plates = parsePlateInput(inputText);

    if (plates.length === 0) {
        alert('No valid plates found. Please check your input.');
        return;
    }

    // Always clear cache before fetching to ensure fresh data
    cachedRecords = null;
    cachedRawRecords = null;
    cachedActivePasses = null;
    console.log('[Pass10x] Cache cleared - fetching fresh data');

    // Always fetch fresh data
    if (!cachedRecords) {
        checkBtn.disabled = true;
        checkBtn.innerText = "⏳ Fetching Data...";
        checkBtn.style.opacity = "0.7";
        checkHelpInfo.style.display = "none";
        checkStatus.style.display = "block";
        checkStatus.innerText = "⏳ Fetching violation records...";

        try {
            const excludeWarning0 = false;
            const includeNotes = false;

            const fetchedData = await fetchViolationRecords(excludeWarning0, includeNotes);
            cachedRecords = fetchedData.records;
            cachedRawRecords = fetchedData.rawRecords || fetchedData.records; // Cache raw records for monthly pass counting
            cachedActivePasses = fetchedData.activePasses || []; // Cache active passes
            console.log(`[Pass10x Check Mode] Cached ${cachedRecords.length} violations and ${cachedActivePasses.length} active passes`);
            console.log('[Pass10x] First 3 active passes:', cachedActivePasses.slice(0, 3));
            saveState(); // Save cached data

            checkStatus.innerText = "✅ Data loaded. Checking plates...";

        } catch (e) {
            checkStatus.innerText = "❌ Error Occurred";
            checkStatus.style.color = "#ff4757";
            alert("Error fetching data: " + e.message);

            checkBtn.disabled = false;
            checkBtn.innerText = "🔍 Check Plates";
            checkBtn.style.opacity = "1";
            checkHelpInfo.style.display = "block";
            checkStatus.style.display = "none";
            return;
        }
    } else {
        checkBtn.disabled = true;
        checkBtn.innerText = "⏳ Checking...";
        checkBtn.style.opacity = "0.7";
        checkHelpInfo.style.display = "none";
        checkStatus.style.display = "block";
        checkStatus.innerText = "⏳ Checking plates...";
    }

    // Simulate slight delay for UX
    await new Promise(resolve => setTimeout(resolve, 300));

    // Check each plate
    console.log(`[Pass10x] Checking ${plates.length} plates with ${cachedActivePasses ? cachedActivePasses.length : 0} cached active passes`);
    const results = plates.map(plate =>
        determineEnforcementAction(plate, cachedRecords, cachedActivePasses, cachedRawRecords)
    );

    // Display results
    displayResults(results);

    // Reset UI
    checkBtn.disabled = false;
    checkBtn.innerText = "🔍 Check Plates";
    checkBtn.style.opacity = "1";
    checkStatus.style.display = "none";
    checkHelpInfo.style.display = "block";
});

// Clear Input Button
document.getElementById('clearInputBtn').addEventListener('click', () => {
    const inputSection = document.getElementById('inputSection');
    const actionButtons = document.getElementById('actionButtons');
    const checkHelpInfo = document.getElementById('checkHelpInfo');
    const minimizedInput = document.getElementById('minimizedInput');
    const imagePreview = document.getElementById('imagePreview');

    document.getElementById('plateInput').value = '';
    document.getElementById('resultsContainer').style.display = 'none';

    // Clear image preview
    if (imagePreview) {
        imagePreview.classList.remove('active');
        document.getElementById('previewImg').src = '';
    }
    selectedImageFile = null;
    ocrUsed = false;

    // Show input section
    if (inputSection) inputSection.style.display = 'block';
    if (actionButtons) actionButtons.style.display = 'flex';
    if (checkHelpInfo) checkHelpInfo.style.display = 'block';
    if (minimizedInput) minimizedInput.style.display = 'none';

    allResults = [];
    // Clear cached data to force fresh fetch on next check
    cachedRecords = null;
    cachedRawRecords = null;
    cachedActivePasses = null;
    console.log('[Pass10x] Cleared all cached data and image preview');
    document.getElementById('plateInput').focus();
    saveState();
});

// Save plate input as user types
document.getElementById('plateInput').addEventListener('input', () => {
    saveState();
});

// Show Example Link
document.getElementById('showExample').addEventListener('click', (e) => {
    e.preventDefault();
    const examplePlates = 'ABC123\nXYZ789\nDEF456';
    document.getElementById('plateInput').value = examplePlates;
    document.getElementById('plateInput').focus();
});

// New Search Button (return to input mode)
document.getElementById('newSearchBtn').addEventListener('click', () => {
    const inputSection = document.getElementById('inputSection');
    const actionButtons = document.getElementById('actionButtons');
    const checkHelpInfo = document.getElementById('checkHelpInfo');
    const minimizedInput = document.getElementById('minimizedInput');
    const resultsContainer = document.getElementById('resultsContainer');

    // Show input section, hide results
    if (inputSection) inputSection.style.display = 'block';
    if (actionButtons) actionButtons.style.display = 'flex';
    if (checkHelpInfo) checkHelpInfo.style.display = 'block';
    if (minimizedInput) minimizedInput.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'none';

    // Clear results but keep cached data
    allResults = [];
    saveState();

    // Focus on textarea
    document.getElementById('plateInput').focus();
});

// Filter Toggle Buttons
document.getElementById('filterTow').addEventListener('click', function() {
    activeFilters.tow = !activeFilters.tow;
    this.classList.toggle('active');
    applyFilters();
    saveState();
});

document.getElementById('filterFine').addEventListener('click', function() {
    activeFilters.fine = !activeFilters.fine;
    this.classList.toggle('active');
    applyFilters();
    saveState();
});

document.getElementById('filterWarning').addEventListener('click', function() {
    activeFilters.warning = !activeFilters.warning;
    this.classList.toggle('active');
    applyFilters();
    saveState();
});

document.getElementById('filterActivePass').addEventListener('click', function() {
    activeFilters.activePass = !activeFilters.activePass;
    this.classList.toggle('active');
    applyFilters();
    saveState();
});

// Download CSV Button
document.getElementById('downloadCSVBtn').addEventListener('click', () => {
    if (!allResults || allResults.length === 0) {
        alert('No results to download.');
        return;
    }

    // Generate CSV content
    let csvRows = ["\ufeff"]; // BOM for Excel
    csvRows.push("ENFORCEMENT CHECK RESULTS");
    csvRows.push("");
    csvRows.push("Plate,Action,Violation Count,Details,Suite");

    allResults.forEach(result => {
        const suite = result.suite || 'Unregistered';
        const activePassNote = result.hasActivePass ? ' ⚠️ HAS ACTIVE PASS' : '';
        csvRows.push(`${result.plate},${result.status}${activePassNote},${result.violationCount},"${result.details}",${suite}`);

        // Add active pass warning
        if (result.hasActivePass) {
            csvRows.push(',,⚠️ HAS ACTIVE PASS - DO NOT TOW,,');
        }

        // Add violation details
        if (result.violations && result.violations.length > 0) {
            // For suite plates, include plate column
            if (result.isSuite) {
                csvRows.push(",,Plate,Date/Time,Type,Notes");
                result.violations.forEach(v => {
                    csvRows.push(`,,${v.plate},${v.date},${v.type} #${v.number},"${v.notes.replace(/"/g, '""')}"`);
                });
            } else {
                csvRows.push(",,Date/Time,Type,Notes");
                result.violations.forEach(v => {
                    csvRows.push(`,,${v.date},${v.type} #${v.number},"${v.notes.replace(/"/g, '""')}"`);
                });
            }
            csvRows.push(""); // Blank line between plates
        }
    });

    // Download CSV
    const date = new Date().toISOString().split('T')[0];
    const filename = `Plate_Check_Results_${date}.csv`;

    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvRows.join("\n")));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);

    // Show feedback
    const btn = document.getElementById('downloadCSVBtn');
    const originalText = btn.innerText;
    btn.innerText = '✅ Downloaded!';
    setTimeout(() => {
        btn.innerText = originalText;
    }, 2000);
});

// Event delegation for expand buttons (dynamically created)
document.addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('expand-btn')) {
        toggleViolationDetails(e.target);
    }
});

// ===== OCR EVENT HANDLERS =====

// Process image file (from upload or drag-drop)
async function processImageFile(file) {
    console.log('[OCR] Processing image file:', file.name, file.type);
    selectedImageFile = file;

    // Show loading overlay
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = loadingOverlay.querySelector('.loading-text');
    loadingOverlay.classList.add('active');

    // Show image preview
    const preview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    const reader = new FileReader();

    reader.onload = (e) => {
        previewImg.src = e.target.result;
        preview.classList.add('active');
    };

    reader.readAsDataURL(file);

    // Disable input during processing
    const plateInput = document.getElementById('plateInput');
    plateInput.disabled = true;

    try {
        // Compress image to speed up OCR
        console.log('[OCR] Compressing image...');
        loadingText.textContent = '🔄 Compressing image...';

        const compressedFile = await compressImage(file);
        console.log('[OCR] Original size:', (file.size / 1024).toFixed(2), 'KB');
        console.log('[OCR] Compressed size:', (compressedFile.size / 1024).toFixed(2), 'KB');

        // Convert to base64 for background worker
        loadingText.textContent = '📤 Sending to background processor...';
        const base64Image = await fileToBase64(compressedFile);
        const base64Data = base64Image.split(',')[1];
        const mimeType = compressedFile.type || 'image/jpeg';

        // Send to background worker for processing
        console.log('[OCR] Sending to background worker...');
        loadingText.textContent = '🔍 Scanning with AI...';

        const response = await chrome.runtime.sendMessage({
            action: 'startOCR',
            base64Image: base64Data,
            mimeType: mimeType
        });

        // Hide loading overlay
        loadingOverlay.classList.remove('active');
        loadingText.textContent = '🔍 Scanning image...';

        if (response.success) {
            console.log('[OCR] Detected', response.plates.length, 'plates');

            // Don't clear storage yet - let the modal buttons handle it
            // This ensures the user can close and reopen the popup without losing plates

            // Show verification modal
            showVerificationModal(response.plates);

            plateInput.disabled = false;
        } else {
            throw new Error(response.error);
        }

    } catch (error) {
        // Hide loading overlay
        loadingOverlay.classList.remove('active');
        loadingText.textContent = '🔍 Scanning image...';

        alert(`OCR Error: ${error.message}`);
        plateInput.disabled = false;

        // Clear preview on error
        preview.classList.remove('active');
        selectedImageFile = null;

        // Clear OCR status
        await chrome.storage.local.remove(['ocrStatus', 'ocrResults', 'ocrError', 'ocrProgress']);
    }
}

// Camera Icon - Trigger file selection
document.getElementById('cameraIcon').addEventListener('click', () => {
    console.log('[OCR] Camera icon clicked');
    document.getElementById('fileInput').click();
});

// File Input - Handle image selection
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];

    if (!file) {
        return;
    }

    console.log('[OCR] File selected:', file.name, file.type);

    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file.');
        return;
    }

    await processImageFile(file);

    // Clear file input
    e.target.value = '';
});

// Drag and Drop Handlers for Textarea
const plateInputElement = document.getElementById('plateInput');

plateInputElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[OCR] Drag over detected');
    plateInputElement.classList.add('drag-over');
});

plateInputElement.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[OCR] Drag leave detected');
    plateInputElement.classList.remove('drag-over');
});

plateInputElement.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[OCR] Drop detected');
    plateInputElement.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    console.log('[OCR] Files dropped:', files.length);

    if (files.length > 0) {
        const file = files[0];
        console.log('[OCR] File type:', file.type, 'Name:', file.name);

        if (file.type.startsWith('image/')) {
            processImageFile(file);
        } else {
            alert('Please drop an image file (JPG, PNG, etc.).');
        }
    }
});

// Verification Modal Functions
function showVerificationModal(plates) {
    const modal = document.getElementById('verifyModal');
    const detectedPlates = document.getElementById('detectedPlates');

    // Display detected plates - one per line for clean column layout
    detectedPlates.textContent = plates.join('\n');

    // Update modal title with count
    const modalTitle = modal.querySelector('.modal-title');
    modalTitle.textContent = `⚠️ Verify ${plates.length} Detected Plate${plates.length > 1 ? 's' : ''}`;

    // Show modal
    modal.classList.add('active');

    // Store plates temporarily
    modal.dataset.plates = plates.join(',');
    ocrUsed = true;
}

// Confirm Verification Button
document.getElementById('confirmVerifyBtn').addEventListener('click', async () => {
    const modal = document.getElementById('verifyModal');
    const plates = modal.dataset.plates.split(',');

    // Populate input with verified plates
    document.getElementById('plateInput').value = plates.join('\n');

    // Close modal
    modal.classList.remove('active');

    // Clear OCR status from storage now that user has interacted
    await chrome.storage.local.remove(['ocrStatus', 'ocrResults', 'ocrError', 'ocrProgress', 'ocrTimestamp']);

    // Automatically trigger check plates
    document.getElementById('checkPlatesBtn').click();
});

// Cancel Verification Button - Allow editing
document.getElementById('cancelVerifyBtn').addEventListener('click', async () => {
    const modal = document.getElementById('verifyModal');
    const plates = modal.dataset.plates.split(',');

    // Populate input with plates for manual editing
    document.getElementById('plateInput').value = plates.join('\n');

    // Close modal
    modal.classList.remove('active');

    // Clear OCR status from storage now that user has interacted
    await chrome.storage.local.remove(['ocrStatus', 'ocrResults', 'ocrError', 'ocrProgress', 'ocrTimestamp']);

    // Focus on textarea
    document.getElementById('plateInput').focus();
});

// Close modals on background click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// Check for pending/completed OCR from background worker
async function checkPendingOCR() {
    const storage = await chrome.storage.local.get(['ocrStatus', 'ocrResults', 'ocrError', 'ocrProgress']);

    if (storage.ocrStatus === 'processing') {
        // OCR is still processing in background
        console.log('[OCR] Found pending OCR, showing progress...');
        const loadingOverlay = document.getElementById('loadingOverlay');
        const loadingText = loadingOverlay.querySelector('.loading-text');
        loadingOverlay.classList.add('active');
        loadingText.textContent = storage.ocrProgress || '🔍 Scanning in background...';

        // Poll for completion
        const checkInterval = setInterval(async () => {
            const updated = await chrome.storage.local.get(['ocrStatus', 'ocrResults', 'ocrError']);

            if (updated.ocrStatus === 'completed') {
                clearInterval(checkInterval);
                loadingOverlay.classList.remove('active');
                loadingText.textContent = '🔍 Scanning with AI...';

                console.log('[OCR] Background OCR completed!');
                showVerificationModal(updated.ocrResults);

                // Don't clear status yet - wait for user to interact with modal
                // This allows popup to be closed and reopened without losing results
            } else if (updated.ocrStatus === 'error') {
                clearInterval(checkInterval);
                loadingOverlay.classList.remove('active');
                loadingText.textContent = '🔍 Scanning with AI...';

                alert(`OCR Error: ${updated.ocrError}`);

                // Clear error status
                await chrome.storage.local.remove(['ocrStatus', 'ocrResults', 'ocrError', 'ocrProgress']);
            } else if (updated.ocrProgress) {
                loadingText.textContent = updated.ocrProgress;
            }
        }, 500); // Check every 500ms
    } else if (storage.ocrStatus === 'completed') {
        // OCR completed while popup was closed
        console.log('[OCR] Found completed OCR results!');
        showVerificationModal(storage.ocrResults);

        // Don't clear status yet - wait for user to interact with modal
        // This allows popup to be closed and reopened without losing results
    } else if (storage.ocrStatus === 'error') {
        // OCR failed while popup was closed
        console.log('[OCR] Found OCR error');
        alert(`OCR Error: ${storage.ocrError}`);

        // Clear error status
        await chrome.storage.local.remove(['ocrStatus', 'ocrResults', 'ocrError', 'ocrProgress']);
    }
}

// ===== INITIALIZE =====
console.log('[Pass10x] Initializing popup...');
initializeModeToggle();
loadState(); // Load saved state on popup open

// Check for pending OCR from background worker
checkPendingOCR();

// Ensure input section is visible if no results are displayed
if (currentMode === 'check') {
    const inputSection = document.getElementById('inputSection');
    const actionButtons = document.getElementById('actionButtons');
    const checkHelpInfo = document.getElementById('checkHelpInfo');
    const resultsContainer = document.getElementById('resultsContainer');
    const minimizedInput = document.getElementById('minimizedInput');

    // If results container is hidden, make sure input section is visible
    if (resultsContainer && resultsContainer.style.display === 'none') {
        if (inputSection) inputSection.style.display = 'block';
        if (actionButtons) actionButtons.style.display = 'flex';
        if (checkHelpInfo) checkHelpInfo.style.display = 'block';
        if (minimizedInput) minimizedInput.style.display = 'none';
    }
}

console.log('[Pass10x] Popup initialized. cachedRecords:', cachedRecords ? cachedRecords.length : 0, 'cachedRawRecords:', cachedRawRecords ? cachedRawRecords.length : 0, 'cachedActivePasses:', cachedActivePasses ? cachedActivePasses.length : 0);
