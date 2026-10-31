document.addEventListener("DOMContentLoaded", () => {
    let currentTool = 'cursor';
    const drawings = {};
    let activeDrawing = null;
    let drawingStage = 0;
    let selectedDrawing = null;
    let isDraggingObject = false;
    let dragStartData = null;
    let activeHandle = null; // 'start', 'end', 'p1', 'p2', 'move'
    let dragStartObj = null; // Копия объекта для правильного перетаскивания

    const tickerSelect = document.getElementById('ticker-select');
    const timeframeSelect = document.getElementById('timeframe-select');
    const tickerSelect2 = document.getElementById('ticker-select-2');
    const timeframeSelect2 = document.getElementById('timeframe-select-2');
    const toggleSplit = document.getElementById('toggle-split');
    const toggleMA = document.getElementById('toggle-ma');
    const toggleVol = document.getElementById('toggle-vol');
    const toggleRSI = document.getElementById('toggle-rsi');
    const toggleBB = document.getElementById('toggle-bb');
    const indBtn = document.getElementById('ind-btn');
    const indContent = document.getElementById('ind-content');
    const rsiWrapper = document.getElementById('rsi-wrapper');
    const rsiCanvas = document.getElementById('rsi-canvas');
    const rsiCtx = rsiCanvas.getContext('2d');
    const rsiLabel = document.getElementById('rsi-label');
    const obLabel = document.getElementById('ob-label');
    const dragMe = document.getElementById('dragMe');
    const dragRsi = document.getElementById('dragRsi');
    const container1 = document.getElementById('container-1');
    const container2 = document.getElementById('container-2');
    const orderbookPanel = document.getElementById('orderbook-panel');
    const obHeaderToggle = document.getElementById('ob-header-toggle');
    const obContent = document.getElementById('orderbook-content');
    const toggleObBtn = document.getElementById('toggle-ob');
    const drawingToolbar = document.querySelector('.drawing-toolbar');
    const controlsPanel = document.querySelector('.controls');

    window.mainChart = null;
    window.secondaryChart = null;
    let wsOrderbook = null;
    let obActive = true;
    let isResizingSplit = false, isResizingRsi = false, startY = 0, startHeight1 = 0, startHeight2 = 0, startRsiHeight = 0;

    // Тема
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    if (localStorage.getItem('theme') === 'light') { document.body.classList.add('light-theme'); themeIcon.innerText = '☀️'; }
    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        if (document.body.classList.contains('light-theme')) { themeIcon.innerText = '☀️'; localStorage.setItem('theme', 'light'); }
        else { themeIcon.innerText = '🌙'; localStorage.setItem('theme', 'dark'); }
        if (window.mainChart) window.mainChart.draw();
        if (window.secondaryChart) window.secondaryChart.draw();
        if (toggleRSI.checked) drawRSI();
        loadFearGreed();
    });

    indBtn.addEventListener('click', (e) => { e.stopPropagation(); indContent.classList.toggle('show'); });
    window.addEventListener('click', () => { if (indContent.classList.contains('show')) indContent.classList.remove('show'); });
    indContent.addEventListener('click', (e) => e.stopPropagation());

    window.addEventListener('contextmenu', (e) => {
        if (e.target.tagName.toLowerCase() === 'canvas' && (e.target.id === 'chart-canvas-1' || e.target.id === 'chart-canvas-2')) e.preventDefault();
    });
    window.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            if (activeDrawing) {
                activeDrawing = null; drawingStage = 0;
                if (window.mainChart) window.mainChart.draw();
                if (window.secondaryChart) window.secondaryChart.draw();
            } else if (currentTool !== 'cursor') { window.setTool('cursor'); }
        }
    });

    let isDraggingToolbar = false, toolbarStartX = 0, toolbarStartY = 0;
    if (drawingToolbar) {
        drawingToolbar.addEventListener('mousedown', (e) => {
            if (!document.fullscreenElement || e.target.closest('.tool-btn')) return;
            isDraggingToolbar = true; toolbarStartX = e.clientX - drawingToolbar.offsetLeft; toolbarStartY = e.clientY - drawingToolbar.offsetTop;
            drawingToolbar.style.cursor = 'grabbing'; e.preventDefault();
        });
    }
    window.addEventListener('mousemove', (e) => {
        if (isDraggingToolbar && drawingToolbar) {
            drawingToolbar.style.left = `${e.clientX - toolbarStartX}px`; drawingToolbar.style.top = `${e.clientY - toolbarStartY}px`;
        }
    });
    window.addEventListener('mouseup', () => {
        if (isDraggingToolbar && drawingToolbar) { isDraggingToolbar = false; drawingToolbar.style.cursor = 'grab'; }
    });

    class ChartEngine {
        constructor(canvasId, priceId, isSecondary = false) {
            this.canvas = document.getElementById(canvasId); this.ctx = this.canvas.getContext('2d');
            this.wrapper = this.canvas.parentElement; this.priceEl = document.getElementById(priceId); this.isSecondary = isSecondary;
            this.currentTicker = isSecondary ? 'ETHUSDT' : 'BTCUSDT';
            this.timeframe = isSecondary ? timeframeSelect2.value : timeframeSelect.value;
            this.candles = []; this.lastPrice = 0; this.centerIndex = 0; this.visibleCandlesCount = 80; this.zoomY = 1; this.panY = 0;
            this.mouseX = null; this.mouseY = null; this.isDragging = false; this.isDraggingAxis = false; this.ws = null; this.reconnectAttempts = 0;
            this.PADDING_RIGHT = 70; this.PADDING_BOTTOM = 30; this.PADDING_TOP = 10; this.PADDING_LEFT = 10;
            this.initEvents(); attachDrawingEvents(this);
        }

        resize() {
            if (this.wrapper.clientWidth === 0 || this.wrapper.clientHeight === 0) return;
            this.canvas.width = this.wrapper.clientWidth; this.canvas.height = this.wrapper.clientHeight; this.draw();
        }

        dataToCanvas(index, price) {
            const chartWidth = this.canvas.width - this.PADDING_RIGHT - this.PADDING_LEFT;
            const chartHeight = this.canvas.height - this.PADDING_BOTTOM - this.PADDING_TOP;
            const visibleCount = Math.round(this.visibleCandlesCount);
            const startIndex = Math.floor(this.centerIndex - visibleCount / 2);
            const x = this.PADDING_LEFT + (index - startIndex) * (chartWidth / visibleCount);

            const drawStart = Math.max(0, Math.floor(this.centerIndex - visibleCount / 2));
            const drawEnd = Math.min(this.candles.length, Math.ceil(this.centerIndex + visibleCount / 2));
            const visibleCandles = this.candles.slice(drawStart, drawEnd);
            if (visibleCandles.length === 0) return { x, y: 0 };

            let maxPrice = -Infinity, minPrice = Infinity;
            visibleCandles.forEach(c => { if (c.high > maxPrice) maxPrice = c.high; if (c.low < minPrice) minPrice = c.low; });
            const volHeight = toggleVol.checked ? chartHeight * 0.2 : 0;
            const mainChartHeight = chartHeight - volHeight;
            const priceRange = (maxPrice - minPrice) || (maxPrice * 0.01);
            const adjustedRange = priceRange * 1.2 * this.zoomY;
            const midPrice = (maxPrice + minPrice) / 2 + this.panY;
            const topPrice = midPrice + adjustedRange / 2; const bottomPrice = midPrice - adjustedRange / 2;
            const scaleY = mainChartHeight / (topPrice - bottomPrice);
            const y = this.PADDING_TOP + mainChartHeight - (price - bottomPrice) * scaleY;
            return { x, y };
        }

        canvasToData(x, y) {
            const chartWidth = this.canvas.width - this.PADDING_RIGHT - this.PADDING_LEFT;
            const chartHeight = this.canvas.height - this.PADDING_BOTTOM - this.PADDING_TOP;
            const visibleCount = Math.round(this.visibleCandlesCount);
            const startIndex = Math.floor(this.centerIndex - visibleCount / 2);
            const index = startIndex + ((x - this.PADDING_LEFT) / chartWidth) * visibleCount;

            const drawStart = Math.max(0, Math.floor(this.centerIndex - visibleCount / 2));
            const drawEnd = Math.min(this.candles.length, Math.ceil(this.centerIndex + visibleCount / 2));
            const visibleCandles = this.candles.slice(drawStart, drawEnd);
            if (visibleCandles.length === 0) return { index, price: 0 };

            let maxPrice = -Infinity, minPrice = Infinity;
            visibleCandles.forEach(c => { if (c.high > maxPrice) maxPrice = c.high; if (c.low < minPrice) minPrice = c.low; });
            const volHeight = toggleVol.checked ? chartHeight * 0.2 : 0;
            const mainChartHeight = chartHeight - volHeight;
            const priceRange = (maxPrice - minPrice) || (maxPrice * 0.01);
            const adjustedRange = priceRange * 1.2 * this.zoomY;
            const midPrice = (maxPrice + minPrice) / 2 + this.panY;
            const topPrice = midPrice + adjustedRange / 2; const bottomPrice = midPrice - adjustedRange / 2;
            const scaleY = mainChartHeight / (topPrice - bottomPrice);
            const price = bottomPrice + ((this.PADDING_TOP + mainChartHeight - y) / scaleY);
            return { index, price };
        }
                async setTicker(ticker) { this.currentTicker = ticker; await this.loadData(); this.connectWS(); }
        async setTimeframe(tf) { this.timeframe = tf; await this.loadData(); this.connectWS(); }

        async loadData() {
            try {
                const response = await fetch(`/api/history?ticker=${this.currentTicker}&timeframe=${this.timeframe}`);
                const data = await response.json();
                if (data.error) return;
                this.candles = data;
                this.centerIndex = this.candles.length - (this.visibleCandlesCount / 2);
                this.zoomY = 1; this.panY = 0;
                if (this.candles.length > 0) { this.lastPrice = this.candles[this.candles.length - 1].close; this.updatePriceUI(); }
                this.draw();
                if (!this.isSecondary) drawRSI();
            } catch (e) { console.error(e); }
        }

        updateLiveData(newCandle) {
            if (this.candles.length === 0) return;
            if (this.candles[this.candles.length - 1].time === newCandle.time) this.candles[this.candles.length - 1] = newCandle;
            else if (newCandle.time > this.candles[this.candles.length - 1].time) {
                this.candles.push(newCandle);
                if (this.candles.length > 1000) { this.candles.shift(); this.centerIndex -= 1; }
                if (this.centerIndex >= this.candles.length - (this.visibleCandlesCount / 2) - 2) this.centerIndex += 1;
            }
            this.lastPrice = newCandle.close; this.updatePriceUI(); this.draw();
            if (!this.isSecondary) drawRSI();
        }

        connectWS() {
            if (this.ws) this.ws.close();
            const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.ws = new WebSocket(`${wsProto}//${window.location.host}/ws`);
            this.ws.onopen = () => { this.reconnectAttempts = 0; this.ws.send(JSON.stringify({ ticker: this.currentTicker, timeframe: this.timeframe })); };
            this.ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.type === 'update') this.updateLiveData(msg.data); };
            this.ws.onclose = () => { this.reconnectAttempts++; setTimeout(() => this.connectWS(), Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts))); };
        }

        updatePriceUI() {
            this.priceEl.innerText = `$${this.lastPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            if (!this.isSecondary) document.getElementById('live-price').innerText = `$${this.lastPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        }

        calcSMA(data, period) {
            let sma = [];
            for (let i = 0; i < data.length; i++) {
                if (i < period - 1) { sma.push(null); continue; }
                let sum = 0; for (let j = 0; j < period; j++) sum += data[i - j].close;
                sma.push(sum / period);
            }
            return sma;
        }

        calcBB(data, period = 20, multiplier = 2) {
            let upper = [], middle = [], lower = [];
            for (let i = 0; i < data.length; i++) {
                if (i < period - 1) { upper.push(null); middle.push(null); lower.push(null); continue; }
                let sum = 0; for (let j = 0; j < period; j++) sum += data[i - j].close;
                let sma = sum / period; middle.push(sma);
                let variance = 0; for (let j = 0; j < period; j++) variance += Math.pow(data[i - j].close - sma, 2);
                let stdDev = Math.sqrt(variance / period);
                upper.push(sma + multiplier * stdDev); lower.push(sma - multiplier * stdDev);
            }
            return { upper, middle, lower };
        }

        draw() {
            const ctx = this.ctx; const canvas = this.canvas;
            const isLight = document.body.classList.contains('light-theme');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (this.candles.length === 0 || canvas.width === 0) return;

            const visibleCount = Math.round(this.visibleCandlesCount);
            const startIndex = Math.floor(this.centerIndex - visibleCount / 2);
            const endIndex = Math.ceil(this.centerIndex + visibleCount / 2);
            const drawStart = Math.max(0, startIndex); const drawEnd = Math.min(this.candles.length, endIndex);
            const visibleCandles = this.candles.slice(drawStart, drawEnd);
            if (visibleCandles.length === 0) return;

            const chartWidth = canvas.width - this.PADDING_RIGHT - this.PADDING_LEFT;
            const chartHeight = canvas.height - this.PADDING_BOTTOM - this.PADDING_TOP;
            let maxPrice = -Infinity, minPrice = Infinity, maxVol = 0;

            visibleCandles.forEach(c => { if (c.high > maxPrice) maxPrice = c.high; if (c.low < minPrice) minPrice = c.low; if (c.volume > maxVol) maxVol = c.volume; });
            if (toggleBB.checked) {
                const bb = this.calcBB(this.candles);
                for (let i = drawStart; i < drawEnd; i++) { if (bb.upper[i] > maxPrice) maxPrice = bb.upper[i]; if (bb.lower[i] < minPrice) minPrice = bb.lower[i]; }
            }
            let priceRange = maxPrice - minPrice; if (priceRange === 0) priceRange = maxPrice * 0.01;
            const volHeight = toggleVol.checked ? chartHeight * 0.2 : 0;
            const mainChartHeight = chartHeight - volHeight;
            const adjustedRange = priceRange * 1.2 * this.zoomY;
            const midPrice = (maxPrice + minPrice) / 2 + this.panY;
            const topPrice = midPrice + adjustedRange / 2; const bottomPrice = midPrice - adjustedRange / 2;
            const scaleY = mainChartHeight / (topPrice - bottomPrice);
            const priceToY = (price) => this.PADDING_TOP + mainChartHeight - (price - bottomPrice) * scaleY;
            const spacing = chartWidth / visibleCount; const candleWidth = Math.max(2, spacing * 0.7);

            ctx.font = '12px Orbitron'; ctx.fillStyle = isLight ? '#4a5568' : '#a3b1c6';
            ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1;

            for (let i = 0; i <= 5; i++) {
                const price = topPrice - ((topPrice - bottomPrice) / 5) * i;
                const y = this.PADDING_TOP + (mainChartHeight / 5) * i;
                ctx.beginPath(); ctx.moveTo(this.PADDING_LEFT, y); ctx.lineTo(this.PADDING_LEFT + chartWidth, y); ctx.stroke();
                ctx.fillText(price.toFixed(2), this.PADDING_LEFT + chartWidth + 5, y + 4);
            }
            for (let i = 0; i <= 5; i++) {
                const idx = Math.floor(drawStart + (visibleCandles.length / 5) * i);
                if (idx >= this.candles.length) continue;
                const x = this.PADDING_LEFT + (chartWidth / 5) * i;
                ctx.beginPath(); ctx.moveTo(x, this.PADDING_TOP); ctx.lineTo(x, this.PADDING_TOP + chartHeight); ctx.stroke();
                const date = new Date(this.candles[idx].time * 1000);
                let timeStr = date.getHours() + ":" + ("0" + date.getMinutes()).slice(-2);
                if (this.timeframe === '1d' || this.timeframe === '1w' || this.timeframe === '1M') timeStr = date.getDate() + "." + ("0" + (date.getMonth()+1)).slice(-2);
                ctx.fillText(timeStr, x - 15, this.PADDING_TOP + chartHeight + 20);
            }

            if (toggleBB.checked) {
                const bb = this.calcBB(this.candles);
                const drawBBLine = (dataArr, color, dash = []) => {
                    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash); ctx.beginPath();
                    let started = false;
                    for (let i = drawStart; i < drawEnd; i++) {
                        if (dataArr[i] === null) continue;
                        const x = this.PADDING_LEFT + (i - startIndex) * spacing + (spacing / 2);
                        if (x < this.PADDING_LEFT || x > this.PADDING_LEFT + chartWidth) continue;
                        const y = priceToY(dataArr[i]);
                        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
                    }
                    ctx.stroke(); ctx.setLineDash([]);
                };
                drawBBLine(bb.upper, 'rgba(168, 85, 247, 0.6)'); drawBBLine(bb.middle, isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255, 255, 255, 0.3)', [5, 5]); drawBBLine(bb.lower, 'rgba(168, 85, 247, 0.6)');
            }

            for (let i = 0; i < visibleCandles.length; i++) {
                const candle = visibleCandles[i]; const globalIndex = drawStart + i;
                const x = this.PADDING_LEFT + (globalIndex - startIndex) * spacing + (spacing / 2);
                if (x < this.PADDING_LEFT || x > this.PADDING_LEFT + chartWidth) continue;
                const isGreen = candle.close >= candle.open; const color = isGreen ? '#00e676' : '#ff5252';
                ctx.strokeStyle = color; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(x, priceToY(candle.high)); ctx.lineTo(x, priceToY(candle.low)); ctx.stroke();
                ctx.fillStyle = color; ctx.shadowBlur = 8; ctx.shadowColor = color;
                const yOpen = priceToY(candle.open); const yClose = priceToY(candle.close);
                const bodyHeight = Math.abs(yClose - yOpen) || 1; const bodyTop = Math.min(yOpen, yClose);
                ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight); ctx.shadowBlur = 0;
                if (toggleVol.checked) {
                    const volBarHeight = (candle.volume / maxVol) * volHeight;
                    ctx.fillStyle = isGreen ? 'rgba(0, 230, 118, 0.3)' : 'rgba(255, 82, 82, 0.3)';
                    ctx.fillRect(x - candleWidth / 2, this.PADDING_TOP + chartHeight - volBarHeight, candleWidth, volBarHeight);
                }
            }

            if (toggleMA.checked) {
                const sma7 = this.calcSMA(this.candles, 7); const sma25 = this.calcSMA(this.candles, 25);
                const drawLine = (smaData, color) => {
                    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
                    let started = false;
                    for (let i = drawStart; i < drawEnd; i++) {
                        if (smaData[i] === null) continue;
                        const x = this.PADDING_LEFT + (i - startIndex) * spacing + (spacing / 2);
                        if (x < this.PADDING_LEFT || x > this.PADDING_LEFT + chartWidth) continue;
                        const y = priceToY(smaData[i]);
                        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                };
                drawLine(sma7, '#ffeb3b'); drawLine(sma25, '#e91e63');
            }

            const yCurrent = priceToY(this.lastPrice);
            if (yCurrent > this.PADDING_TOP && yCurrent < this.PADDING_TOP + mainChartHeight) {
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(this.PADDING_LEFT, yCurrent); ctx.lineTo(this.PADDING_LEFT + chartWidth, yCurrent); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(0, 229, 255, 0.8)'; ctx.fillRect(this.PADDING_LEFT + chartWidth, yCurrent - 8, 65, 16);
                ctx.fillStyle = '#000'; ctx.fillText(`$${this.lastPrice.toFixed(2)}`, this.PADDING_LEFT + chartWidth + 5, yCurrent + 4);
            }

            if (this.mouseX !== null && this.mouseY !== null && !this.isDragging && !this.isDraggingAxis && !isDraggingObject) {
                if (this.mouseX >= this.PADDING_LEFT && this.mouseX <= this.PADDING_LEFT + chartWidth && this.mouseY >= this.PADDING_TOP && this.mouseY <= this.PADDING_TOP + chartHeight) {
                    ctx.strokeStyle = 'rgba(163, 177, 198, 0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
                    ctx.beginPath(); ctx.moveTo(this.mouseX, this.PADDING_TOP); ctx.lineTo(this.mouseX, this.PADDING_TOP + chartHeight); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(this.PADDING_LEFT, this.mouseY); ctx.lineTo(this.PADDING_LEFT + chartWidth, this.mouseY); ctx.stroke(); ctx.setLineDash([]);
                    const priceAtMouse = bottomPrice + ((this.PADDING_TOP + mainChartHeight - this.mouseY) / scaleY);
                    if (this.mouseY < this.PADDING_TOP + mainChartHeight) {
                        ctx.fillStyle = isLight ? '#ffffff' : '#11151c'; ctx.fillRect(this.PADDING_LEFT + chartWidth, this.mouseY - 8, 65, 16);
                        ctx.fillStyle = isLight ? '#1a202c' : '#a3b1c6'; ctx.fillText(priceAtMouse.toFixed(2), this.PADDING_LEFT + chartWidth + 5, this.mouseY + 4);
                    }
                }
            }
            drawAllDrawings(this);
        }

        initEvents() {
            this.canvas.addEventListener('mousedown', (e) => {
                if (e.button === 2) return;
                const rect = this.canvas.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;

                if (clickX > this.canvas.width - this.PADDING_RIGHT) {
                    this.isDraggingAxis = true; this.canvas.style.cursor = 'ns-resize';
                    this.lastMouseX = e.clientX; this.lastMouseY = e.clientY; return;
                }

                if (currentTool === 'cursor') {
                    // 1. Проверяем, схватили ли мы маркер (ручку) выделенного объекта
                    if (selectedDrawing) {
                        const handle = getHandle(this, selectedDrawing, clickX, clickY);
                        if (handle) {
                            activeHandle = handle;
                            isDraggingObject = true;
                            const dataCoords = this.canvasToData(clickX, clickY);
                            dragStartData = { index: dataCoords.index, price: dataCoords.price };
                            dragStartObj = JSON.parse(JSON.stringify(selectedDrawing)); // копия
                            this.canvas.style.cursor = 'pointer';
                            return;
                        }
                    }

                    // 2. Если не маркер, проверяем клик по самому объекту
                    const clickedObj = hitTest(this, clickX, clickY);
                    if (clickedObj) {
                        if (selectedDrawing === clickedObj) {
                            // Если уже выбран - тащим целиком
                            isDraggingObject = true;
                            activeHandle = 'move';
                            const dataCoords = this.canvasToData(clickX, clickY);
                            dragStartData = { index: dataCoords.index, price: dataCoords.price };
                            dragStartObj = JSON.parse(JSON.stringify(selectedDrawing));
                            this.canvas.style.cursor = 'move';
                        } else {
                            // Выделяем новый
                            selectedDrawing = clickedObj;
                            updateDeleteBtnState(true);
                            this.draw();
                        }
                        return;
                    } else {
                        selectedDrawing = null;
                        updateDeleteBtnState(false);
                        this.draw();
                    }
                }

                if (currentTool !== 'cursor') return;
                this.isDragging = true; this.canvas.style.cursor = 'grabbing';
                this.lastMouseX = e.clientX; this.lastMouseY = e.clientY;
            });

            this.canvas.addEventListener('mousemove', (e) => {
                const rect = this.canvas.getBoundingClientRect();
                this.mouseX = e.clientX - rect.left; this.mouseY = e.clientY - rect.top;

                // Логика изменения размера (за маркер)
                if (isDraggingObject && selectedDrawing && activeHandle !== 'move') {
                    const dataCoords = this.canvasToData(this.mouseX, this.mouseY);

                    if (activeHandle === 'start') {
                        selectedDrawing.startIndex = dataCoords.index;
                        selectedDrawing.startPrice = dataCoords.price;
                    } else if (activeHandle === 'end') {
                        selectedDrawing.endIndex = dataCoords.index;
                        selectedDrawing.endPrice = dataCoords.price;
                    } else if (activeHandle === 'p1' && selectedDrawing.points) {
                        selectedDrawing.points[0].index = dataCoords.index;
                        selectedDrawing.points[0].price = dataCoords.price;
                    } else if (activeHandle === 'p2' && selectedDrawing.points) {
                        selectedDrawing.points[selectedDrawing.points.length-1].index = dataCoords.index;
                        selectedDrawing.points[selectedDrawing.points.length-1].price = dataCoords.price;
                    }
                    this.draw();
                    return;
                }

                // Логика перемещения (за тело)
                if (isDraggingObject && selectedDrawing && activeHandle === 'move') {
                    const dataCoords = this.canvasToData(this.mouseX, this.mouseY);
                    const deltaIndex = dataCoords.index - dragStartData.index;
                    const deltaPrice = dataCoords.price - dragStartData.price;

                    if (selectedDrawing.type === 'brush' && selectedDrawing.points) {
                        selectedDrawing.points = dragStartObj.points.map(pt => ({
                            index: pt.index + deltaIndex,
                            price: pt.price + deltaPrice
                        }));
                    } else {
                        selectedDrawing.startIndex = dragStartObj.startIndex + deltaIndex;
                        selectedDrawing.startPrice = dragStartObj.startPrice + deltaPrice;
                        selectedDrawing.endIndex = dragStartObj.endIndex + deltaIndex;
                        selectedDrawing.endPrice = dragStartObj.endPrice + deltaPrice;
                    }
                    this.draw();
                    return;
                }

                if (this.isDraggingAxis) {
                    const deltaY = e.clientY - this.lastMouseY;
                    this.zoomY = Math.max(0.1, Math.min(10, this.zoomY * (1 + (deltaY / 200))));
                    this.lastMouseX = e.clientX; this.lastMouseY = e.clientY; this.draw(); return;
                }
                if (currentTool !== 'cursor') { this.canvas.style.cursor = 'crosshair'; return; }

                if (!this.isDragging) {
                    if (selectedDrawing) {
                        const handle = getHandle(this, selectedDrawing, this.mouseX, this.mouseY);
                        this.canvas.style.cursor = handle ? 'pointer' : (hitTest(this, this.mouseX, this.mouseY) ? 'move' : 'crosshair');
                    } else {
                        this.canvas.style.cursor = (this.mouseX > this.canvas.width - this.PADDING_RIGHT) ? 'ns-resize' : 'crosshair';
                    }
                    this.draw(); return;
                }
                const deltaX = e.clientX - this.lastMouseX; const deltaY = e.clientY - this.lastMouseY;
                const spacing = (this.canvas.width - this.PADDING_RIGHT) / this.visibleCandlesCount;
                this.centerIndex -= deltaX / spacing; this.panY += deltaY / (this.canvas.height / 1000);
                this.lastMouseX = e.clientX; this.lastMouseY = e.clientY; this.draw();
            });

            this.canvas.addEventListener('mouseup', (e) => {
                if (e.button === 2) return;
                this.isDragging = false; this.isDraggingAxis = false;
                if (isDraggingObject) { isDraggingObject = false; activeHandle = null; }
                this.canvas.style.cursor = 'crosshair';
            });
            this.canvas.addEventListener('mouseleave', () => {
                this.mouseX = null; this.mouseY = null; this.isDragging = false; this.isDraggingAxis = false;
                if (isDraggingObject) { isDraggingObject = false; activeHandle = null; }
                this.canvas.style.cursor = 'crosshair'; this.draw();
            });

            this.canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const rect = this.canvas.getBoundingClientRect(); const mX = e.clientX - rect.left;
                const chartWidth = this.canvas.width - this.PADDING_RIGHT - this.PADDING_LEFT;
                if (mX > this.canvas.width - this.PADDING_RIGHT) {
                    const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95;
                    this.zoomY = Math.max(0.1, Math.min(10, this.zoomY * zoomFactor)); this.draw(); return;
                }
                const startIndex = Math.floor(this.centerIndex - this.visibleCandlesCount / 2);
                const candleUnderMouse = startIndex + (mX / chartWidth) * this.visibleCandlesCount;
                const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95;
                const newVisibleCount = Math.max(10, Math.min(300, this.visibleCandlesCount * zoomFactor));
                const mXPercent = mX / chartWidth;
                this.centerIndex = candleUnderMouse - (mXPercent - 0.5) * newVisibleCount;
                this.visibleCandlesCount = newVisibleCount; this.zoomY = Math.max(0.1, Math.min(10, this.zoomY * zoomFactor)); this.draw();
            });
        }
    }
        function drawingKey(chart) { return `${chart.currentTicker}_${chart.timeframe}`; }
    function getDrawings(chart) {
        const key = drawingKey(chart);
        if (!drawings[key]) drawings[key] = [];
        return drawings[key];
    }

    // Проверка попадания в маркер (ручку)
    function getHandle(chart, prim, x, y) {
        const p1 = chart.dataToCanvas(prim.startIndex, prim.startPrice);
        const p2 = chart.dataToCanvas(prim.endIndex, prim.endPrice);
        const dist = (px, py) => Math.hypot(x - px, y - py);

        // Если это кисть, ищем начало и конец
        if (prim.type === 'brush' && prim.points && prim.points.length > 1) {
            const b1 = chart.dataToCanvas(prim.points[0].index, prim.points[0].price);
            const b2 = chart.dataToCanvas(prim.points[prim.points.length-1].index, prim.points[prim.points.length-1].price);
            if (dist(b1.x, b1.y) < 12) return 'p1';
            if (dist(b2.x, b2.y) < 12) return 'p2';
        } else {
            if (dist(p1.x, p1.y) < 12) return 'start';
            if (dist(p2.x, p2.y) < 12) return 'end';
        }
        return null;
    }

    // Хит-тест самого объекта
    function hitTest(chart, x, y) {
        const list = getDrawings(chart);
        for (let i = list.length - 1; i >= 0; i--) {
            const prim = list[i];
            const p1 = chart.dataToCanvas(prim.startIndex, prim.startPrice);
            const p2 = chart.dataToCanvas(prim.endIndex, prim.endPrice);

            if (prim.type === 'line' || prim.type === 'arrow') {
                if (distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) < 10) return prim;
            } else if (prim.type === 'rect') {
                const x1 = Math.min(p1.x, p2.x), x2 = Math.max(p1.x, p2.x);
                const y1 = Math.min(p1.y, p2.y), y2 = Math.max(p1.y, p2.y);
                if (x >= x1 - 5 && x <= x2 + 5 && y >= y1 - 5 && y <= y2 + 5) return prim;
            } else if (prim.type === 'fib') {
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                for (let l of levels) {
                    const price = prim.startPrice + (prim.endPrice - prim.startPrice) * l;
                    const p = chart.dataToCanvas(prim.startIndex, price);
                    if (y >= p.y - 5 && y <= p.y + 5 && x >= p1.x && x <= p2.x) return prim;
                }
            } else if (prim.type === 'brush' && prim.points) {
                for (let pt of prim.points) {
                    const p = chart.dataToCanvas(pt.index, pt.price);
                    if (Math.hypot(x - p.x, y - p.y) < 10) return prim;
                }
            }
        }
        return null;
    }

    function distToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const l2 = dx * dx + dy * dy;
        if (l2 === 0) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    // Отрисовка маркеров (ручек) для выделенного объекта
    function drawHandles(ctx, chart, prim) {
        const p1 = chart.dataToCanvas(prim.startIndex, prim.startPrice);
        const p2 = chart.dataToCanvas(prim.endIndex, prim.endPrice);

        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;

        const drawDot = (x, y) => {
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        };

        if (prim.type === 'brush' && prim.points && prim.points.length > 0) {
            const b1 = chart.dataToCanvas(prim.points[0].index, prim.points[0].price);
            const b2 = chart.dataToCanvas(prim.points[prim.points.length-1].index, prim.points[prim.points.length-1].price);
            drawDot(b1.x, b1.y);
            drawDot(b2.x, b2.y);
        } else {
            drawDot(p1.x, p1.y);
            drawDot(p2.x, p2.y);
        }
    }

    function drawPrimitive(ctx, chart, prim, isLight) {
        const color = prim.color || '#00e5ff';
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.setLineDash([]);

        const p1 = chart.dataToCanvas(prim.startIndex, prim.startPrice);
        const p2 = chart.dataToCanvas(prim.endIndex, prim.endPrice);

        if (selectedDrawing === prim) {
            ctx.strokeStyle = '#ffeb3b';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            if (prim.type === 'brush' && prim.points.length > 0) {
                const b1 = chart.dataToCanvas(prim.points[0].index, prim.points[0].price);
                const b2 = chart.dataToCanvas(prim.points[prim.points.length-1].index, prim.points[prim.points.length-1].price);
                ctx.strokeRect(Math.min(b1.x, b2.x) - 10, Math.min(b1.y, b2.y) - 10, Math.abs(b2.x - b1.x) + 20, Math.abs(b2.y - b1.y) + 20);
            } else {
                ctx.strokeRect(Math.min(p1.x, p2.x) - 5, Math.min(p1.y, p2.y) - 5, Math.abs(p2.x - p1.x) + 10, Math.abs(p2.y - p1.y) + 10);
            }
            ctx.setLineDash([]);
            ctx.strokeStyle = color;
        }

        ctx.lineWidth = 2;
        if (prim.type === 'line') {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        } else if (prim.type === 'arrow') {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x); const headLen = 12;
            ctx.beginPath(); ctx.moveTo(p2.x, p2.y);
            ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath(); ctx.fill();
        } else if (prim.type === 'rect') {
            const x = Math.min(p1.x, p2.x); const y = Math.min(p1.y, p2.y);
            const w = Math.abs(p2.x - p1.x); const h = Math.abs(p2.y - p1.y);
            const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
            if (isLight) {
                gradient.addColorStop(0, 'rgba(0, 229, 255, 0.15)'); gradient.addColorStop(1, 'rgba(168, 85, 247, 0.05)');
            } else {
                gradient.addColorStop(0, 'rgba(0, 229, 255, 0.12)'); gradient.addColorStop(1, 'rgba(168, 85, 247, 0.03)');
            }
            ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h);
            ctx.lineWidth = 1.5; ctx.strokeStyle = isLight ? 'rgba(0, 180, 216, 0.7)' : 'rgba(0, 229, 255, 0.6)';
            ctx.shadowBlur = 10; ctx.shadowColor = ctx.strokeStyle; ctx.strokeRect(x, y, w, h); ctx.shadowBlur = 0;
            ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
        } else if (prim.type === 'fib') {
            ctx.lineWidth = 1; ctx.font = '11px Orbitron'; ctx.textBaseline = 'middle';
            const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
            levels.forEach(l => {
                const price = prim.startPrice + (prim.endPrice - prim.startPrice) * l;
                const p = chart.dataToCanvas(prim.startIndex, price);

                ctx.strokeStyle = isLight ? 'rgba(0, 150, 180, 0.6)' : 'rgba(0, 229, 255, 0.5)';
                ctx.beginPath(); ctx.moveTo(p1.x, p.y); ctx.lineTo(p2.x, p.y); ctx.stroke();

                const displayLevel = 1 - l;
                ctx.fillStyle = isLight ? '#00875a' : '#00e5ff';
                ctx.fillText(displayLevel.toFixed(3), p2.x + 6, p.y);

                ctx.fillStyle = isLight ? 'rgba(0,0,0,0.5)' : 'rgba(163, 177, 198, 0.7)';
                ctx.fillText(price.toFixed(2), p2.x - 60, p.y);
            });
        } else if (prim.type === 'brush' && prim.points) {
            ctx.beginPath();
            prim.points.forEach((pt, i) => {
                const p = chart.dataToCanvas(pt.index, pt.price);
                if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
        }

        if (selectedDrawing === prim) {
            drawHandles(ctx, chart, prim);
        }
    }

    function drawAllDrawings(chart) {
        const list = getDrawings(chart);
        list.forEach(prim => drawPrimitive(chart.ctx, chart, prim, document.body.classList.contains('light-theme')));
        if (activeDrawing && activeDrawing.chart === chart) {
            drawPrimitive(chart.ctx, chart, activeDrawing.prim, document.body.classList.contains('light-theme'));
        }
    }

    function attachDrawingEvents(chart) {
        const canvas = chart.canvas;
        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 2 || currentTool === 'cursor') return;
            const rect = canvas.getBoundingClientRect();
            if ((e.clientX - rect.left) > chart.canvas.width - chart.PADDING_RIGHT) return;

            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            const dataCoords = chart.canvasToData(x, y);

            selectedDrawing = null; updateDeleteBtnState(false);

            if (currentTool === 'brush') {
                activeDrawing = { chart, prim: { type: 'brush', points: [{ index: dataCoords.index, price: dataCoords.price }], color: '#00e5ff' } };
            } else {
                if (drawingStage === 0) {
                    activeDrawing = { chart, prim: { type: currentTool, startIndex: dataCoords.index, startPrice: dataCoords.price, endIndex: dataCoords.index, endPrice: dataCoords.price, color: '#00e5ff' } };
                    drawingStage = 1;
                } else if (drawingStage === 1 && activeDrawing && activeDrawing.chart === chart) {
                    activeDrawing.prim.endIndex = dataCoords.index;
                    activeDrawing.prim.endPrice = dataCoords.price;
                    getDrawings(chart).push(activeDrawing.prim);
                    activeDrawing = null; drawingStage = 0;
                }
            }
            e.preventDefault(); e.stopPropagation();
        }, true);

        canvas.addEventListener('mousemove', (e) => {
            if (!activeDrawing || activeDrawing.chart !== chart) return;
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            const dataCoords = chart.canvasToData(x, y);

            if (currentTool === 'brush' && e.buttons === 1) {
                activeDrawing.prim.points.push({ index: dataCoords.index, price: dataCoords.price });
                chart.draw();
            } else if (drawingStage === 1 && currentTool !== 'brush') {
                activeDrawing.prim.endIndex = dataCoords.index;
                activeDrawing.prim.endPrice = dataCoords.price;
                chart.draw();
            }
        }, true);

        canvas.addEventListener('mouseup', (e) => {
            if (e.button === 2 || !activeDrawing || activeDrawing.chart !== chart) return;
            if (currentTool === 'brush') {
                getDrawings(chart).push(activeDrawing.prim);
                activeDrawing = null; chart.draw();
            }
            e.preventDefault(); e.stopPropagation();
        }, true);
    }

    window.setTool = function(tool) {
        currentTool = tool; drawingStage = 0; activeDrawing = null; selectedDrawing = null;
        updateDeleteBtnState(false);
        const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
        toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        [window.mainChart, window.secondaryChart].forEach(ch => {
            if (ch) { ch.isDragging = false; ch.isDraggingAxis = false; ch.canvas.style.cursor = 'crosshair'; }
        });
        if (window.mainChart) window.mainChart.draw();
        if (window.secondaryChart) window.secondaryChart.draw();
    };
        // --- КНОПКА УДАЛЕНИЯ (КРЕСТИК / КОРЗИНА) ---
    const deleteBtn = document.getElementById('clear-drawings');
    if (deleteBtn) deleteBtn.style.transition = 'all 0.3s ease';

    function updateDeleteBtnState(active) {
        if (!deleteBtn) return;
        if (active) {
            deleteBtn.style.color = '#ff5252';
            deleteBtn.style.textShadow = '0 0 10px #ff5252';
            deleteBtn.innerHTML = '❌';
            deleteBtn.title = "Удалить выбранный объект";
        } else {
            deleteBtn.style.color = '';
            deleteBtn.style.textShadow = '';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = "Очистить всё";
        }
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!window.mainChart) return;
            if (selectedDrawing) {
                const key = drawingKey(window.mainChart);
                const list = drawings[key];
                if (list) {
                    const index = list.indexOf(selectedDrawing);
                    if (index > -1) list.splice(index, 1);
                }
                selectedDrawing = null;
                updateDeleteBtnState(false);
                window.mainChart.draw();
                if (window.secondaryChart) window.secondaryChart.draw();
            } else {
                drawings[drawingKey(window.mainChart)] = [];
                window.mainChart.draw();
                if (window.secondaryChart) window.secondaryChart.draw();
            }
        });
    }

    // --- FEAR & GREED INDEX ---
    async function loadFearGreed() {
        try {
            const response = await fetch('https://api.alternative.me/fng/');
            const data = await response.json();
            if (data && data.data && data.data[0]) {
                drawFearGreedGauge(parseInt(data.data[0].value));
                document.getElementById('fear-greed-label').innerText = data.data[0].value_classification;
            }
        } catch (e) { console.error(e); }
    }

    function drawFearGreedGauge(value) {
        const canvas = document.getElementById('fear-greed-canvas'); if (!canvas) return;
        const ctx = canvas.getContext('2d'); const centerX = canvas.width / 2; const centerY = canvas.height - 5; const radius = 40;
        const isLight = document.body.classList.contains('light-theme');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath(); ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI);
        ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'; ctx.lineWidth = 6; ctx.stroke();
        const angle = Math.PI + (value / 100) * Math.PI;
        ctx.beginPath(); ctx.arc(centerX, centerY, radius, Math.PI, angle);
        let color = '#00e676'; if (value < 25) color = '#ff5252'; else if (value < 45) color = '#ff9800'; else if (value < 55) color = '#ffeb3b';
        ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.stroke();
        const needleAngle = Math.PI + (value / 100) * Math.PI;
        const needleX = centerX + Math.cos(needleAngle) * (radius - 8); const needleY = centerY + Math.sin(needleAngle) * (radius - 8);
        ctx.beginPath(); ctx.moveTo(centerX, centerY); ctx.lineTo(needleX, needleY);
        ctx.strokeStyle = isLight ? '#1a202c' : '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(centerX, centerY, 2, 0, 2 * Math.PI); ctx.fillStyle = isLight ? '#1a202c' : '#fff'; ctx.fill();
    }
    loadFearGreed(); setInterval(loadFearGreed, 5 * 60 * 1000);

    // --- ТАЙМЕР ---
    function updateTimerFor(chart, elId) {
        if (!chart || chart.candles.length === 0) return;
        const el = document.getElementById(elId); if (!el) return;
        const lastCandleTime = chart.candles[chart.candles.length - 1].time * 1000; const now = Date.now();
        let timeframeMs = 0; const tf = chart.timeframe;
        if (tf === '1') timeframeMs = 60 * 1000; else if (tf === '5') timeframeMs = 5 * 60 * 1000; else if (tf === '15') timeframeMs = 15 * 60 * 1000;
        else if (tf === '60') timeframeMs = 60 * 60 * 1000; else if (tf === '240') timeframeMs = 4 * 60 * 60 * 1000;
        else if (tf === '1d') timeframeMs = 24 * 60 * 60 * 1000; else if (tf === '1w') timeframeMs = 7 * 24 * 60 * 60 * 1000; else if (tf === '1M') timeframeMs = 30 * 24 * 60 * 60 * 1000;
        const candleCloseTime = lastCandleTime + timeframeMs; const timeLeft = candleCloseTime - now;
        if (timeLeft > 0) {
            const hours = Math.floor(timeLeft / (1000 * 60 * 60)); const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)); const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
            let timeStr = ""; if (hours > 0) timeStr = `${hours}ч ${minutes}м ${seconds}с`; else if (minutes > 0) timeStr = `${minutes}м ${seconds}с`; else timeStr = `${seconds}с`;
            el.innerText = `До закрытия: ${timeStr}`;
        } else { el.innerText = `Закрытие...`; }
    }
    function updateTimer() { updateTimerFor(window.mainChart, 'chart-timer'); if (toggleSplit.checked) updateTimerFor(window.secondaryChart, 'chart-timer-2'); }
    setInterval(updateTimer, 1000); updateTimer();

    // --- СТАКАН ---
    function connectOrderbook(ticker) {
        if (wsOrderbook) wsOrderbook.close();
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsOrderbook = new WebSocket(`${wsProto}//${window.location.host}/ws-orderbook`);
        wsOrderbook.onopen = () => wsOrderbook.send(JSON.stringify({ ticker }));
        wsOrderbook.onmessage = (event) => {
            if (!obActive) return;
            const msg = JSON.parse(event.data);
            if (msg.type === 'orderbook') renderOrderbook(msg.data);
        };
        wsOrderbook.onclose = () => setTimeout(() => connectOrderbook(window.mainChart.currentTicker), 3000);
    }

    function renderOrderbook(data) {
        obContent.innerHTML = '';
        const asks = data.a.slice(0, 10).reverse(); const bids = data.b.slice(0, 10);
        let maxVol = 0;
        [...asks, ...bids].forEach(order => { if (parseFloat(order[1]) > maxVol) maxVol = parseFloat(order[1]); });
        asks.forEach(order => {
            const price = parseFloat(order[0]), vol = parseFloat(order[1]);
            obContent.innerHTML += `<div class="ob-row ask ${vol > maxVol*0.5 ? 'whale':''}"><div class="ob-bar" style="width: ${(vol/maxVol)*100}%"></div><span class="price">${price.toFixed(2)}</span><span class="amount">${vol.toFixed(3)}</span></div>`;
        });
        obContent.innerHTML += `<div style="text-align:center; color:#a3b1c6; margin: 5px 0; font-size:11px;">Spread: ${(parseFloat(asks[asks.length-1][0]) - parseFloat(bids[0][0])).toFixed(2)}</div>`;
        bids.forEach(order => {
            const price = parseFloat(order[0]), vol = parseFloat(order[1]);
            obContent.innerHTML += `<div class="ob-row bid ${vol > maxVol*0.5 ? 'whale':''}"><div class="ob-bar" style="width: ${(vol/maxVol)*100}%"></div><span class="price">${price.toFixed(2)}</span><span class="amount">${vol.toFixed(3)}</span></div>`;
        });
    }

    // --- ИНИЦИАЛИЗАЦИЯ ---
    function initCharts() {
        window.mainChart = new ChartEngine('chart-canvas-1', 'chart-price-1', false);
        window.secondaryChart = new ChartEngine('chart-canvas-2', 'chart-price-2', true);
        window.mainChart.setTicker('BTCUSDT'); window.secondaryChart.setTicker('ETHUSDT');
        tickerSelect.value = 'BTCUSDT'; tickerSelect2.value = 'ETHUSDT';
        window.mainChart.resize();
        if (toggleRSI.checked) drawRSI();
        updateLabels(window.mainChart.currentTicker);
        setTimeout(() => { if (toggleSplit.checked) window.secondaryChart.resize(); }, 100);
        connectOrderbook(window.mainChart.currentTicker);
        document.fonts.ready.then(() => {
            if (window.mainChart) window.mainChart.draw();
            if (window.secondaryChart && toggleSplit.checked) window.secondaryChart.draw();
        });
    }

    function drawRSI() {
        if (!toggleRSI.checked || !window.mainChart || window.mainChart.candles.length === 0) { rsiWrapper.style.display = 'none'; return; }
        rsiWrapper.style.display = 'block';
        rsiCanvas.width = rsiWrapper.clientWidth; rsiCanvas.height = rsiWrapper.clientHeight;
        rsiCtx.clearRect(0, 0, rsiCanvas.width, rsiCanvas.height);
        const data = window.mainChart.candles; const period = 14;
        const startIndex = Math.max(0, Math.floor(window.mainChart.centerIndex - window.mainChart.visibleCandlesCount / 2));
        const endIndex = Math.min(data.length, Math.ceil(window.mainChart.centerIndex + window.mainChart.visibleCandlesCount / 2));
        const isLight = document.body.classList.contains('light-theme');

        rsiCtx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'; rsiCtx.setLineDash([5, 5]);
        [30, 70].forEach(level => {
            const y = rsiCanvas.height - (level / 100) * rsiCanvas.height;
            rsiCtx.beginPath(); rsiCtx.moveTo(0, y); rsiCtx.lineTo(rsiCanvas.width, y); rsiCtx.stroke();
        });
        rsiCtx.setLineDash([]); rsiCtx.beginPath(); rsiCtx.strokeStyle = '#00e5ff'; rsiCtx.lineWidth = 2;

        let avgGain = 0, avgLoss = 0;
        const spacing = (rsiCanvas.width - 70) / window.mainChart.visibleCandlesCount;
        for (let i = startIndex; i < endIndex; i++) {
            if (i === 0) continue;
            let change = data[i].close - data[i-1].close;
            let gain = change > 0 ? change : 0; let loss = change < 0 ? -change : 0;
            if (i === startIndex + 1) { avgGain = gain; avgLoss = loss; }
            else { avgGain = (avgGain * (period - 1) + gain) / period; avgLoss = (avgLoss * (period - 1) + loss) / period; }
            let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            let rsi = 100 - (100 / (1 + rs));
            const x = (i - startIndex) * spacing; const y = rsiCanvas.height - (rsi / 100) * rsiCanvas.height;
            if (i === startIndex + 1) rsiCtx.moveTo(x, y); else rsiCtx.lineTo(x, y);
        }
        rsiCtx.stroke();
    }

    function updateLabels(ticker) {
        const name = ticker.replace('USDT', '');
        if(rsiLabel) rsiLabel.innerText = `RSI (${name})`;
        if(obLabel) obLabel.innerText = `Order Book (${name})`;
    }

    // Вешаем события на интерфейс
    const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
    if (toolButtons) { toolButtons.forEach(btn => { btn.addEventListener('click', () => window.setTool(btn.dataset.tool)); }); }

    if (tickerSelect) tickerSelect.addEventListener('change', (e) => { window.mainChart.setTicker(e.target.value); connectOrderbook(e.target.value); updateLabels(e.target.value); });
    if (timeframeSelect) timeframeSelect.addEventListener('change', (e) => { window.mainChart.setTimeframe(e.target.value); drawRSI(); });
    if (tickerSelect2) tickerSelect2.addEventListener('change', (e) => window.secondaryChart.setTicker(e.target.value));
    if (timeframeSelect2) timeframeSelect2.addEventListener('change', (e) => window.secondaryChart.setTimeframe(e.target.value));

    if (toggleObBtn) toggleObBtn.addEventListener('click', (e) => {
        e.stopPropagation(); obActive = !obActive; toggleObBtn.innerText = obActive ? 'ON' : 'OFF';
        toggleObBtn.className = `ob-toggle ${obActive ? '' : 'off'}`;
        if (!obActive) obContent.innerHTML = '<div style="text-align:center; color:#a3b1c6; margin-top:20px;">Стакан отключен</div>';
        else connectOrderbook(window.mainChart.currentTicker);
    });

    if (obHeaderToggle) obHeaderToggle.addEventListener('click', (e) => {
        if (e.target.id === 'toggle-ob') return;
        orderbookPanel.classList.toggle('collapsed');
        setTimeout(() => { if (window.mainChart) window.mainChart.resize(); if (toggleSplit.checked && window.secondaryChart) window.secondaryChart.resize(); drawRSI(); }, 350);
    });

    if (toggleSplit) toggleSplit.addEventListener('change', (e) => {
        if (e.target.checked) {
            container2.style.display = 'flex'; dragMe.style.display = 'block';
            container1.style.height = '400px'; container2.style.height = '400px';
            if (!toggleRSI.checked) container2.style.height = '520px';
            setTimeout(() => { if (window.secondaryChart) { window.secondaryChart.resize(); window.secondaryChart.draw(); } }, 50);
        } else {
            container2.style.display = 'none'; dragMe.style.display = 'none';
            container1.style.height = toggleRSI.checked ? '600px' : '720px';
            setTimeout(() => { if (window.mainChart) window.mainChart.resize(); }, 50);
        }
    });

    if (dragMe) dragMe.addEventListener('mousedown', (e) => { isResizingSplit = true; dragMe.classList.add('active'); startY = e.clientY; startHeight1 = container1.getBoundingClientRect().height; startHeight2 = container2.getBoundingClientRect().height; document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none'; });
    if (dragRsi) dragRsi.addEventListener('mousedown', (e) => { isResizingRsi = true; dragRsi.classList.add('active'); startY = e.clientY; startRsiHeight = rsiWrapper.getBoundingClientRect().height; document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none'; });

    window.addEventListener('mousemove', (e) => {
        if (isResizingSplit) {
            const deltaY = e.clientY - startY;
            container1.style.height = `${Math.max(150, startHeight1 + deltaY)}px`; container2.style.height = `${Math.max(150, startHeight2 - deltaY)}px`;
            if (window.mainChart) window.mainChart.resize(); if (window.secondaryChart) window.secondaryChart.resize();
        } else if (isResizingRsi) {
            const deltaY = startY - e.clientY;
            if (toggleRSI.checked) {
                rsiWrapper.style.height = `${Math.max(50, startRsiHeight + deltaY)}px`;
                if (toggleSplit.checked) { container2.style.height = `${Math.max(150, container2.getBoundingClientRect().height - deltaY)}px`; if (window.secondaryChart) window.secondaryChart.resize(); }
                else { container1.style.height = `${Math.max(150, container1.getBoundingClientRect().height - deltaY)}px`; if (window.mainChart) window.mainChart.resize(); }
                drawRSI();
            }
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizingSplit) { isResizingSplit = false; if (dragMe) dragMe.classList.remove('active'); }
        if (isResizingRsi) { isResizingRsi = false; if (dragRsi) dragRsi.classList.remove('active'); }
        document.body.style.cursor = 'default'; document.body.style.userSelect = 'auto';
        if (window.mainChart) window.mainChart.resize(); if (toggleSplit.checked && window.secondaryChart) window.secondaryChart.resize(); drawRSI();
    });

    const fullscreenBtn = document.getElementById('fullscreen-btn'); const chartWrapper1 = document.getElementById('chart-wrapper-1');
    if (fullscreenBtn && chartWrapper1) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                if (chartWrapper1.requestFullscreen) chartWrapper1.requestFullscreen(); else if (chartWrapper1.webkitRequestFullscreen) chartWrapper1.webkitRequestFullscreen();
                chartWrapper1.classList.add('fullscreen');
                setTimeout(() => { if (window.mainChart) window.mainChart.resize(); if (drawingToolbar && controlsPanel) { chartWrapper1.appendChild(drawingToolbar); drawingToolbar.style.position = 'absolute'; drawingToolbar.style.top = '20px'; drawingToolbar.style.left = '20px'; drawingToolbar.style.zIndex = '9999'; drawingToolbar.style.cursor = 'grab'; } }, 100);
            } else {
                if (document.exitFullscreen) document.exitFullscreen(); chartWrapper1.classList.remove('fullscreen');
                setTimeout(() => { if (window.mainChart) window.mainChart.resize(); if (drawingToolbar && controlsPanel) { const indicatorsPanel = document.querySelector('.indicators-panel'); if (indicatorsPanel) controlsPanel.insertBefore(drawingToolbar, indicatorsPanel); else controlsPanel.appendChild(drawingToolbar); drawingToolbar.style.position = ''; drawingToolbar.style.top = ''; drawingToolbar.style.left = ''; drawingToolbar.style.zIndex = ''; drawingToolbar.style.cursor = ''; } }, 100);
            }
        });
    }
    if (document.addEventListener) {
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && chartWrapper1) {
                chartWrapper1.classList.remove('fullscreen');
                setTimeout(() => { if (window.mainChart) window.mainChart.resize(); if (drawingToolbar && controlsPanel) { const indicatorsPanel = document.querySelector('.indicators-panel'); if (indicatorsPanel) controlsPanel.insertBefore(drawingToolbar, indicatorsPanel); else controlsPanel.appendChild(drawingToolbar); drawingToolbar.style.position = ''; drawingToolbar.style.top = ''; drawingToolbar.style.left = ''; drawingToolbar.style.zIndex = ''; drawingToolbar.style.cursor = ''; } }, 100);
            }
        });
    }

    fetch('/api/symbols')
        .then(r => r.json())
        .then(symbols => {
            if (tickerSelect && tickerSelect2) {
                symbols.forEach(sym => {
                    const name = sym.replace('USDT', '');
                    [tickerSelect, tickerSelect2].forEach(sel => {
                        if (!sel) return;
                        const opt = document.createElement('option'); opt.value = sym; opt.innerText = name; sel.appendChild(opt);
                    });
                });
            }
            initCharts();
        })
        .catch(e => { console.error('Ошибка символов:', e); initCharts(); });

    window.addEventListener('load', () => {
        if (window.mainChart) window.mainChart.resize();
        if (toggleSplit.checked && window.secondaryChart) window.secondaryChart.resize(); drawRSI();
    });
});