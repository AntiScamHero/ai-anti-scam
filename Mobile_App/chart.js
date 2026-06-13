/* 小守護 Chart.js 安全備援版
 * 比賽現場若未放入完整 Chart.js，此檔可避免 Dashboard 崩潰；
 * dashboard.js 仍會顯示文字版圖表 fallback。
 */
(function () {
  if (typeof window === "undefined" || window.Chart) return;
  function Chart(ctx, config) {
    this.ctx = ctx;
    this.config = config || {};
    this.data = this.config.data || {};
    this.options = this.config.options || {};
    try {
      const canvas = ctx && ctx.canvas ? ctx.canvas : ctx;
      const parent = canvas && canvas.parentElement;
      if (parent && !parent.querySelector(".chart-fallback-note")) {
        const note = document.createElement("div");
        note.className = "chart-fallback-note";
        note.textContent = "圖表元件使用備援模式，詳細數字請看下方文字與表格。";
        note.style.cssText = "margin-top:12px;padding:12px;border-radius:14px;background:#f8fafc;border:2px dashed #cbd5e1;color:#334155;font-weight:900;text-align:center;";
        parent.appendChild(note);
      }
    } catch (e) {}
  }
  Chart.prototype.update = function () {};
  Chart.prototype.destroy = function () {};
  Chart.register = function () {};
  Chart.defaults = { plugins: { legend: { display: true } } };
  window.Chart = Chart;
})();
