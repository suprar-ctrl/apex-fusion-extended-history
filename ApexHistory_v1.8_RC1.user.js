// ==UserScript==
// @name         Apex Fusion Extended History
// @namespace    apex-history
// @version      1.8.0-rc1
// @description  Extended history for temperature, pH, ORP, alkalinity, calcium, magnesium, nitrate and phosphate
// @match        https://apexfusion.com/*
// @match        https://www.apexfusion.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const CHUNK_DAYS = 7;
    const DEFAULT_DAYS = 60;

    const PARAMS = {
        "base_Temp": {
            name: "Temperature",
            short: "Temp",
            unit: "°F",
            source: "ilog",
            digits: 1
        },
        "base_pH": {
            name: "pH",
            short: "pH",
            unit: "",
            source: "ilog",
            digits: 2
        },
        "2_0": {
            name: "Alkalinity",
            short: "Alk",
            unit: "dKH",
            source: "tlog",
            digits: 2
        },
        "2_1": {
            name: "Calcium",
            short: "Ca",
            unit: "ppm",
            source: "tlog",
            digits: 0
        },
        "2_2": {
            name: "Magnesium",
            short: "Mg",
            unit: "ppm",
            source: "tlog",
            digits: 0
        },
        "5_0": {
            name: "Phosphate",
            short: "PO4",
            unit: "ppm",
            source: "tlog",
            digits: 3
        },
        "5_1": {
            name: "Nitrate",
            short: "NO3",
            unit: "ppm",
            source: "tlog",
            digits: 1
        }
    };
    // Only water-quality probes and chemistry tests are included.
    PARAMS["base_ORP"] = {name:"ORP", short:"ORP", unit:"mV", source:"ilog", digits:0};
    // Known Classic onboard input; additional pH/temperature/ORP probes are discovered from ilog.
    PARAMS["base_pH2"] = {name:"pH 2", short:"pH2", unit:"", source:"ilog", digits:2};
    const inputLabelKey = id => `apex-history-input-labels-v1:${id}`;
    const controllerNamesKey = "apex-history-controller-names-v1";
    function safeText(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function waterProbeType(input) {
        if (!input || typeof input !== "object") return null;
        const type = String(input.type || "").trim().toLowerCase();
        if (type === "temp" || type === "temperature") return "temp";
        if (type === "ph") return "ph";
        if (type === "orp" || type === "redox") return "orp";
        // Fallback only for conventional onboard IDs, not arbitrary names.
        const did = String(input.did || "");
        if (/^base_temp\d*$/i.test(did)) return "temp";
        if (/^base_ph\d*$/i.test(did)) return "ph";
        if (/^base_orp\d*$/i.test(did)) return "orp";
        return null;
    }
    function isWaterProbe(input) { return !!waterProbeType(input); }
    function suggestedInputInfo(input, customLabels) {
        const did = String(input.did || "");
        if (!did || PARAMS[did]) return null;
        const probeType = waterProbeType(input);
        if (!probeType) return null;
        const fields = [input.name, input.label, input.title, input.displayName, input.parameterName];
        const label = fields.find(x => typeof x === "string" && x.trim()) || customLabels[did] || `Input ${did}`;
        const unit = probeType === "temp" ? "°F" : probeType === "orp" ? "mV" : "";
        return {name:label, short:label.length > 13 ? label.slice(0,12)+"…" : label, unit, source:"ilog", digits:probeType === "ph" ? 2 : probeType === "temp" ? 1 : 0};
    }
    const TARGETS = {
        "base_Temp": {
            min: 76,
            max: 77
        },
        "base_pH": {
            min: 8.00,
            max: 8.30
        },
        "2_0": {
            min: 11,
            max: 12
        },
        "2_1": {
            min: 420,
            max: 480
        },
        "2_2": {
            min: 1300,
            max: 1450
        },
        "5_0": {
            min: 0.10,
            max: 0.20
        },
        "5_1": {
            min: 5,
            max: 10
        }
    };
        const DEFAULT_TARGETS = {
        "base_Temp": { min: 76, max: 77 },
        "base_pH":   { min: 8.00, max: 8.30 },
        "2_0":       { min: 11, max: 12 },
        "2_1":       { min: 420, max: 480 },
        "2_2":       { min: 1300, max: 1450 },
        "5_0":       { min: 0.10, max: 0.20 },
        "5_1":       { min: 5, max: 10 }
    };
    const TRIDENT_KEYS = ["2_0", "2_1", "2_2", "5_0", "5_1"];
    const PARAM_LABELS = {"2_0":"Alkalinity", "2_1":"Calcium", "2_2":"Magnesium", "5_0":"Phosphate", "5_1":"Nitrate"};
    const mappingKey = id => `apex-history-mapping-v1:${id}`;
    const targetKey = id => `apex-history-targets-v2:${id}`;
    function readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch (_) { return fallback; }
    }
    function apexCandidates() {
        const found = new Map();
        for (const entry of performance.getEntriesByType("resource")) {
            const match = entry.name.match(/\/api\/apex\/([^/?#]+)\//);
            if (match) found.set(decodeURIComponent(match[1]), entry.startTime);
        }
        return [...found].sort((a,b) => b[1]-a[1]).map(x => x[0]);
    }
    function chooseApex() {
        const ids = apexCandidates();
        if (!ids.length) return null;
        if (ids.length === 1) return ids[0];
        const names = readJson(controllerNamesKey, {});
        const choices = ids.map((id, i) => `${i+1}: ${names[id] || `Controller ${i+1}`} (${id})`).join("\n");
        const reply = prompt(`Select Apex controller by number.\n\n${choices}\n\nTo name controllers, click 'Name Controllers' in the history viewer.`, "1");
        if (reply === null) return null;
        const index = Number(reply);
        return Number.isInteger(index) && index >= 1 && index <= ids.length ? ids[index-1] : null;
    }

    // Auto-discovery uses explicit Fusion measurement labels only. Numeric values
    // alone cannot reliably distinguish modules or measurement types.
    const MEASUREMENT_NAMES = {
        "2_0": ["alk", "alkalinity", "dkh"],
        "2_1": ["calcium", "ca"],
        "2_2": ["magnesium", "mg"],
        "5_0": ["phosphate", "po4"],
        "5_1": ["nitrate", "no3"]
    };
    function inferFromMetadata(item) {
        const candidates = [item.name, item.label, item.title, item.parameter,
            item.parameterName, item.testName, item.displayName, item.type, item.description, item.sensorName]
            .filter(v => typeof v === "string");
        const hits = new Set();
        for (const raw of candidates) {
            const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            for (const [canonical, words] of Object.entries(MEASUREMENT_NAMES)) {
                if (words.some(word => normalized.split(" ").includes(word))) hits.add(canonical);
            }
        }
        return hits.size === 1 ? [...hits][0] : null;
    }
    function discoverTridentIds(items, saved) {
        const votes = new Map();
        for (const item of items) {
            const id = String(item.did ?? "");
            const canonical = inferFromMetadata(item);
            if (!id || !canonical) continue;
            if (!votes.has(id)) votes.set(id, new Set());
            votes.get(id).add(canonical);
        }
        const candidates = {};
        for (const [id, values] of votes) {
            if (values.size === 1 && !Object.prototype.hasOwnProperty.call(saved, id)) {
                candidates[id] = [...values][0];
            }
        }
        // Ambiguous mappings are ignored, not guessed.
        const reverse = {};
        for (const [id, canonical] of Object.entries({...saved, ...candidates})) {
            (reverse[canonical] ||= []).push(id);
        }
        for (const [id, canonical] of Object.entries(candidates)) {
            if (reverse[canonical].length !== 1) delete candidates[id];
        }
        return candidates;
    }

    const RANGE_OPTIONS = [7, 14, 30, 60, 90];

    // ---------------------------------------------------------
    // Add Apex History button
    // ---------------------------------------------------------

    function addLauncher() {
        if (document.getElementById("apex-history-launcher")) return;

        const button = document.createElement("button");
        button.id = "apex-history-launcher";
        button.textContent = "Apex History";

        Object.assign(button.style, {
            position: "fixed",
            right: "18px",
            bottom: "18px",
            zIndex: "999998",
            background: "#e87922",
            color: "white",
            border: "1px solid #ff9b50",
            borderRadius: "6px",
            padding: "10px 16px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow: "0 3px 12px rgba(0,0,0,.45)"
        });

        button.onclick = openViewer;

        document.body.appendChild(button);
    }

    // Fusion is a dynamic application, so wait until body exists.
    if (document.body) {
        addLauncher();
    } else {
        window.addEventListener("DOMContentLoaded", addLauncher);
    }

    // ---------------------------------------------------------
    // Viewer
    // ---------------------------------------------------------

    async function openViewer() {

        const old = document.getElementById("apex-history-v2");

        if (old) {
            old.remove();
            return;
        }

        // Select the active controller; prompt when Fusion has requested multiple.
        const apexId = chooseApex();
        if (!apexId) {
            alert("Apex History could not select an Apex. Open a Fusion graph for the desired controller, then try again.");
            return;
        }
        const savedMap = readJson(mappingKey(apexId), {});
        const customInputLabels = readJson(inputLabelKey(apexId), {});
        let moduleMap = {...savedMap};
        // The status response describes this controller's configured input labels.
        // Names from Fusion are defaults; locally saved user names take precedence.
        let fusionInputs = new Map();
        let fusionOutputs = new Map();
        let fusionModules = new Map();
        async function loadFusionMetadata() {
            try {
                const response = await fetch(`/api/apex/${encodeURIComponent(apexId)}/status?_=${Date.now()}`, {
                    credentials: "same-origin", cache: "no-store"
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                fusionInputs = new Map((Array.isArray(data.inputs) ? data.inputs : [])
                    .filter(x => x && typeof x.did === "string")
                    .map(x => [x.did, x]));
                fusionOutputs = new Map((Array.isArray(data.outputs) ? data.outputs : [])
                    .filter(x => x && typeof x.did === "string")
                    .map(x => [x.did, x]));
                fusionModules = new Map((Array.isArray(data.modules) ? data.modules : [])
                    .filter(x => x && Number.isFinite(Number(x.abaddr)))
                    .map(x => [String(x.abaddr), x]));
                console.info("Apex History: Fusion input metadata loaded", fusionInputs.size);
            } catch (error) {
                // History still works if status is temporarily unavailable.
                console.warn("Apex History: status metadata unavailable; retaining manual labels", error);
            }
        }
        // Collect explicit test labels from Fusion's current controller status.
        // A DID is mapped only if exactly one test type is identified, and a
        // test type is mapped only if exactly one DID claims it.
        function discoverFromFusionStatus(saved) {
            const candidates = [];
            for (const [did, entry] of fusionInputs) {
                if (!entry || typeof entry !== "object") continue;
                const canonical = inferFromMetadata(entry);
                if (canonical && /^\d+_\d+$/.test(did)) candidates.push({did, canonical});
            }
            const counts = new Map();
            for (const {canonical} of candidates) counts.set(canonical, (counts.get(canonical) || 0) + 1);
            const result = {};
            for (const {did, canonical} of candidates) {
                if (counts.get(canonical) !== 1 || Object.prototype.hasOwnProperty.call(saved, did)) continue;
                if (Object.values(saved).includes(canonical)) continue;
                result[did] = canonical;
            }
            return result;
        }
        function applyFusionInputMetadata(did) {
            const meta = fusionInputs.get(did);
            if (!meta || !PARAMS[did]) return;
            const type = String(meta.type || "").toLowerCase();
            const units = {temp:"°F",ph:"",amps:"A",orp:"mV",cond:"µS/cm",salinity:"ppt"};
            if (Object.prototype.hasOwnProperty.call(units,type)) {
                PARAMS[did].unit = units[type];
                PARAMS[did].digits = type === "temp" || type === "amps" ? 1 : type === "ph" ? 2 : PARAMS[did].digits;
            }
            const configured = typeof meta.name === "string" ? meta.name.trim() : "";
            const name = customInputLabels[did] || configured || PARAMS[did].name;
            PARAMS[did].name = name;
            PARAMS[did].short = name.length > 13 ? name.slice(0,12) + "…" : name;
        }

        // Preserve the old targets only on the original installation; new installs
        // use editable neutral defaults, not one aquarist's preferred chemistry.
        let perApexTargets = readJson(targetKey(apexId), null);
        // One-time migration of the existing user's customized target ranges.
        if (!perApexTargets) {
            const legacy = readJson("apex-history-targets", null);
            if (legacy) {
                perApexTargets = legacy;
                localStorage.setItem(targetKey(apexId), JSON.stringify(legacy));
            }
        }
        for (const did of Object.keys(TARGETS)) {
            const saved = perApexTargets?.[did];
            if (saved && Number.isFinite(+saved.min) && Number.isFinite(+saved.max) && +saved.min < +saved.max) {
                TARGETS[did] = {min:+saved.min, max:+saved.max};
            } else {
                // No default target band is shown until explicitly configured.
                delete TARGETS[did];
            }
        }

        const overlay = document.createElement("div");
        overlay.id = "apex-history-v2";

        Object.assign(overlay.style, {
            position: "fixed",
            inset: "12px",
            zIndex: "999999",
            background: "#15191d",
            color: "#eee",
            border: "1px solid #555",
            borderRadius: "8px",
            padding: "16px",
            fontFamily: "Arial, sans-serif",
            overflow: "auto",
            boxShadow: "0 8px 40px rgba(0,0,0,.65)"
        });

        document.body.appendChild(overlay);

        overlay.innerHTML = `
        <div style="
            display:flex;
            justify-content:space-between;
            align-items:flex-start;
            flex-wrap:wrap;
            gap:12px;
            margin-bottom:14px;
        ">
            <div>
                <div style="font-size:23px;font-weight:bold">
                    Apex History Viewer
                </div>

                <div id="ah-status"
                     style="font-size:13px;color:#aaa;margin-top:4px">
                    Initializing...
                </div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button id="ah-targets">Targets</button>
    <button id="ah-modules">Map Modules</button>
    <button id="ah-names">Name Controllers</button>
    <button id="ah-inputs">Name Inputs</button>
    <button id="ah-export">Export CSV</button>
    <button id="ah-close">Close</button>
</div>
        </div>

        <div style="margin-bottom:12px">
            <div style="
                font-size:11px;
                color:#aaa;
                margin-bottom:5px;
                text-transform:uppercase;
            ">
                History range
            </div>

            <div id="ah-ranges"
                 style="display:flex;gap:6px;flex-wrap:wrap">
            </div>
        </div>

        <div style="margin-bottom:12px">
            <div style="
                font-size:11px;
                color:#aaa;
                margin-bottom:5px;
                text-transform:uppercase;
            ">
                Parameter
            </div>

            <div id="ah-params"
                 style="display:flex;gap:6px;flex-wrap:wrap">
            </div>
        </div>

        <div style="
            display:flex;
            align-items:center;
            gap:10px;
            flex-wrap:wrap;
            margin-bottom:12px;
        ">
            <label style="
                display:flex;
                align-items:center;
                gap:6px;
                cursor:pointer;
            ">
                <input id="ah-compare-check" type="checkbox">
                Compare with
            </label>

            <select id="ah-compare-select"
                    disabled
                    style="
                        background:#272c30;
                        color:#fff;
                        border:1px solid #666;
                        padding:7px;
                        border-radius:4px;
                    ">
            </select>
        </div>

        <div style="
            position:relative;
            background:#0d1013;
            border:1px solid #444;
            padding:10px;
            border-radius:6px;
        ">
            <canvas id="ah-chart"
                    style="
                        display:block;
                        width:100%;
                        height:520px;
                        cursor:crosshair;
                    ">
            </canvas>

            <div id="ah-tooltip"
                 style="
                    display:none;
                    position:absolute;
                    pointer-events:none;
                    background:rgba(20,23,26,.96);
                    color:#fff;
                    border:1px solid #777;
                    border-radius:5px;
                    padding:8px 10px;
                    font-size:12px;
                    white-space:nowrap;
                    z-index:5;
                 ">
            </div>
        </div>

        <div id="ah-legend"
             style="
                display:flex;
                gap:18px;
                margin-top:9px;
                font-size:12px;
                color:#bbb;
                flex-wrap:wrap;
             ">
        </div>

        <div id="ah-stats"
             style="
                margin-top:14px;
                display:flex;
                gap:10px;
                flex-wrap:wrap;
             ">
        </div>
        `;

        overlay.querySelectorAll("button").forEach(btn => {
            Object.assign(btn.style, {
                background: "#333",
                color: "#fff",
                border: "1px solid #666",
                borderRadius: "4px",
                padding: "8px 12px",
                cursor: "pointer"
            });
        });

        const status = overlay.querySelector("#ah-status");
        const canvas = overlay.querySelector("#ah-chart");
        const ctx = canvas.getContext("2d");
        const tooltip = overlay.querySelector("#ah-tooltip");

        overlay.querySelector("#ah-names").onclick = () => {
            const ids = apexCandidates();
            const names = readJson(controllerNamesKey, {});
            for (const id of ids) {
                const value = prompt(`Friendly name for controller\n${id}\n(leave blank to retain current name)`, names[id] || "");
                if (value !== null && value.trim()) names[id] = value.trim().slice(0,100);
            }
            localStorage.setItem(controllerNamesKey, JSON.stringify(names));
            alert("Controller names saved. They will appear next time you select an Apex.");
        };
        // Bulk input editor: one modal, searchable rows, one atomic save.
        overlay.querySelector("#ah-inputs").onclick = () => {
            if (overlay.querySelector("#ah-input-editor")) return;
            const modal = document.createElement("div");
            modal.id = "ah-input-editor";
            modal.style.cssText = "position:fixed;inset:4vh 6vw;z-index:1000003;background:#1b2024;color:#eee;border:1px solid #666;border-radius:9px;padding:18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 45px #000;";
            const heading = document.createElement("h2");
            heading.textContent = "Name Inputs — " + (readJson(controllerNamesKey, {})[apexId] || apexId);
            heading.style.cssText = "margin:0;font-size:20px";
            const note = document.createElement("div");
            note.textContent = "Edit any number of labels, then Save All. IDs are controller-specific. Fusion input names are loaded automatically; manual labels override them. Outlet-to-power-channel associations require separate verification.";
            note.style.cssText = "color:#bbb;font-size:12px";
            const search = document.createElement("input");
            search.placeholder = "Filter by ID or name...";
            search.style.cssText = "padding:9px;background:#282e34;color:#fff;border:1px solid #666;border-radius:4px";
            const list = document.createElement("div");
            list.style.cssText = "overflow:auto;flex:1;min-height:0";
            const rows = [];
            const ids = Object.keys(PARAMS).filter(id => PARAMS[id].source === "ilog" && availableDids.has(id));
            ids.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
            for (const id of ids) {
                const line = document.createElement("div");
                line.style.cssText = "display:grid;grid-template-columns:minmax(110px,1fr) minmax(170px,2fr);align-items:center;gap:12px;padding:5px 0;border-bottom:1px solid #333";
                const label = document.createElement("label");
                label.textContent = id;
                label.style.cssText = "font-family:monospace;color:#bbb;overflow-wrap:anywhere";
                const input = document.createElement("input");
                input.value = customInputLabels[id] || (fusionInputs.get(id)?.name || PARAMS[id].name);
                input.maxLength = 100;
                input.style.cssText = "width:100%;box-sizing:border-box;background:#292f35;color:#fff;border:1px solid #666;padding:7px;border-radius:4px";
                line.append(label,input); list.append(line);
                rows.push({id,line,input});
            }
            search.oninput = () => {
                const q = search.value.toLowerCase().trim();
                for (const {id,line,input} of rows) line.style.display = (id.toLowerCase().includes(q) || input.value.toLowerCase().includes(q)) ? "grid" : "none";
            };
            const footer = document.createElement("div");
            footer.style.cssText = "display:flex;justify-content:flex-end;gap:10px";
            const cancel = document.createElement("button"); cancel.textContent = "Cancel";
            const save = document.createElement("button"); save.textContent = "Save All";
            for (const button of [cancel,save]) button.style.cssText = "padding:9px 16px;background:#363c43;color:white;border:1px solid #777;border-radius:4px;cursor:pointer";
            save.style.background = "#a94f13";
            cancel.onclick = () => modal.remove();
            save.onclick = () => {
                const updated = {...customInputLabels};
                for (const {id,input} of rows) {
                    const name = input.value.trim();
                    if (!name) { alert("A name cannot be blank: " + id); input.focus(); return; }
                    updated[id] = name;
                }
                try { localStorage.setItem(inputLabelKey(apexId), JSON.stringify(updated)); }
                catch (error) { alert("Could not save names: " + error.message); return; }
                Object.assign(customInputLabels, updated);
                for (const {id} of rows) {
                    PARAMS[id].name = updated[id];
                    PARAMS[id].short = updated[id].length > 13 ? updated[id].slice(0,12) + "…" : updated[id];
                }
                modal.remove();
                syncParameterButtons();
                applyParameterFilter();
                populateCompare();
                draw();
            };
            footer.append(cancel,save);
            modal.append(heading,note,search,list,footer);
            overlay.append(modal);
            search.focus();
        };
        let currentDays = DEFAULT_DAYS;
        let selected = "base_Temp";
        let compareEnabled = false;
        let compareSelected = "base_pH";

        let records = [];
        let visiblePoints = [];

        const cache = new Map();
        let historyRequestGeneration = 0;
        let availableDids = new Set();
        let lastRawTlog = [];
        const canonicalFor = rawDid => {
            if (moduleMap[rawDid] && PARAMS[moduleMap[rawDid]]) return moduleMap[rawDid];
            // Legacy addresses remain a fallback for installations already using them.
            // Never override an explicitly discovered or manually mapped parameter.
            if (TRIDENT_KEYS.includes(rawDid) && !Object.values(moduleMap).includes(rawDid)) return rawDid;
            return null;
        };
        function applyParameterFilter() {
            paramsDiv.querySelectorAll("button").forEach(btn => {
                btn.style.display = PARAMS[btn.dataset.did] ? "" : "none";
            });
        }
        function syncParameterButtons() {
            for (const [did, info] of Object.entries(PARAMS)) {
                let btn = [...paramsDiv.querySelectorAll("button")].find(b => b.dataset.did === did);
                if (!btn) {
                    btn = document.createElement("button");
                    btn.dataset.did = did;
                    btn.onclick = () => {
                        selected = did;
                        if (compareSelected === selected) compareSelected = Object.keys(PARAMS).find(x => x !== selected) || selected;
                        updateParamButtons(); populateCompare(); draw();
                    };
                    paramsDiv.appendChild(btn);
                }
                btn.textContent = info.short;
                btn.title = info.name + " (" + did + ")";
            }
            applyParameterFilter();
        }
        function refreshParamAvailability() {
            syncParameterButtons();
            paramsDiv.querySelectorAll("button").forEach(btn => {
                const available = availableDids.has(btn.dataset.did);
                btn.disabled = !available;
                btn.style.opacity = available ? "1" : "0.35";
                btn.title = available ? "" : "No readings found for this parameter";
            });
            if (!availableDids.has(selected)) selected = [...availableDids][0] || "base_Temp";
            updateParamButtons();
            populateCompare();
        }
        function openModuleEditor() {
            const rawIds = [...new Set(lastRawTlog.map(x=>String(x.did)).filter(Boolean))].sort();
            if (!rawIds.length) { alert("No Trident measurements were found in the loaded history. Try a longer date range."); return; }
            const existing = overlay.querySelector("#ah-module-editor");
            if (existing) { existing.remove(); return; }
            const editor = document.createElement("div");
            editor.id = "ah-module-editor";
            Object.assign(editor.style, {position:"fixed",left:"50%",top:"50%",transform:"translate(-50%,-50%)",zIndex:"1000002",background:"#1b2024",color:"white",border:"1px solid #666",borderRadius:"8px",padding:"18px",width:"440px",maxWidth:"90vw",maxHeight:"80vh",overflow:"auto"});
            const title = document.createElement("h3");
            title.textContent = "Assign Trident measurement IDs";
            editor.append(title);
            const note = document.createElement("p");
            note.textContent = "v1.2 attempts automatic mapping only when Fusion supplies unambiguous measurement labels. Otherwise choose the correct parameter using your Fusion module configuration. Never guess from values alone.";
            editor.append(note);
            for (const id of rawIds) {
                const row = document.createElement("div");
                row.style.cssText = "display:flex;justify-content:space-between;gap:12px;margin:8px 0;align-items:center";
                const label = document.createElement("label");
                label.textContent = `${id} (latest: ${lastRawTlog.filter(x=>String(x.did)===id).slice(-1)[0]?.value ?? "?"})`;
                const select = document.createElement("select");
                select.dataset.rawDid = id;
                select.style.cssText = "background:#252a30;color:white;padding:6px";
                const choices = [["", "Unassigned"], ...TRIDENT_KEYS.map(key=>[key, PARAM_LABELS[key]])];
                for (const [value, name] of choices) {
                    const opt = document.createElement("option"); opt.value=value; opt.textContent=name;
                    if ((moduleMap[id] || (TRIDENT_KEYS.includes(id) ? id : "")) === value) opt.selected=true;
                    select.append(opt);
                }
                row.append(label,select); editor.append(row);
            }
            const save = document.createElement("button"); save.textContent="Save mapping";
            const cancel = document.createElement("button"); cancel.textContent="Cancel";
            for (const b of [save,cancel]) { b.style.cssText="margin:10px 8px 0 0;padding:8px;background:#444;color:white;border:1px solid #777"; editor.append(b); }
            cancel.onclick=()=>editor.remove();
            save.onclick=()=>{
                const updated={}; const used=new Set();
                for (const el of editor.querySelectorAll("select")) {
                    if (!el.value) continue;
                    if (used.has(el.value)) { alert("Each parameter can only be assigned once."); return; }
                    used.add(el.value); updated[el.dataset.rawDid]=el.value;
                }
                moduleMap=updated;
                localStorage.setItem(mappingKey(apexId), JSON.stringify(moduleMap));
                editor.remove(); cache.clear(); loadHistory(currentDays);
            };
            overlay.append(editor);
        }
        overlay.querySelector("#ah-modules").onclick = openModuleEditor;

        // -----------------------------------------------------
        // Range buttons
        // -----------------------------------------------------

        const rangesDiv = overlay.querySelector("#ah-ranges");

        for (const d of RANGE_OPTIONS) {
            const btn = document.createElement("button");

            btn.textContent = `${d} days`;

            btn.dataset.days = d;

            btn.onclick = async () => {
                currentDays = d;
                updateRangeButtons();
                await loadHistory(d);
            };

            rangesDiv.appendChild(btn);
        }

        function updateRangeButtons() {
            rangesDiv.querySelectorAll("button").forEach(btn => {
                btn.style.background =
                    Number(btn.dataset.days) === currentDays
                        ? "#e87922"
                        : "#333";
            });
        }

        // -----------------------------------------------------
        // Parameter buttons
        // -----------------------------------------------------

        const paramsDiv = overlay.querySelector("#ah-params");

        for (const [did, info] of Object.entries(PARAMS)) {
            const btn = document.createElement("button");

            btn.textContent = info.short;
            btn.dataset.did = did;

            btn.onclick = () => {
                selected = did;

                if (compareSelected === selected) {
                    const alternative =
                        Object.keys(PARAMS).find(x => x !== selected);

                    if (alternative) {
                        compareSelected = alternative;
                    }
                }

                updateParamButtons();
                populateCompare();
                draw();
            };

            paramsDiv.appendChild(btn);
        }

        function updateParamButtons() {
            paramsDiv.querySelectorAll("button").forEach(btn => {
                btn.style.background =
                    btn.dataset.did === selected
                        ? "#e87922"
                        : "#333";
            });
        }

        // -----------------------------------------------------
        // Compare
        // -----------------------------------------------------

        const compareCheck =
            overlay.querySelector("#ah-compare-check");

        const compareSelect =
            overlay.querySelector("#ah-compare-select");

        function populateCompare() {
            compareSelect.innerHTML = "";

            for (const [did, info] of Object.entries(PARAMS)) {

                if (did === selected) continue;

                const option = document.createElement("option");

                option.value = did;
                option.textContent = info.name;

                if (did === compareSelected) {
                    option.selected = true;
                }

                compareSelect.appendChild(option);
            }

            if (!compareSelect.value &&
                compareSelect.options.length) {

                compareSelected =
                    compareSelect.options[0].value;
            }
        }

        compareCheck.onchange = () => {
            compareEnabled = compareCheck.checked;
            compareSelect.disabled = !compareEnabled;
            draw();
        };

        compareSelect.onchange = () => {
            compareSelected = compareSelect.value;
            draw();
        };

        // -----------------------------------------------------
        // Download history
        // -----------------------------------------------------

        async function loadHistory(days) {
            const requestGeneration = ++historyRequestGeneration;
            tooltip.style.display = "none";

            if (cache.has(days)) {
                records = cache.get(days);
                availableDids = new Set(records.map(x=>x.did));
                refreshParamAvailability();

                status.textContent =
                    `${days} days • ` +
                    `${records.length.toLocaleString()} measurements`;

                draw();
                return;
            }

            // Keep the last successful graph visible until this range finishes loading.
            const rawTlog = [];
            const rawIlog = [];

            let remaining = days;
            let endDate = new Date();

            const totalRequests =
                Math.ceil(days / CHUNK_DAYS);

            let requestNo = 0;

            while (remaining > 0) {

                const chunk =
                    Math.min(CHUNK_DAYS, remaining);

                requestNo++;

                status.textContent =
                    `Loading ${days} days — ` +
                    `request ${requestNo} of ${totalRequests} ` +
                    `(${Math.round((requestNo - 1) / totalRequests * 100)}%)`;

                const params = new URLSearchParams();

                params.append("names[]", "tlog");
                params.append("names[]", "ilog");

                params.set("days", chunk);
                params.set("date", endDate.toISOString());

                const url =
                    `/api/apex/${apexId}/logs?${params.toString()}`;

                try {

                    // Retry temporary Fusion/server failures without retrying authorization errors.
                    let data;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        if (requestGeneration !== historyRequestGeneration) return;
                        const response = await fetch(url, {credentials:"same-origin"});
                        if (response.ok) {
                            data = await response.json();
                            break;
                        }
                        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
                            throw new Error(`HTTP ${response.status}`);
                        }
                        status.textContent = `Fusion temporarily unavailable — retry ${attempt + 1} of 2`;
                        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
                    }
                    if (requestGeneration !== historyRequestGeneration) return;

                    if (data.tlog &&
                        Array.isArray(data.tlog.items)) {

                        rawTlog.push(...data.tlog.items);
                    }

                    if (data.ilog &&
                        Array.isArray(data.ilog.items)) {

                        rawIlog.push(...data.ilog.items);
                    }

                } catch (err) {
                    if (requestGeneration !== historyRequestGeneration) return;
                    const message = /HTTP (401|403)/.test(err.message)
                        ? "Fusion authorization expired. Sign in again and retry."
                        : /HTTP 404/.test(err.message)
                        ? "Controller history endpoint unavailable. Verify the selected Apex."
                        : `Fusion request failed: ${err.message}. Check your connection and retry.`;
                    status.textContent = `${message} Previous graph retained.`;
                    return;
                }

                remaining -= chunk;

                endDate = new Date(
                    endDate.getTime() -
                    chunk * 24 * 60 * 60 * 1000
                );

                await new Promise(
                    resolve => setTimeout(resolve, 175)
                );
            }

            if (requestGeneration !== historyRequestGeneration) return;
            status.textContent = `Processing ${days} days of measurements (100%)…`;
            lastRawTlog = rawTlog;
            // User-assigned mappings always win. Live status labels take priority
            // over historical log labels; auto mappings are session-only so a
            // renamed or replaced module is rediscovered on the next opening.
            const statusDiscovered = discoverFromFusionStatus(savedMap);
            const logDiscovered = discoverTridentIds(rawTlog, {...savedMap, ...statusDiscovered});
            const autoMap = {...logDiscovered, ...statusDiscovered};
            moduleMap = {...autoMap, ...savedMap};
            if (Object.keys(autoMap).length) {
                console.info("Apex History: explicit-label Trident discovery:", autoMap);
            }
            const combined = [];

            // Trident
            for (const item of rawTlog) {

                const canonicalDid = canonicalFor(String(item.did));
                if (!canonicalDid) continue;

                if (item.value === undefined ||
                    item.value === null) continue;

                combined.push({
                    date: item.date,
                    did: canonicalDid,
                    value: Number(item.value),
                    source: "tlog"
                });
            }

            // Discover every logged input, without guessing its measurement type from values.
            for (const item of rawIlog) {
                if (!Array.isArray(item.inputs)) continue;
                for (const input of item.inputs) {
                    const did = String(input.did || "");
                    if (!did) continue;
                    if (!PARAMS[did]) {
                        const info = suggestedInputInfo(fusionInputs.get(did) || input, customInputLabels);
                        if (info) PARAMS[did] = info;
                    }
                    // Fusion status provides authoritative configured names and types.
                    applyFusionInputMetadata(did);
                    if (customInputLabels[did] && !fusionInputs.has(did) && PARAMS[did]) {
                        PARAMS[did].name = customInputLabels[did];
                        PARAMS[did].short = customInputLabels[did].slice(0,13);
                    }
                }
            }
            // All known and newly discovered ilog inputs.
            for (const item of rawIlog) {

                if (!item.date ||
                    !Array.isArray(item.inputs)) continue;

                for (const input of item.inputs) {

                    if (!PARAMS[input.did]) continue;
                    if (PARAMS[input.did].source !== "ilog") continue;
                    if (!isWaterProbe(fusionInputs.get(String(input.did)) || input)) continue;

                    if (input.value === undefined ||
                        input.value === null) continue;

                    combined.push({
                        date: item.date,
                        did: input.did,
                        value: Number(input.value),
                        source: "ilog"
                    });
                }
            }

            // Deduplicate
            const unique = new Map();

            for (const r of combined) {

                if (!r.date ||
                    !Number.isFinite(r.value)) continue;

                const key =
                    `${r.date}|${r.did}|${r.value}`;

                if (!unique.has(key)) {
                    unique.set(key, r);
                }
            }

            records =
                [...unique.values()].sort(
                    (a, b) =>
                        new Date(a.date) -
                        new Date(b.date)
                );

            availableDids = new Set(records.map(x=>x.did));
            refreshParamAvailability();
            cache.set(days, records);

            status.textContent =
                `${days} days • ` +
                `${records.length.toLocaleString()} measurements`;

            draw();
        }

        // -----------------------------------------------------
        // Helpers
        // -----------------------------------------------------

        function valuesFor(did) {
            return records.filter(r => r.did === did);
        }

        function fmtValue(value, did) {

            const p = PARAMS[did];

            const n =
                Number(value).toFixed(p.digits);

            return p.unit
                ? `${n} ${p.unit}`
                : n;
        }

        function niceRange(values) {

            let min = Math.min(...values);
            let max = Math.max(...values);

            if (min === max) {
                const amount =
                    Math.abs(min || 1) * 0.05 || 1;

                min -= amount;
                max += amount;
            }

            const range = max - min;

            min -= range * 0.08;
            max += range * 0.08;

            return { min, max };
        }

        // -----------------------------------------------------
        // Draw graph
        // -----------------------------------------------------

        function draw() {

            tooltip.style.display = "none";
            visiblePoints = [];

            const first = valuesFor(selected);

            if (!first.length) {

                ctx.clearRect(
                    0, 0,
                    canvas.width,
                    canvas.height
                );

                status.textContent = `${currentDays} days • No ${PARAMS[selected].name} data. Use Map Modules if Trident IDs differ.`;

                return;
            }

            const second =
                compareEnabled
                    ? valuesFor(compareSelected)
                    : [];

            const rect =
                canvas.getBoundingClientRect();

            const dpr =
                window.devicePixelRatio || 1;

            canvas.width =
                Math.max(800, rect.width * dpr);

            canvas.height =
                520 * dpr;

            ctx.setTransform(
                dpr, 0, 0, dpr, 0, 0
            );

            const W = canvas.width / dpr;
            const H = canvas.height / dpr;

            ctx.clearRect(0, 0, W, H);

            const pad = {
                left: 75,
                right: compareEnabled ? 75 : 25,
                top: 34,
                bottom: 58
            };

            const plotW =
                W - pad.left - pad.right;

            const plotH =
                H - pad.top - pad.bottom;

            const cutoff =
                Date.now() -
                currentDays * 86400000;

            const allTimes = [
                ...first.map(
                    x => new Date(x.date).getTime()
                ),
                ...second.map(
                    x => new Date(x.date).getTime()
                )
            ];

            let tMin = Math.min(...allTimes);
            let tMax = Math.max(...allTimes);

            tMin = Math.min(tMin, cutoff);
            tMax = Math.max(tMax, Date.now());

                const firstValues =
                first.map(x => x.value);

            const firstTarget =
                TARGETS[selected];

            if (firstTarget) {
                firstValues.push(
                    firstTarget.min,
                    firstTarget.max
                );
            }

            const firstRange =
                niceRange(firstValues);

                      let secondRange = null;

            if (compareEnabled && second.length) {

                const secondValues =
                    second.map(x => x.value);

                const secondTarget =
                    TARGETS[compareSelected];

                if (secondTarget) {
                    secondValues.push(
                        secondTarget.min,
                        secondTarget.max
                    );
                }

                secondRange =
                    niceRange(secondValues);
            }

            const xScale = t =>
                pad.left +
                ((t - tMin) /
                (tMax - tMin || 1)) *
                plotW;

            const yScale1 = v =>
                pad.top +
                (1 -
                (v - firstRange.min) /
                (firstRange.max -
                 firstRange.min)) *
                plotH;

            const yScale2 = v => {

                if (!secondRange) return 0;

                return pad.top +
                    (1 -
                    (v - secondRange.min) /
                    (secondRange.max -
                     secondRange.min)) *
                    plotH;
            };

            ctx.fillStyle = "#0d1013";
            ctx.fillRect(0, 0, W, H);
                        // -------------------------------------------------
            // Target range shaded area
            // -------------------------------------------------

            const target = TARGETS[selected];

            if (target) {

                const targetTop = yScale1(target.max);
                const targetBottom = yScale1(target.min);

                ctx.save();

                // Keep shading inside the graph area
                ctx.beginPath();
                ctx.rect(
                    pad.left,
                    pad.top,
                    plotW,
                    plotH
                );
                ctx.clip();

                // Shaded target range
                ctx.fillStyle = "rgba(60, 190, 100, 0.14)";

                ctx.fillRect(
                    pad.left,
                    targetTop,
                    plotW,
                    targetBottom - targetTop
                );

                // Target maximum line
                ctx.strokeStyle = "rgba(80, 220, 120, 0.55)";
                ctx.lineWidth = 1;
                ctx.setLineDash([6, 5]);

                ctx.beginPath();
                ctx.moveTo(pad.left, targetTop);
                ctx.lineTo(
                    W - pad.right,
                    targetTop
                );
                ctx.stroke();

                // Target minimum line
                ctx.beginPath();
                ctx.moveTo(pad.left, targetBottom);
                ctx.lineTo(
                    W - pad.right,
                    targetBottom
                );
                ctx.stroke();

                ctx.setLineDash([]);
                ctx.restore();
            }
                        // -------------------------------------------------
            // Comparison target range shaded area
            // -------------------------------------------------

            if (
                compareEnabled &&
                second.length &&
                secondRange
            ) {

                const compareTarget =
                    TARGETS[compareSelected];

                if (compareTarget) {

                    const targetTop2 =
                        yScale2(compareTarget.max);

                    const targetBottom2 =
                        yScale2(compareTarget.min);

                    ctx.save();

                    // Keep shading inside graph area
                    ctx.beginPath();
                    ctx.rect(
                        pad.left,
                        pad.top,
                        plotW,
                        plotH
                    );
                    ctx.clip();

                    // Blue shaded comparison target
                    ctx.fillStyle =
                        "rgba(60, 150, 255, 0.10)";

                    ctx.fillRect(
                        pad.left,
                        targetTop2,
                        plotW,
                        targetBottom2 - targetTop2
                    );

                    // Comparison target maximum
                    ctx.strokeStyle =
                        "rgba(85, 183, 255, 0.50)";

                    ctx.lineWidth = 1;
                    ctx.setLineDash([6, 5]);

                    ctx.beginPath();
                    ctx.moveTo(
                        pad.left,
                        targetTop2
                    );
                    ctx.lineTo(
                        W - pad.right,
                        targetTop2
                    );
                    ctx.stroke();

                    // Comparison target minimum
                    ctx.beginPath();
                    ctx.moveTo(
                        pad.left,
                        targetBottom2
                    );
                    ctx.lineTo(
                        W - pad.right,
                        targetBottom2
                    );
                    ctx.stroke();

                    ctx.setLineDash([]);
                    ctx.restore();
                }
            }

            // Grid

            // Grid
            ctx.font = "12px Arial";

            // Grid
            ctx.font = "12px Arial";
            ctx.textBaseline = "middle";

            for (let i = 0; i <= 5; i++) {

                const y =
                    pad.top +
                    (plotH / 5) * i;

                ctx.strokeStyle = "#303438";
                ctx.lineWidth = 1;

                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(
                    W - pad.right, y
                );
                ctx.stroke();

                const value1 =
                    firstRange.max -
                    ((firstRange.max -
                      firstRange.min) / 5) * i;

                ctx.textAlign = "right";
                ctx.fillStyle = "#bbb";

                ctx.fillText(
                    Number(value1).toFixed(
                        PARAMS[selected].digits
                    ),
                    pad.left - 9,
                    y
                );

                if (compareEnabled &&
                    secondRange) {

                    const value2 =
                        secondRange.max -
                        ((secondRange.max -
                          secondRange.min) / 5) * i;

                    ctx.textAlign = "left";

                    ctx.fillText(
                        Number(value2).toFixed(
                            PARAMS[
                                compareSelected
                            ].digits
                        ),
                        W - pad.right + 9,
                        y
                    );
                }
            }

            // X axis
            const ticks =
                currentDays <= 7 ? 7 :
                currentDays <= 30 ? 6 :
                currentDays <= 90 ? 6 :
                8;

            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            for (let i = 0; i <= ticks; i++) {

                const f = i / ticks;

                const t =
                    tMin +
                    (tMax - tMin) * f;

                const x =
                    pad.left +
                    plotW * f;

                ctx.strokeStyle = "#25292c";

                ctx.beginPath();
                ctx.moveTo(x, pad.top);
                ctx.lineTo(
                    x,
                    H - pad.bottom
                );
                ctx.stroke();

                const d = new Date(t);

                ctx.fillStyle = "#aaa";

                ctx.fillText(
                    d.toLocaleDateString(
                        undefined,
                        {
                            month: "short",
                            day: "numeric"
                        }
                    ),
                    x,
                    H - pad.bottom + 12
                );
            }

            // Titles
            ctx.font = "bold 14px Arial";
            ctx.textBaseline = "top";

            ctx.textAlign = "left";
            ctx.fillStyle = "#ff8a2b";

            ctx.fillText(
                `${PARAMS[selected].name}` +
                (
                    PARAMS[selected].unit
                        ? ` (${PARAMS[selected].unit})`
                        : ""
                ),
                pad.left,
                7
            );

            if (compareEnabled &&
                second.length) {

                ctx.textAlign = "right";
                ctx.fillStyle = "#59b8ff";

                ctx.fillText(
                    `${PARAMS[compareSelected].name}` +
                    (
                        PARAMS[
                            compareSelected
                        ].unit
                            ? ` (${PARAMS[compareSelected].unit})`
                            : ""
                    ),
                    W - pad.right,
                    7
                );
            }

            function drawSeries(
                points,
                yScale,
                color,
                did
            ) {

                if (!points.length) return;

                ctx.strokeStyle = color;
                ctx.lineWidth = 2;

                ctx.beginPath();

                let started = false;

                for (const p of points) {

                    const x =
                        xScale(
                            new Date(
                                p.date
                            ).getTime()
                        );

                    const y =
                        yScale(p.value);

                    if (!started) {
                        ctx.moveTo(x, y);
                        started = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }

                ctx.stroke();

                ctx.fillStyle = color;

                const radius =
                    points.length > 500
                        ? 1.2
                        : points.length > 200
                        ? 1.7
                        : 2.5;

                for (const p of points) {

                    const x =
                        xScale(
                            new Date(
                                p.date
                            ).getTime()
                        );

                    const y =
                        yScale(p.value);

                    ctx.beginPath();
                    ctx.arc(
                        x, y,
                        radius,
                        0,
                        Math.PI * 2
                    );
                    ctx.fill();

                    visiblePoints.push({
                        x,
                        y,
                        record: p,
                        did
                    });
                }
            }

            drawSeries(
                first,
                yScale1,
                "#ff7a1a",
                selected
            );

            if (
                compareEnabled &&
                second.length &&
                secondRange
            ) {

                drawSeries(
                    second,
                    yScale2,
                    "#55b7ff",
                    compareSelected
                );
            }

            updateStats(first, second);
            updateLegend(second.length > 0);
        }

        // -----------------------------------------------------
        // Statistics
        // -----------------------------------------------------

        function updateStats(first, second) {

            const stats =
                overlay.querySelector("#ah-stats");

            function summarize(points, did) {

                if (!points.length) return "";

                const values =
                    points.map(x => x.value);

                const avg =
                    values.reduce(
                        (a, b) => a + b,
                        0
                    ) / values.length;

                const latest =
                    points[points.length - 1];
                                             const target =
                    TARGETS[did];

                let belowTargetPercent = null;
                let inTargetPercent = null;
                let aboveTargetPercent = null;

                if (target) {

                    const belowTargetCount =
                        values.filter(value =>
                            value < target.min
                        ).length;

                    const inTargetCount =
                        values.filter(value =>
                            value >= target.min &&
                            value <= target.max
                        ).length;

                    const aboveTargetCount =
                        values.filter(value =>
                            value > target.max
                        ).length;

                    belowTargetPercent =
                        (
                            belowTargetCount /
                            values.length *
                            100
                        );

                    inTargetPercent =
                        (
                            inTargetCount /
                            values.length *
                            100
                        );

                    aboveTargetPercent =
                        (
                            aboveTargetCount /
                            values.length *
                            100
                        );
                }
                let latestAccent = null;

                if (target) {

                    if (latest.value < target.min) {

                        latestAccent = "#55b7ff";

                    } else if (latest.value > target.max) {

                        latestAccent = "#ff704d";

                    } else {

                        latestAccent = "#4fd17a";
                    }
                }
                const card =
                    (label, value, accent) => `
                    <div style="
                       background:${accent ? `${accent}18` : "#22272b"};
                       border:1px solid ${accent || "#444"};
                        padding:9px 12px;
                        border-radius:5px;
                        min-width:115px;
                    ">
                        <div style="
                            color:#aaa;
                            font-size:10px;
                            text-transform:uppercase;
                        ">
                            ${label}
                        </div>

                        <div style="
                            font-size:18px;
                            margin-top:3px;
                        ">
                            ${value}
                        </div>
                    </div>
                `;

                return `
                    <div style="
                        width:100%;
                        font-size:13px;
                        font-weight:bold;
                        margin-top:5px;
                    ">
                        ${PARAMS[did].name}
                    </div>

                    ${card(
                        "Latest",
                        fmtValue(
                            latest.value,
                            did
                        ),latestAccent
                    )}

                    ${card(
                        "Average",
                        fmtValue(avg, did)
                    )}

                    ${card(
                        "Minimum",
                        fmtValue(
                            Math.min(...values),
                            did
                        )
                    )}

                    ${card(
                        "Maximum",
                        fmtValue(
                            Math.max(...values),
                            did
                        )
                    )}
                                        ${
                        inTargetPercent !== null
                            ? `
                                ${card(
                                    "Below Target",
                                    `${belowTargetPercent.toFixed(1)}%`,
                                     "#55b7ff"
                                )}

                                ${card(
                                    "In Target",
                                    `${inTargetPercent.toFixed(1)}%`,
                                     "#4fd17a"
                                )}

                                ${card(
                                    "Above Target",
                                    `${aboveTargetPercent.toFixed(1)}%`,
                                     "#ff704d"
                                )}
                            `
                            : ""
                    }

                    ${card(
                        "Tests",
                        values.length.toLocaleString()
                    )}
                `;
            }

            stats.innerHTML =
                summarize(first, selected) +
                (
                    compareEnabled &&
                    second.length
                        ? summarize(
                            second,
                            compareSelected
                        )
                        : ""
                );
        }

        // -----------------------------------------------------
        // Legend
        // -----------------------------------------------------

               function updateLegend(hasSecond) {

            const legend =
                overlay.querySelector("#ah-legend");

            function targetText(did) {

                const target = TARGETS[did];
                const info = PARAMS[did];

                if (!target) return "";

                const min =
                    Number(target.min).toFixed(
                        info.digits
                    );

                const max =
                    Number(target.max).toFixed(
                        info.digits
                    );

                const unit =
                    info.unit
                        ? ` ${info.unit}`
                        : "";

                return `
                    <span style="
                        color:#8fca9f;
                        margin-left:5px;
                    ">
                        Target ${min}–${max}${unit}
                    </span>
                `;
            }

            legend.innerHTML = `
                <span>
                    <span style="
                        color:#ff7a1a;
                        font-size:18px
                    ">●</span>

                    ${PARAMS[selected].name}

                    ${targetText(selected)}
                </span>

                ${
                    compareEnabled &&
                    hasSecond
                        ? `
                            <span>
                                <span style="
                                    color:#55b7ff;
                                    font-size:18px
                                ">●</span>

                                ${PARAMS[compareSelected].name}

                                ${targetText(compareSelected)}
                            </span>
                        `
                        : ""
                }
            `;
        }

        // -----------------------------------------------------
        // Hover tooltip
        // -----------------------------------------------------

        canvas.addEventListener(
            "mousemove",
            event => {

                if (!visiblePoints.length) return;

                const rect =
                    canvas.getBoundingClientRect();

                const mx =
                    event.clientX - rect.left;

                const my =
                    event.clientY - rect.top;

                let nearest = null;
                let bestDistance = 14;

                for (const p of visiblePoints) {

                    const dx = p.x - mx;
                    const dy = p.y - my;

                    const distance =
                        Math.sqrt(
                            dx * dx +
                            dy * dy
                        );

                    if (distance < bestDistance) {
                        bestDistance = distance;
                        nearest = p;
                    }
                }

                if (!nearest) {
                    tooltip.style.display =
                        "none";
                    return;
                }

                const r = nearest.record;
                const info =
                    PARAMS[nearest.did];

                const d =
                    new Date(r.date);

                tooltip.innerHTML = `
                    <div style="
                        font-weight:bold;
                        margin-bottom:3px
                    ">
                        ${info.name}:
                        ${fmtValue(
                            r.value,
                            nearest.did
                        )}
                    </div>

                    <div style="color:#bbb">
                        ${d.toLocaleDateString(
                            undefined,
                            {
                                month: "short",
                                day: "numeric",
                                year: "numeric"
                            }
                        )}
                        &nbsp;
                        ${d.toLocaleTimeString(
                            undefined,
                            {
                                hour: "numeric",
                                minute: "2-digit"
                            }
                        )}
                    </div>
                `;

                tooltip.style.display =
                    "block";

                let left = mx + 18;
                let top = my + 18;

                if (left + 220 > rect.width) {
                    left = mx - 220;
                }

                tooltip.style.left =
                    `${left}px`;

                tooltip.style.top =
                    `${top}px`;
            }
        );

        canvas.addEventListener(
            "mouseleave",
            () => {
                tooltip.style.display =
                    "none";
            }
        );
        // -----------------------------------------------------
        // Target editor
        // -----------------------------------------------------

        overlay.querySelector(
            "#ah-targets"
        ).onclick = () => {

            // Remove existing editor if one is already open
            const oldEditor =
                overlay.querySelector("#ah-target-editor");

            if (oldEditor) {
                oldEditor.remove();
                return;
            }

            const editor =
                document.createElement("div");

            editor.id = "ah-target-editor";

            Object.assign(editor.style, {
                position: "fixed",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: "1000001",
                background: "#1b2024",
                color: "#fff",
                border: "1px solid #666",
                borderRadius: "8px",
                padding: "18px",
                width: "420px",
                maxWidth: "90vw",
                maxHeight: "min(85vh, 850px)",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxShadow: "0 10px 40px rgba(0,0,0,.75)"
            });

            let rows = "";

            // Show only measurements actually returned for this controller.
            const targetDids = Object.keys(PARAMS).filter(did => availableDids.has(did));
            for (const did of targetDids) {
                const info = PARAMS[did];
                const target = TARGETS[did] || {min:"",max:""};

                rows += `
                    <div style="
                        display:grid;
                        grid-template-columns:1fr 90px 90px;
                        gap:8px;
                        align-items:center;
                        margin-bottom:8px;
                    ">
                        <div>
                            ${safeText(info.name)}
                            <span style="
                                color:#888;
                                font-size:11px;
                            ">
                                ${safeText(info.unit)}
                            </span>
                        </div>

                        <input
                            type="number"
                            step="any"
                            data-target-min="${did}"
                            value="${target.min}"
                            style="
                                width:100%;
                                box-sizing:border-box;
                                background:#101316;
                                color:#fff;
                                border:1px solid #555;
                                border-radius:4px;
                                padding:7px;
                            "
                        >

                        <input
                            type="number"
                            step="any"
                            data-target-max="${did}"
                            value="${target.max}"
                            style="
                                width:100%;
                                box-sizing:border-box;
                                background:#101316;
                                color:#fff;
                                border:1px solid #555;
                                border-radius:4px;
                                padding:7px;
                            "
                        >
                    </div>
                `;
            }

            editor.innerHTML = `
                <div style="
                    font-size:20px;
                    font-weight:bold;
                    margin-bottom:14px;
                ">
                    Target Ranges
                </div>

                <div style="
                    display:grid;
                    grid-template-columns:1fr 90px 90px;
                    gap:8px;
                    color:#aaa;
                    font-size:11px;
                    text-transform:uppercase;
                    margin-bottom:7px;
                ">
                    <div>Parameter</div>
                    <div>Minimum</div>
                    <div>Maximum</div>
                </div>

                <div id="ah-target-scroll" style="overflow-y:auto;min-height:0;flex:1;overscroll-behavior:contain;padding-right:8px;">
                    ${rows || '<div style="color:#aaa;padding:12px">No measurements found for this controller.</div>'}
                </div>

                <div style="
                    display:flex;
                    flex-shrink:0;
                    justify-content:flex-end;
                    gap:8px;
                    margin-top:16px;
                ">
                    <button id="ah-target-reset">
                        Example Values
                    </button>

                    <button id="ah-target-cancel">
                        Cancel
                    </button>

                    <button id="ah-target-save">
                        Save
                    </button>
                </div>
            `;

            // Style editor buttons
            editor.querySelectorAll("button").forEach(btn => {
                Object.assign(btn.style, {
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #666",
                    borderRadius: "4px",
                    padding: "8px 11px",
                    cursor: "pointer"
                });
            });
            editor.querySelector(
                "#ah-target-reset"
            ).onclick = () => {

                for (
                    const [did, defaults]
                    of Object.entries(DEFAULT_TARGETS)
                ) {

                    const minInput =
                        editor.querySelector(
                            `[data-target-min="${did}"]`
                        );

                    const maxInput =
                        editor.querySelector(
                            `[data-target-max="${did}"]`
                        );

                    if (minInput && maxInput) {
                        minInput.value = defaults.min;
                        maxInput.value = defaults.max;
                    }
                }
            };
            editor.querySelector(
                "#ah-target-save"
            ).style.background = "#e87922";

            editor.querySelector(
                "#ah-target-cancel"
            ).onclick = () => {
                editor.remove();
            };
            editor.querySelector(
                "#ah-target-save"
            ).onclick = () => {

                const changes = {};
                for (const did of targetDids) {
                    const minInput = editor.querySelector(`[data-target-min="${did}"]`);
                    const maxInput = editor.querySelector(`[data-target-max="${did}"]`);
                    const minText = minInput.value.trim();
                    const maxText = maxInput.value.trim();
                    // Empty fields mean no target; don't silently convert them to zero.
                    if (!minText && !maxText) {
                        changes[did] = null;
                        continue;
                    }
                    const min = Number(minText);
                    const max = Number(maxText);
                    if (!minText || !maxText || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
                        alert(`${PARAMS[did].name}: Enter a valid minimum and maximum (minimum must be lower).`);
                        return;
                    }
                    changes[did] = {min, max};
                }
                for (const [did, value] of Object.entries(changes)) {
                    if (value === null) delete TARGETS[did];
                    else TARGETS[did] = value;
                }

                localStorage.setItem(
                    targetKey(apexId),
                    JSON.stringify(TARGETS)
                );

                editor.remove();

                draw();
            };
            overlay.appendChild(editor);
        };
        // -----------------------------------------------------
        // CSV
        // -----------------------------------------------------

        overlay.querySelector(
            "#ah-export"
        ).onclick = () => {

            const lines = [
                [
                    "Date",
                    "Parameter",
                    "Value",
                    "Unit",
                    "DeviceID",
                    "Source"
                ].join(",")
            ];

            for (const r of records) {

                const p = PARAMS[r.did];

                lines.push([
                    `"${r.date}"`,
                    `"${p.name}"`,
                    r.value,
                    `"${p.unit}"`,
                    `"${r.did}"`,
                    `"${r.source}"`
                ].join(","));
            }

            const blob =
                new Blob(
                    [lines.join("\n")],
                    {
                        type:
                            "text/csv;charset=utf-8"
                    }
                );

            const url =
                URL.createObjectURL(blob);

            const a =
                document.createElement("a");

            a.href = url;

            a.download =
                `Apex-History-${currentDays}-days.csv`;

            a.click();

            setTimeout(
                () =>
                    URL.revokeObjectURL(url),
                1000
            );
        };

        // -----------------------------------------------------
        // Close
        // -----------------------------------------------------

        overlay.querySelector(
            "#ah-close"
        ).onclick = () => {

            overlay.remove();
        };

        // -----------------------------------------------------
        // Resize
        // -----------------------------------------------------

        let resizeTimer;

        window.addEventListener(
            "resize",
            () => {

                clearTimeout(resizeTimer);

                resizeTimer =
                    setTimeout(() => {

                        if (
                            document.body.contains(
                                overlay
                            )
                        ) {
                            draw();
                        }

                    }, 120);
            }
        );

        // -----------------------------------------------------
        // Start
        // -----------------------------------------------------

        updateRangeButtons();
        updateParamButtons();
        populateCompare();

        await loadFusionMetadata();
        await loadHistory(DEFAULT_DAYS);
    }

})();