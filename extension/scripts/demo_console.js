
    const FORCE_KEY = "AI_SHIELD_FORCE_FALLBACK";
    const API_KEY = "AI_SHIELD_DEMO_API_BASE";
    const SHARED_FAMILY_KEY = "AI_SHIELD_FAMILY_ID";
    const FAMILY_ID_KEYS = [
      "savedFamilyID",
      "aiShieldPrimaryFamilyID",
      SHARED_FAMILY_KEY,
      "currentFamilyID",
      "boundFamilyID",
      "familyCode",
      "dashboardFamilyID",
      "popupFamilyID",
      "aiShieldFamilyID",
      "familyID"
    ];
    const DEFAULT_API_BASE = "https://ai-anti-scam.onrender.com";
    const DEFAULT_FAMILY_ID = "";
    const $ = (id) => document.getElementById(id);

    function decodeDemoText(base64Text) {
      try {
        const binary = atob(base64Text);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
      } catch (e) {
        return "";
      }
    }

    const DEMO_CASE_TEXTS = {
      high: decodeDemoText("5oKo55qE5YyF6KO56YWN6YCB5aSx5pWX77yM6KuL56uL5Y2z6KOc57mz6YGL6LK75Lim6Ly45YWl5L+h55So5Y2h6LOH5paZ77yM6YC+5pyf5bCH6YCA5Zue44CC"),
      mid: decodeDemoText("6ICB5bir5LuK5aSp6ZaL5pS+5oqV6LOH576k57WE5ZCN6aGN77yM6Lef5Zau5pON5L2c5Y+v5o6M5o+h6aOG6IKh5qmf5pyD77yM5oOz5LqG6Kej6KuL5Yqg5YWlIExJTkXjgII="),
      low: decodeDemoText("6YCZ5piv5LiA5YmH5LiA6Iis5rS75YuV6YCa55+l77yM6KuL6Iez5a6Y5pa557ay56uZ5p+l55yL5rS75YuV5pmC6ZaT6IiH5Zyw6bue44CC")
    };

    function hydrateDemoCases() {
      // 為避免外部通訊軟體或瀏覽器安全機制誤判，展示台不直接顯示測試話術。
      // 測試文字只在使用者點「複製案例」時進入剪貼簿。
      return true;
    }



    function normalizeFamilyCode(value){
      return String(value || "").trim().toUpperCase().replace(/^AISHIELD:/,"").replace(/^FAM-/,"").replace(/[^A-Z0-9]/g,"").slice(0,6);
    }

    function showToast(message){
      const t = $("toast");
      t.textContent = message;
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2600);
    }

    function getUrlFamilyID(){
      try {
        const params = new URLSearchParams(window.location.search || "");
        return normalizeFamilyCode(params.get("familyID") || params.get("familyId") || params.get("fid") || "");
      } catch (e) {
        return "";
      }
    }

    function getFamilyID(){
      const fromUrl = getUrlFamilyID();
      if (fromUrl.length === 6) return fromUrl;

      for (const key of FAMILY_ID_KEYS) {
        try {
          const value = normalizeFamilyCode(localStorage.getItem(key));
          if (value.length === 6) return value;
        } catch (e) {}
      }

      const fromInput = normalizeFamilyCode($("familyCodeInput")?.value);
      if (fromInput.length === 6) return fromInput;

      return "";
    }

    async function getStoredFamilyID(){
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const storage = await chrome.storage.local.get(FAMILY_ID_KEYS);
          for (const key of FAMILY_ID_KEYS) {
            const value = normalizeFamilyCode(storage?.[key]);
            if (value.length === 6) return value;
          }
        }
      } catch (e) {}

      return getFamilyID();
    }

    function setFamilyUI(familyID){
      const code = normalizeFamilyCode(familyID);
      const input = $("familyCodeInput");
      const text = $("familyCodeText");

      if (input) input.value = code || "";
      if (text) text.textContent = code || "尚未綁定";
    }

    async function syncFamilyID(familyID = getFamilyID()){
      const code = normalizeFamilyCode(familyID);
      if (code.length !== 6) {
        showToast("目前沒有有效家庭代碼。請先在 Welcome 或 Popup 建立 / 綁定家庭群組。");
        setFamilyUI("");
        $("syncScopeText").textContent = "同步範圍：尚未綁定家庭代碼";
        return "";
      }

      FAMILY_ID_KEYS.forEach(key => localStorage.setItem(key, code));
      localStorage.setItem("aiShieldFamilyBindingUpdatedAt", new Date().toISOString());
      localStorage.setItem("aiShieldFamilyBindingSource", "demo-console");

      try {
        const channel = new BroadcastChannel("ai-shield-family-sync");
        channel.postMessage({ type: "familyID:update", familyID: code, source: "demo_console" });
        channel.close();
      } catch (e) {}

      let chromeSynced = false;
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const payload = {
            aiShieldFamilyBindingUpdatedAt: new Date().toISOString(),
            aiShieldFamilyBindingSource: "demo-console"
          };
          FAMILY_ID_KEYS.forEach(key => { payload[key] = code; });
          await chrome.storage.local.set(payload);
          chromeSynced = true;
        }
      } catch (e) {}

      setFamilyUI(code);
      updateModeUI();
      $("syncScopeText").textContent = chromeSynced
        ? "同步範圍：chrome.storage + localStorage"
        : "同步範圍：localStorage / URL 參數";

      showToast(`已同步家庭代碼：${code}`);
      return code;
    }

    async function reloadFamilyIDFromStorage(){
      const code = await getStoredFamilyID();
      setFamilyUI(code);
      if (code) {
        $("syncScopeText").textContent = "同步範圍：已讀取目前家庭代碼";
        showToast(`已讀取目前家庭代碼：${code}`);
      } else {
        $("syncScopeText").textContent = "同步範圍：尚未綁定家庭代碼";
        showToast("目前尚未找到家庭代碼。請先從 Welcome 或 Popup 建立家庭。");
      }
      return code;
    }

    function getApiBase(){
      return (localStorage.getItem(API_KEY) || $("apiBaseInput").value || DEFAULT_API_BASE).replace(/\/+$/, "");
    }

    function updateModeUI(){
      const force = localStorage.getItem(FORCE_KEY) === "1";
      $("currentModePill").textContent = force ? "目前模式：強制本機備援" : "目前模式：雲端 AI 優先";
      setFamilyUI(getFamilyID());
    }

    function setStatus(id,state,text,noteId,note){
      const el = $(id);
      if(el){ el.className = "light " + state; el.textContent = text; }
      if(noteId && $(noteId)) $(noteId).textContent = note;
    }

    async function fetchJson(url, options={}, timeout=5000){
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, {...options, signal: controller.signal});
        const data = await res.json().catch(() => ({}));
        return {ok:res.ok,status:res.status,data};
      } finally {
        clearTimeout(timer);
      }
    }

    async function checkApiStatus(){
      const base = getApiBase();
      setStatus("apiStatus","checking","檢查中","apiStatusNote","正在嘗試連線後端健康檢查。");
      setStatus("aiStatus","checking","檢查中","aiStatusNote","正在確認雲端掃描服務。");

      let healthOk = false;
      for(const url of [`${base}/api/health`, `${base}/health`]){
        try{
          const r = await fetchJson(url, {}, 4500);
          if(r.ok){ healthOk = true; setStatus("apiStatus","online","Online","apiStatusNote",`健康檢查成功：${url}`); break; }
        }catch(e){}
      }
      if(!healthOk) setStatus("apiStatus","fallback","Fallback","apiStatusNote","健康檢查未回應；展示仍可使用本機備援模式。");

      try{
        const r = await fetchJson(`${base}/api/scan`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({text: DEMO_CASE_TEXTS.high,url:"https://parcel-pay.example.com",source:"demo-console-health-check",familyID:getFamilyID()})
        }, 6500);
        if(r.ok) setStatus("aiStatus","online","Ready","aiStatusNote","雲端分析 API 可回應，現場可優先展示雲端 AI。");
        else setStatus("aiStatus","fallback","Demo Ready","aiStatusNote",`雲端掃描回應 ${r.status}；App Demo 可切換本機備援。`);
      }catch(e){
        setStatus("aiStatus","fallback","Demo Ready","aiStatusNote","雲端分析暫時不可用；App Demo 可切換本機備援。");
      }
    }

    function checkVoice(){
      const audio = new Audio(toExtensionUrl('assets/audio/ai_shield_bilingual_warning.mp3'));
      audio.preload = "auto";
      audio.addEventListener("canplaythrough", () => setStatus("voiceStatus","online","Ready","voiceStatusNote","雙語警示音檔可載入。"), {once:true});
      audio.addEventListener("error", () => setStatus("voiceStatus","fallback","Check File","voiceStatusNote","找不到或無法載入 mp3，請確認檔案位於 assets/audio/。"), {once:true});
      audio.load();
    }

    function toExtensionUrl(path){
      const cleanPath = String(path || '').replace(/^\.\.\//, '');
      if (/^https?:/i.test(cleanPath)) return cleanPath;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          return chrome.runtime.getURL(cleanPath);
        }
      } catch(e) {}
      return new URL(path, window.location.href).href;
    }

    function openPage(path){
      const opened = window.open(toExtensionUrl(path), "_blank");
      if(!opened) showToast("瀏覽器阻擋新視窗，請允許彈出視窗後再試。");
    }

    function buildAppUrl(forceFallback=false, caseType=""){
      const params = new URLSearchParams();
      if (getFamilyID()) params.set("familyID", getFamilyID());
      params.set("demoMode", "1");
      params.set("suppressLine", "1");
      if (caseType) params.set("case", caseType);
      if (forceFallback) params.set("forceFallback", "1");
      return `pages/AI防詐盾牌_AppDemo.html?${params.toString()}`;
    }

    function buildDashboardUrl(){
      const params = new URLSearchParams();
      if (getFamilyID()) params.set("familyID", getFamilyID());
      params.set("autoStart", "1");
      return `pages/dashboard.html?${params.toString()}`;
    }

    function copyText(text){
      if(navigator.clipboard?.writeText){
        navigator.clipboard.writeText(text).then(() => showToast("已複製"), () => fallbackCopy(text));
      } else fallbackCopy(text);
    }

    function copyCase(id){
      const map = {
        caseHigh: DEMO_CASE_TEXTS.high,
        caseMid: DEMO_CASE_TEXTS.mid,
        caseLow: DEMO_CASE_TEXTS.low
      };
      copyText(map[id] || $(id)?.textContent || "");
    }

    function getDemoCasePayload(type){
      const normalized = String(type || "").toLowerCase();
      if (normalized === "high") {
        return {
          type: "high",
          url: "https://parcel-pay.example.com",
          text: DEMO_CASE_TEXTS.high,
          label: "案例 A：訊息測試"
        };
      }
      if (normalized === "mid") {
        return {
          type: "mid",
          url: "",
          text: DEMO_CASE_TEXTS.mid,
          label: "案例 B：社群測試"
        };
      }
      return {
        type: "low",
        url: "https://www.gov.tw",
        text: DEMO_CASE_TEXTS.low,
        label: "一般活動通知"
      };
    }

    function saveDemoCaseForApp(type){
      const payload = getDemoCasePayload(type);
      try {
        localStorage.setItem("AI_SHIELD_SELECTED_DEMO_CASE", JSON.stringify({
          ...payload,
          familyID: getFamilyID(),
          suppressLine: true,
          demoMode: true,
          selectedAt: new Date().toISOString()
        }));
        localStorage.setItem("AI_SHIELD_SELECTED_DEMO_CASE_TYPE", payload.type);
      } catch (e) {}

      try {
        const channel = new BroadcastChannel("ai-shield-demo-case");
        channel.postMessage({ type: "demoCase:selected", payload });
        channel.close();
      } catch (e) {}

      return payload;
    }

    async function openAppWithCase(type, forceFallback=false){
      const payload = saveDemoCaseForApp(type);
      await syncFamilyID();
      showToast(`已帶入${payload.label}，正在開啟 App Demo`);
      openPage(buildAppUrl(forceFallback, payload.type));
    }

    function fallbackCopy(text){
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.left = "-9999px";
      document.body.appendChild(area); area.select();
      try{ document.execCommand("copy"); showToast("已複製"); }catch(e){ showToast("無法自動複製，請手動選取。"); }
      area.remove();
    }

    document.addEventListener("DOMContentLoaded", async () => {
      hydrateDemoCases();
      const savedApi = localStorage.getItem(API_KEY);
      if(savedApi) $("apiBaseInput").value = savedApi;

      await reloadFamilyIDFromStorage();
      updateModeUI();
      checkApiStatus();
      checkVoice();

      $("familyCodeInput").addEventListener("input", event => {
        event.target.value = normalizeFamilyCode(event.target.value);
        setFamilyUI(event.target.value);
      });

      $("syncFamilyBtn").addEventListener("click", () => syncFamilyID());
      $("reloadFamilyBtn").addEventListener("click", () => reloadFamilyIDFromStorage());
      $("copyFamilyBtn").addEventListener("click", () => copyText(getFamilyID()));

      $("refreshStatusBtn").addEventListener("click", checkApiStatus);
      $("saveApiBtn").addEventListener("click", () => {
        localStorage.setItem(API_KEY, $("apiBaseInput").value.trim() || DEFAULT_API_BASE);
        showToast("API 位置已儲存");
        checkApiStatus();
      });

      $("enableFallbackBtn").addEventListener("click", () => {
        localStorage.setItem(FORCE_KEY,"1");
        updateModeUI();
        showToast("已啟用強制本機備援模式");
      });

      $("disableFallbackBtn").addEventListener("click", () => {
        localStorage.removeItem(FORCE_KEY);
        updateModeUI();
        showToast("已恢復雲端 AI 優先模式");
      });

      $("openAppBtn").addEventListener("click", async () => {
        await openAppWithCase("high", false);
      });

      $("openDashboardBtn").addEventListener("click", async () => {
        await syncFamilyID();
        openPage(buildDashboardUrl());
      });

      $("openFallbackDemoBtn").addEventListener("click", async () => {
        localStorage.setItem(FORCE_KEY,"1");
        updateModeUI();
        await openAppWithCase("high", true);
      });

      document.querySelectorAll("[data-open]").forEach(btn => btn.addEventListener("click", () => openPage(btn.dataset.open)));
      document.querySelectorAll("[data-load-case]").forEach(btn => btn.addEventListener("click", () => openAppWithCase(btn.dataset.loadCase)));
      document.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", () => copyCase(btn.dataset.copy)));
    });
  