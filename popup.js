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
        // 2. Get Tab
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 3. Inject Script
        status.innerText = "⏳ Fetching 180 days of records...";

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
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

                        const cleanWarnings = records.filter(v =>
                            (v.nowarn !== null && v.nowarn !== undefined) &&
                            (v.noticket === null || v.noticket === "") &&
                            (v.notow === null || v.notow === "")
                        );

                        const suiteGroups = {};
                        const unregisteredGroups = {};

                        cleanWarnings.forEach(v => {
                            const s = v.suite ? v.suite.toUpperCase() : "BM01";
                            const row = [s, v.plate, toPST(v.starttime), `Warning #${v.nowarn}`, `"${(v.name || "").replace(/"/g, '""')}"`];

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
                        csvRows.push("Suite,Plate,Date/Time (PST),Warning Level,Notes");
                        Object.keys(suiteGroups).sort().forEach(s => {
                            if (suiteGroups[s].length >= 2) {
                                suiteGroups[s].forEach(line => csvRows.push(line.join(",")));
                                csvRows.push(",,,,");
                            }
                        });

                        csvRows.push("");
                        csvRows.push("SECTION 2: UNREGISTERED PLATES - REPEAT OFFENDERS (2+ HITS)");
                        csvRows.push("Suite,Plate,Date/Time (PST),Warning Level,Notes");
                        Object.keys(unregisteredGroups).sort().forEach(p => {
                            if (unregisteredGroups[p].length >= 2) {
                                unregisteredGroups[p].forEach(line => csvRows.push(line.join(",")));
                                csvRows.push(",,,,");
                            }
                        });

                        csvRows.push("");
                        csvRows.push("SECTION 3: UNREGISTERED PLATES - SINGLE HIT ONLY");
                        csvRows.push("Suite,Plate,Date/Time (PST),Warning Level,Notes");
                        Object.keys(unregisteredGroups).sort().forEach(p => {
                            if (unregisteredGroups[p].length === 1) {
                                csvRows.push(unregisteredGroups[p][0].join(","));
                            }
                        });

                        // Stats
                        const stats = {
                            total: records.length,
                            clean: cleanWarnings.length,
                            suitesOver2: Object.keys(suiteGroups).filter(s => suiteGroups[s].length >= 2).length,
                            repeat: Object.keys(unregisteredGroups).filter(p => unregisteredGroups[p].length >= 2).length
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
            <span style="color:white">Stats:</span><br>
            • ${result.stats.total} Total Records<br>
            • ${result.stats.suitesOver2} Tow Eligible Suites<br>
            • ${result.stats.repeat} Repeat Offenders
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
