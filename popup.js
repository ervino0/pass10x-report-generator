// Pass 10x Report Generator Extension
// Features: Loading state, smart token detection, forced CSV download

document.getElementById('prepPage').addEventListener('click', async () => {
    // 1. UI: Show Loading State
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
        // 2. Get Tab & Checkbox State
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const excludeWarning0 = document.getElementById('excludeWarning0').checked;
        const includeNotes = document.getElementById('includeNotes').checked;

        // 3. Inject Script
        status.innerText = "⏳ Fetching 180 days of records...";

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

                    // --- DATA FETCH ---
                    const requestBody = {
                        action: "GET_PARKPASS_FILTER",
                        data: { lockey: "20104", status: "ALL", mins: 259200, pptype: "all", "__APPVERSION__": "1.0.170" }
                    };

                    try {
                        const response = await fetch('https://b3t3jo9o62.execute-api.us-east-2.amazonaws.com/prod/yacall', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                            body: JSON.stringify(requestBody)
                        });

                        if (response.status === 401) {
                            resolve({ error: "Session Expired! Please reload the page." });
                            return;
                        }

                        let records = await response.json();
                        if (!Array.isArray(records)) {
                            records = records.body ? (typeof records.body === 'string' ? JSON.parse(records.body) : records.body) : records.data;
                        }

                        // --- PROCESSING ---
                        const toPST = (ts) => new Date(ts).toLocaleString("en-US", {
                            timeZone: "America/Los_Angeles",
                            month: 'short', day: 'numeric', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', hour12: true
                        }).replace(/,/g, "");

                        const cleanWarnings = records.filter(v => {
                            // Check for warnings (nowarn can be a number, including 0)
                            const hasWarning = v.nowarn !== null && v.nowarn !== undefined && v.nowarn !== "";

                            // Check for fines/tickets (noticket is typically a number string like "1")
                            const hasFine = v.noticket !== null && v.noticket !== undefined && v.noticket !== "";

                            // Check for tows (notow is typically a number string like "1")
                            const hasTow = v.notow !== null && v.notow !== undefined && v.notow !== "";

                            // Notes are records with no violations (no warning, fine, or tow)
                            const isNote = !hasWarning && !hasFine && !hasTow;

                            // Apply Warning# 0 or less filter if checkbox is checked (only applies to warnings)
                            const passesWarningFilter = excludeWarning0 && hasWarning && !hasFine && !hasTow ? v.nowarn > 0 : true;

                            // Include violations (warning/fine/tow) or notes if checkbox is checked
                            const includeRecord = (hasWarning || hasFine || hasTow) || (isNote && includeNotes);

                            return includeRecord && passesWarningFilter;
                        });

                        const suiteGroups = {};
                        const unregisteredGroups = {};

                        cleanWarnings.forEach(v => {
                            const s = v.suite ? v.suite.toUpperCase() : "BM01";

                            // Determine violation type - check in priority order: Tow > Fine > Warning > Note
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

                        // Collect single-hit entries with their timestamps for sorting
                        const singleHitEntries = [];
                        Object.keys(unregisteredGroups).forEach(p => {
                            if (unregisteredGroups[p].length === 1) {
                                const entry = unregisteredGroups[p][0];
                                // Store the row with its original timestamp for sorting
                                const plateRecord = cleanWarnings.find(v => v.plate === entry[1]);
                                singleHitEntries.push({
                                    row: entry,
                                    timestamp: plateRecord ? plateRecord.starttime : 0
                                });
                            }
                        });

                        // Sort by timestamp descending (most recent first)
                        singleHitEntries.sort((a, b) => b.timestamp - a.timestamp);

                        // Add sorted entries to CSV
                        singleHitEntries.forEach(entry => {
                            csvRows.push(entry.row.join(","));
                        });

                        // Stats
                        const stats = {
                            total: records.length,
                            towEligibleSuites: Object.keys(suiteGroups).filter(s => suiteGroups[s].length >= 2).length,
                            unregisteredRepeat: Object.keys(unregisteredGroups).filter(p => unregisteredGroups[p].length >= 2).length,
                            unregisteredSingle: Object.keys(unregisteredGroups).filter(p => unregisteredGroups[p].length === 1).length
                        };

                        resolve({ csvContent: csvRows.join("\n"), stats });

                    } catch (err) {
                        resolve({ error: err.message });
                    }
                });
            }
        });

        // 4. Handle Result
        const result = results[0]?.result;
        if (!result || result.error) {
            throw new Error(result?.error || "Unknown Error");
        }

        status.innerText = "✅ Generating CSV...";

        // 5. Download using Anchor Tag (Most reliable for forcing filenames)
        const date = new Date().toISOString().split('T')[0];
        const filename = `Enforcement_Report_${date}.csv`;

        // Use Data URI text/csv explicitly
        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(result.csvContent));
        element.setAttribute('download', filename);

        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);

        // Success UI
        btn.innerText = "✅ Download Complete";
        btn.style.background = "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)"; // Success Green
        status.innerHTML = `
            <span style="color:white; font-weight:bold;">Stats:</span><br>
            <div style="font-size:11px; line-height:1.4; margin-top:5px;">
            • ${result.stats.total} Total Records<br>
            • ${result.stats.towEligibleSuites} Tow Eligible Suites<br>
            • ${result.stats.unregisteredRepeat} Unregistered Plates 2+ Violations<br>
            &nbsp;&nbsp;(Tow Immediately)<br>
            • ${result.stats.unregisteredSingle} Unregistered Plates 1 Violation<br>
            &nbsp;&nbsp;(Tow Immediately)
            </div>
        `;

        // Reset button after 3 seconds
        setTimeout(() => {
            btn.disabled = false;
            btn.innerText = "📥 Fetch & Download Report";
            btn.style.opacity = "1";
        }, 3000);

    } catch (e) {
        status.innerText = "❌ Error Occurred";
        status.style.color = "#ff4757";
        alert("Error: " + e.message);

        // Reset UI
        btn.disabled = false;
        btn.innerText = "📥 Fetch & Download Report";
        btn.style.opacity = "1";
    }
});
