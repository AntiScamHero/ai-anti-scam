/*!
 * AI 防詐盾牌 Chart.js 輕量展示備援版。
 * 若正式專案已有官方 Chart.js，可直接覆蓋成官方檔。
 */
(function () {
  "use strict";

  function getCanvas(canvasLike) {
    return canvasLike && canvasLike.canvas ? canvasLike.canvas : canvasLike;
  }

  function prepare(canvas) {
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.width || 420, height: canvas.height || 260 };
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width || canvas.width || 420));
    const height = Math.max(220, Math.floor(rect.height || canvas.height || 260));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function empty(ctx, width, height, text) {
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 15px Microsoft JhengHei, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text || "目前尚無圖表資料", width / 2, height / 2);
  }

  function MiniChart(canvasLike, config) {
    this.canvas = getCanvas(canvasLike);
    this.config = config || {};
    this.type = this.config.type || "line";
    this.render();
  }

  MiniChart.prototype.render = function () {
    if (!this.canvas || !this.canvas.getContext) return;
    const { ctx, width, height } = prepare(this.canvas);
    const data = this.config.data || {};
    const labels = data.labels || [];
    const values = ((data.datasets && data.datasets[0] && data.datasets[0].data) || []).map(Number);
    const colors = ["#16a34a", "#f59e0b", "#dc2626", "#1769e8"];
    const total = values.reduce((sum, value) => sum + Math.max(0, value || 0), 0);

    if (!values.length || !total) {
      empty(ctx, width, height, "目前尚無圖表資料");
      return;
    }

    if (this.type === "doughnut") {
      const cx = Math.floor(width * 0.38);
      const cy = Math.floor(height * 0.52);
      const radius = Math.min(width, height) * 0.28;
      let start = -Math.PI / 2;

      values.forEach((value, index) => {
        const angle = (Math.max(0, value) / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + angle);
        ctx.closePath();
        ctx.fillStyle = colors[index % colors.length];
        ctx.fill();
        start += angle;
      });

      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.58, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      ctx.fillStyle = "#0f172a";
      ctx.font = "900 26px Microsoft JhengHei, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(total), cx, cy + 8);

      let y = Math.floor(height * 0.32);
      const x = Math.floor(width * 0.68);
      labels.forEach((label, index) => {
        ctx.fillStyle = colors[index % colors.length];
        ctx.fillRect(x, y - 10, 14, 14);
        ctx.fillStyle = "#334155";
        ctx.font = "bold 14px Microsoft JhengHei, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${label}：${values[index] || 0}`, x + 22, y + 2);
        y += 32;
      });
      return;
    }

    const left = 46, right = 18, top = 24, bottom = 42;
    const plotW = width - left - right;
    const plotH = height - top - bottom;

    [0, 25, 50, 75, 100].forEach(mark => {
      const y = top + plotH - (mark / 100) * plotH;
      ctx.strokeStyle = "rgba(100,116,139,0.20)";
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.font = "bold 11px Microsoft JhengHei, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(String(mark), left - 8, y + 4);
    });

    const points = values.map((value, index) => ({
      x: left + (values.length === 1 ? plotW / 2 : index / (values.length - 1) * plotW),
      y: top + plotH - Math.max(0, Math.min(100, value)) / 100 * plotH,
      value
    }));

    ctx.strokeStyle = "#1769e8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();

    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.value >= 70 ? "#dc2626" : p.value >= 40 ? "#f59e0b" : "#16a34a";
      ctx.fill();
    });
  };

  MiniChart.prototype.update = function () { this.render(); };
  MiniChart.prototype.destroy = function () {};
  window.Chart = window.Chart || MiniChart;
})();
