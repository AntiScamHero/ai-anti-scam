(() => {
  const data = {
    labels: ["物流補繳", "假檢警", "假投資", "投資觀望", "官方提醒", "家人訊息"],
    scores: [100, 72, 70, 45, 0, 0],
    scoreColors: ["#ef4b5f", "#ef4b5f", "#ef4b5f", "#ffb020", "#18b26b", "#18b26b"],
    pollLabels: ["看得懂，很清楚", "大概懂，但是有點快", "看不懂家屬通知", "看不懂 AI 做了什麼"],
    pollValues: [2, 8, 0, 0],
    levelLabels: ["高風險", "中風險", "低風險"],
    levelValues: [3, 1, 2],
    levelColors: ["#ef4b5f", "#ffb020", "#18b26b"]
  };

  const el = (id) => document.getElementById(id);

  function numText(value, options = {}) {
    const decimals = options.decimals || 0;
    const suffix = options.suffix || "";
    return `<tspan class="svg-num" data-count="${value}" data-decimals="${decimals}" data-suffix="${suffix}">0${suffix}</tspan>`;
  }

  function numSpan(value, options = {}) {
    const decimals = options.decimals || 0;
    const suffix = options.suffix || "";
    return `<span class="num-animate" data-count="${value}" data-decimals="${decimals}" data-suffix="${suffix}">0${suffix}</span>`;
  }

  function renderRiskLineChart() {
    const w = 820, h = 430, padL = 82, padR = 28, padT = 50, padB = 92;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const maxY = 100;

    const points = data.scores.map((value, index) => ({
      x: padL + (innerW / (data.scores.length - 1)) * index,
      y: padT + innerH - (value / maxY) * innerH,
      value,
      label: data.labels[index],
      color: data.scoreColors[index]
    }));

    const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const area = `${line} L ${points[points.length - 1].x} ${padT + innerH} L ${points[0].x} ${padT + innerH} Z`;

    const grid = [0, 20, 40, 60, 80, 100].map((value) => {
      const y = padT + innerH - (value / maxY) * innerH;
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="rgba(148,163,184,.24)" />
              <text x="${padL - 16}" y="${y + 7}" text-anchor="end" fill="#607894" font-size="19" font-weight="900">${numText(value)}</text>`;
    }).join("");

    const labels = points.map((point) =>
      `<text x="${point.x}" y="${h - 28}" text-anchor="middle" fill="#536d88" font-size="19" font-weight="900">${point.label}</text>`
    ).join("");

    const dots = points.map((point, index) =>
      `<g class="point-pop" style="animation-delay:${0.38 + index * 0.34}s">
        <circle cx="${point.x}" cy="${point.y}" r="10" fill="${point.color}" stroke="#fff" stroke-width="4"></circle>
        <text x="${point.x}" y="${point.y - 20}" text-anchor="middle" fill="#10233f" font-size="22" font-weight="1000">${numText(point.value)}</text>
      </g>`
    ).join("");

    el("riskLineChart").innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="riskTitle riskDesc">
        <title id="riskTitle">風險分數折線圖</title>
        <desc id="riskDesc">六組手機實測案例分數依序為 100、72、70、45、0、0，呈現高風險、中風險與低風險差異。</desc>
        <defs>
          <linearGradient id="lineArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#4da3ff" stop-opacity=".22"/>
            <stop offset="100%" stop-color="#4da3ff" stop-opacity=".02"/>
          </linearGradient>
        </defs>
        ${grid}
        <path class="area-fade" d="${area}" fill="url(#lineArea)"></path>
        <path class="line-draw" pathLength="1" d="${line}" fill="none" stroke="#1769e8" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
        ${dots}
        ${labels}
      </svg>
      <div class="legend">
        <span><i class="dot" style="background:#ef4b5f"></i>高風險</span>
        <span><i class="dot" style="background:#ffb020"></i>中風險</span>
        <span><i class="dot" style="background:#18b26b"></i>低風險</span>
      </div>`;
  }

  function polar(cx, cy, r, angle) {
    const rad = (angle - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arc(cx, cy, r, startAngle, endAngle) {
    const start = polar(cx, cy, r, endAngle);
    const end = polar(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
    return ["M", start.x, start.y, "A", r, r, 0, largeArcFlag, 0, end.x, end.y].join(" ");
  }

  function renderPassChart() {
    const w = 500, h = 430, cx = 250, cy = 190, r = 128;

    el("passChart").innerHTML = `
      <svg class="ring-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="passTitle passDesc">
        <title id="passTitle">自動化測試通過率</title>
        <desc id="passDesc">自動化測試 181 題全部通過，通過率為 100%。</desc>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8f3f7" stroke-width="38"></circle>
        <path class="line-draw" pathLength="1" d="${arc(cx, cy, r, 0, 359.99)}" fill="none" stroke="#18b26b" stroke-width="38" stroke-linecap="round"></path>
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#10233f" font-size="64" font-weight="1000">${numText(100, { suffix: "%" })}</text>
        <text x="${cx}" y="${cy + 42}" text-anchor="middle" fill="#607894" font-size="24" font-weight="900">測試通過率</text>
        <text x="${cx}" y="${h - 28}" text-anchor="middle" fill="#1769e8" font-size="28" font-weight="1000">${numText(181)} / ${numText(181)} 全數通過</text>
      </svg>`;
  }

  function renderPollBarChart() {
    const max = Math.max(...data.pollValues, 1);
    const colors = ["#1769e8", "#18b26b", "#ffb020", "#b8c7da"];

    el("pollBarChart").innerHTML = `<div class="bars" role="img" aria-label="50+ 使用者回饋統計，2 人看得懂很清楚，8 人大概懂但是有點快，其他兩項為 0 人。">
      ${data.pollLabels.map((label, index) => {
        const width = data.pollValues[index] / max * 100;
        return `<div class="bar-row">
          <div class="bar-label">${label}</div>
          <div class="track"><div class="fill" style="width:${width}%;background:${colors[index]}"></div></div>
          <div class="bar-label" style="text-align:right;color:#1769e8">${numSpan(data.pollValues[index])}</div>
        </div>`;
      }).join("")}
    </div>`;
  }

  function renderLevelChart() {
    const total = data.levelValues.reduce((sum, value) => sum + value, 0);
    const segments = data.levelValues.map((value, index) => ({
      label: data.levelLabels[index],
      value,
      color: data.levelColors[index],
      pct: Math.round(value / total * 100)
    }));

    const w = 500, h = 420, cx = 250, cy = 178, r = 124;
    let start = 0;

    const paths = segments.map((segment, index) => {
      const sweep = segment.value / total * 360;
      const path = `<path class="line-draw" style="animation-delay:${index * 0.42}s" pathLength="1" d="${arc(cx, cy, r, start, start + sweep)}" fill="none" stroke="${segment.color}" stroke-width="38" stroke-linecap="round"></path>`;
      start += sweep;
      return path;
    }).join("");

    const legend = segments.map((segment) =>
      `<span><i class="dot" style="background:${segment.color}"></i>${segment.label} ${numSpan(segment.value)} 筆（${numSpan(segment.pct, { suffix: "%" })}）</span>`
    ).join("");

    el("levelChart").innerHTML = `
      <svg class="ring-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="levelTitle levelDesc">
        <title id="levelTitle">案例分級分布圖</title>
        <desc id="levelDesc">展示案例共 6 筆，其中高風險 3 筆，中風險 1 筆，低風險 2 筆。</desc>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#edf2f8" stroke-width="38"></circle>
        ${paths}
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#10233f" font-size="58" font-weight="1000">${numText(total)}</text>
        <text x="${cx}" y="${cy + 36}" text-anchor="middle" fill="#607894" font-size="24" font-weight="900">案例總數</text>
      </svg>
      <div class="legend">${legend}</div>`;
  }

  function animateSingleNode(node) {
    if (node.classList.contains("is-animated")) return;
    node.classList.add("is-animated");

    const target = Number(node.dataset.count || 0);
    const decimals = Number(node.dataset.decimals || 0);
    const suffix = node.dataset.suffix || "";
    const duration = 3000;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const start = performance.now();

    function frame(now) {
      const raw = Math.min(Math.max((now - start) / duration, 0), 1);
      const value = target * ease(raw);
      node.textContent = value.toFixed(decimals) + suffix;

      if (raw < 1) {
        requestAnimationFrame(frame);
      } else {
        node.textContent = target.toFixed(decimals) + suffix;
      }
    }

    requestAnimationFrame(frame);
  }

  function respectsReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function initScrollObserver() {
    const sections = document.querySelectorAll(".reveal-section");

    sections.forEach((section) => {
      section.classList.add("reveal-ready");
    });

    const fallbackReveal = () => {
      sections.forEach((section) => {
        section.classList.add("is-visible");
        section.querySelectorAll(".num-animate,.svg-num").forEach((node, index) => {
          setTimeout(() => animateSingleNode(node), index * 32);
        });
      });
    };

    if (respectsReducedMotion() || !("IntersectionObserver" in window)) {
      fallbackReveal();
      return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const section = entry.target;
        section.classList.add("is-visible");
        section.querySelectorAll(".num-animate,.svg-num").forEach((node, index) => {
          setTimeout(() => animateSingleNode(node), index * 32);
        });

        obs.unobserve(section);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });

    sections.forEach((section) => observer.observe(section));
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderRiskLineChart();
    renderPassChart();
    renderPollBarChart();
    renderLevelChart();
    initScrollObserver();
  });
})();