/**
 * AnnotationEngine v3
 *
 * Two-canvas architecture:
 *   bgCanvas     – background image only, never drawn on
 *   overlayCanvas – transparent, receives all drawing/text/erase
 *
 * Tools: 'draw' | 'text' | 'erase' | 'select'
 *
 * Select tool:
 *   - Drag to draw a marquee rectangle
 *   - Highlights all annotation strokes / text items that intersect the rect
 *   - Selected items can be:
 *       • Dragged (moved)
 *       • Deleted via Delete/Backspace key or the clearSelected() method
 *   - Click outside selection to deselect
 */
class AnnotationEngine {
  constructor(wrapperId, options = {}) {
    this.wrapper = document.getElementById(wrapperId);
    if (!this.wrapper) { console.error('AnnotationEngine: wrapper not found:', wrapperId); return; }

    this.tool        = options.tool        || 'draw';
    this.color       = options.color       || '#ef4444';
    this.strokeWidth = options.strokeWidth || 4;
    this.fontSize    = options.fontSize    || 28;
    this.fontFamily  = '"Outfit", "Plus Jakarta Sans", sans-serif';

    this.bgImage     = null;
    this.imageLoaded = false;

    this.zoom    = 1.0;
    this.minZoom = 0.25;
    this.maxZoom = 4.0;

    this.annotations = [];
    this.redoStack   = [];

    // Draw state
    this.isDrawing   = false;
    this.currentPath = null;
    this.textInputEl = null;

    // Select state
    this.selectionRect = null;      // {x,y,w,h} in canvas coords while dragging
    this.selectedIndices = [];      // indices into this.annotations
    this.isDraggingSelection = false;
    this.dragStart = null;          // {x,y} canvas coords at drag start

    this._buildCanvases();
    this._initEvents();
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  _buildCanvases() {
    this.wrapper.innerHTML = '';
    this.wrapper.style.position   = 'relative';
    this.wrapper.style.display    = 'inline-block';
    this.wrapper.style.lineHeight = '0';

    this.bgCanvas       = document.createElement('canvas');
    this.bgCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    this.bgCtx = this.bgCanvas.getContext('2d');

    this.overlayCanvas       = document.createElement('canvas');
    this.overlayCanvas.style.cssText = 'position:relative;display:block;background:transparent;cursor:crosshair;';
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.wrapper.appendChild(this.bgCanvas);
    this.wrapper.appendChild(this.overlayCanvas);

    this.canvas = this.overlayCanvas;
    this.ctx    = this.overlayCtx;
  }

  // ── Image ─────────────────────────────────────────────────────────────────

  loadImage(url, callback) {
    this.imageLoaded = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.bgImage     = img;
      this.imageLoaded = true;
      this._applyZoom();
      this._renderBg();
      this._renderOverlay();
      if (callback) callback();
    };
    img.onerror = () => console.error('AnnotationEngine: cannot load image', url);
    img.src = url;
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────

  setZoom(pct) {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, pct / 100));
    this._applyZoom();
    this._renderBg();
    this._renderOverlay();
  }

  _applyZoom() {
    if (!this.bgImage) return;
    const nw = this.bgImage.naturalWidth;
    const nh = this.bgImage.naturalHeight;
    const w = Math.round(nw * this.zoom);
    const h = Math.round(nh * this.zoom);
    
    // Internal resolution is always the natural size of the image
    this.bgCanvas.width = nw;
    this.bgCanvas.height = nh;
    this.overlayCanvas.width = nw;
    this.overlayCanvas.height = nh;
    
    // Visual display size is zoomed
    this.bgCanvas.style.width = w + 'px';
    this.bgCanvas.style.height = h + 'px';
    this.overlayCanvas.style.width = w + 'px';
    this.overlayCanvas.style.height = h + 'px';

    this.wrapper.style.width  = w + 'px';
    this.wrapper.style.height = h + 'px';
  }

  _renderBg() {
    if (!this.bgImage) return;
    this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
    this.bgCtx.drawImage(this.bgImage, 0, 0, this.bgCanvas.width, this.bgCanvas.height);
  }

  _renderOverlay() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    this.annotations.forEach((item, idx) => {
      const isSelected = this.selectedIndices.includes(idx);
      if (item.type === 'path') this._drawPath(ctx, item, isSelected);
      if (item.type === 'text') this._drawText(ctx, item, isSelected);
    });

    // Draw active marquee rectangle
    if (this.selectionRect) {
      const r = this.selectionRect;
      ctx.save();
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(96,165,250,0.08)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }

  // ── Coord helper ──────────────────────────────────────────────────────────

  _getCoords(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    let clientX, clientY;
    
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * (this.overlayCanvas.width  / rect.width),
      y: (clientY - rect.top)  * (this.overlayCanvas.height / rect.height)
    };
  }

  // ── Events ────────────────────────────────────────────────────────────────

  _initEvents() {
    const cv = this.overlayCanvas;

    // ── Scroll wheel zoom ──────────────────────────────────────────────────
    const scrollEl = this.wrapper.closest('.canvas-container') || this.wrapper.parentElement;
    if (scrollEl) {
      scrollEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const f = e.deltaY < 0 ? 1.1 : 0.9;
        this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * f));
        const pct = Math.round(this.zoom * 100);
        const sl = document.getElementById('zoom-slider');
        if (sl) { sl.value = pct; document.getElementById('zoom-val').textContent = pct + '%'; }
        this._applyZoom(); this._renderBg(); this._renderOverlay();
      }, { passive: false });
    }

    // ── Keyboard: Delete selected ──────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIndices.length > 0 && !this.textInputEl) {
        e.preventDefault();
        this.clearSelected();
      }
      if (e.key === 'Escape') {
        this.selectedIndices = [];
        this.selectionRect   = null;
        this._renderOverlay();
      }
    });

    // ── Mouse down ────────────────────────────────────────────────────────
    cv.addEventListener('mousedown', (e) => {
      if (!this.imageLoaded || e.button !== 0 || this.tool === 'navigate') return;
      const coords = this._getCoords(e);

      // ── TEXT ──
      if (this.tool === 'text') {
        if (this.textInputEl) this._commitTextInput();
        this._openTextInput(coords.x, coords.y);
        return;
      }

      // ── SELECT ──
      if (this.tool === 'select') {
        if (this.selectedIndices.length > 0 && this._pointInSelectedBounds(coords)) {
          this.isDraggingSelection = true;
          this.dragStart = coords;
          cv.style.cursor = 'move';
          return;
        }
        this.selectedIndices  = [];
        this.selectionRect    = { x: coords.x, y: coords.y, w: 0, h: 0 };
        this.isDraggingSelection = false;
        this.dragStart = coords;
        return;
      }

      // ── DRAW / ERASE ──
      this.isDrawing   = true;
      this.redoStack   = [];
      this.currentPath = {
        type:   'path',
        mode:   this.tool,
        color:  this.color,
        width:  this.strokeWidth,
        points: [coords]
      };
    });

    // ── Mouse move ────────────────────────────────────────────────────────
    cv.addEventListener('mousemove', (e) => {
      if (!this.imageLoaded || this.tool === 'navigate') return;
      const coords = this._getCoords(e);

      if (this.tool === 'select' && this.isDraggingSelection && this.dragStart) {
        const dx = coords.x - this.dragStart.x;
        const dy = coords.y - this.dragStart.y;
        this._offsetSelected(dx, dy);
        this.dragStart = coords;
        this._renderOverlay();
        return;
      }

      if (this.tool === 'select' && this.selectionRect && !this.isDraggingSelection) {
        this.selectionRect.w = coords.x - this.selectionRect.x;
        this.selectionRect.h = coords.y - this.selectionRect.y;
        this._renderOverlay();
        return;
      }

      if (this.isDrawing && this.currentPath) {
        this.currentPath.points.push(coords);
        this._renderOverlay();
        this._drawPath(this.overlayCtx, this.currentPath, false);
      }
    });

    // ── Mouse up / leave ──────────────────────────────────────────────────
    const endAction = () => {
      if (this.isDraggingSelection) {
        this.isDraggingSelection = false;
        this.dragStart = null;
        cv.style.cursor = 'default';
        return;
      }

      if (this.tool === 'select' && this.selectionRect) {
        this.selectedIndices = this._computeSelection(this.selectionRect);
        this.selectionRect   = null;
        this._renderOverlay();
        return;
      }

      if (this.isDrawing && this.currentPath) {
        this.annotations.push(this.currentPath);
        this.currentPath = null;
        this.isDrawing   = false;
        this._renderOverlay();
      }
    };
    cv.addEventListener('mouseup',    endAction);
    cv.addEventListener('mouseleave', endAction);

    // ── Touch ─────────────────────────────────────────────────────────────
    cv.addEventListener('touchstart', (e) => {
      if (!this.imageLoaded || e.touches.length > 1 || this.tool === 'navigate') return;
      e.preventDefault();
      const coords = this._getCoords(e);
      if (this.tool === 'text') { if (this.textInputEl) this._commitTextInput(); this._openTextInput(coords.x, coords.y); return; }
      if (this.tool === 'select') {
        this.selectedIndices = [];
        this.selectionRect   = { x: coords.x, y: coords.y, w: 0, h: 0 };
        this.dragStart = coords;
        return;
      }
      this.isDrawing   = true; this.redoStack = [];
      this.currentPath = { type:'path', mode:this.tool, color:this.color, width:this.strokeWidth, points:[coords] };
    }, { passive: false });

    cv.addEventListener('touchmove', (e) => {
      if (!this.imageLoaded || e.touches.length > 1 || this.tool === 'navigate') return;
      e.preventDefault();
      const coords = this._getCoords(e);
      if (this.tool === 'select' && this.selectionRect) {
        this.selectionRect.w = coords.x - this.selectionRect.x;
        this.selectionRect.h = coords.y - this.selectionRect.y;
        this._renderOverlay(); return;
      }
      if (this.isDrawing && this.currentPath) {
        this.currentPath.points.push(coords);
        this._renderOverlay();
        this._drawPath(this.overlayCtx, this.currentPath, false);
      }
    }, { passive: false });

    cv.addEventListener('touchend', endAction);
  }

  // ── Draw helpers ──────────────────────────────────────────────────────────

  _drawPath(ctx, path, isSelected) {
    if (!path.points || path.points.length < 1) return;
    ctx.save();
    if (isSelected) {
      // glow ring behind the stroke
      ctx.shadowColor = '#60a5fa';
      ctx.shadowBlur  = 10;
    }
    ctx.beginPath();
    if (path.points.length === 1) {
      ctx.arc(path.points[0].x, path.points[0].y, path.width / 2, 0, Math.PI * 2);
    } else {
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        const p = path.points[i - 1], c = path.points[i];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + c.x) / 2, (p.y + c.y) / 2);
      }
      ctx.lineTo(path.points[path.points.length - 1].x, path.points[path.points.length - 1].y);
    }
    ctx.lineWidth = path.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (path.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ctx.fillStyle = path.color;
    }
    if (path.points.length === 1) ctx.fill(); else ctx.stroke();
    ctx.restore();
  }

  _drawText(ctx, item, isSelected) {
    ctx.save();
    if (isSelected) {
      // highlight background
      const w = ctx.measureText(item.text.split('\n').reduce((a,l) => Math.max(a, ctx.measureText(l).width), 0) || item.size * 6);
      ctx.fillStyle = 'rgba(96,165,250,0.2)';
      ctx.fillRect(item.x - 4, item.y - 4, (w.width || item.size * 6) + 8, item.size * 1.4 * item.text.split('\n').length + 8);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.font         = `bold ${item.size}px ${this.fontFamily}`;
    ctx.fillStyle    = item.color;
    ctx.textBaseline = 'top';
    item.text.split('\n').forEach((line, i) => ctx.fillText(line, item.x, item.y + i * item.size * 1.25));
    ctx.restore();
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  /** Normalise rect so w/h can be negative */
  _normaliseRect(r) {
    return {
      x: r.w < 0 ? r.x + r.w : r.x,
      y: r.h < 0 ? r.y + r.h : r.y,
      w: Math.abs(r.w),
      h: Math.abs(r.h)
    };
  }

  _computeSelection(rect) {
    const r = this._normaliseRect(rect);
    return this.annotations.map((item, idx) => {
      if (item.type === 'path') {
        // any point inside rect → selected
        if (item.points.some(p => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)) return idx;
      }
      if (item.type === 'text') {
        if (item.x >= r.x && item.x <= r.x + r.w && item.y >= r.y && item.y <= r.y + r.h) return idx;
      }
      return -1;
    }).filter(i => i >= 0);
  }

  _getBoundsOfSelected() {
    if (!this.selectedIndices.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.selectedIndices.forEach(idx => {
      const item = this.annotations[idx];
      if (item.type === 'path') item.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
      if (item.type === 'text') { minX = Math.min(minX, item.x); minY = Math.min(minY, item.y); maxX = Math.max(maxX, item.x + item.size * 6); maxY = Math.max(maxY, item.y + item.size); }
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  _pointInSelectedBounds(pt) {
    const b = this._getBoundsOfSelected();
    if (!b) return false;
    const pad = 20;
    return pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;
  }

  _offsetSelected(dx, dy) {
    this.selectedIndices.forEach(idx => {
      const item = this.annotations[idx];
      if (item.type === 'path')  item.points = item.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      if (item.type === 'text')  { item.x += dx; item.y += dy; }
    });
  }

  clearSelected() {
    if (!this.selectedIndices.length) return;
    // Remove in reverse order to preserve indices
    [...this.selectedIndices].sort((a, b) => b - a).forEach(idx => {
      this.redoStack.push({ ...this.annotations[idx], _idx: idx });
      this.annotations.splice(idx, 1);
    });
    this.selectedIndices = [];
    this._renderOverlay();
  }

  // ── Text input ────────────────────────────────────────────────────────────

  _openTextInput(canvasX, canvasY) {
    if (this.textInputEl) return;
    const rect   = this.overlayCanvas.getBoundingClientRect();
    const scaleX = rect.width  / this.overlayCanvas.width;
    const scaleY = rect.height / this.overlayCanvas.height;

    const ta = document.createElement('textarea');
    ta.id = 'annotation-text-input';
    ta.style.cssText = `
      position:fixed;
      left:${canvasX * scaleX + rect.left}px;
      top:${canvasY * scaleY + rect.top}px;
      z-index:99999;
      min-width:180px; min-height:48px;
      padding:6px 10px;
      font:bold ${Math.max(14, this.fontSize * scaleX)}px ${this.fontFamily};
      color:${this.color};
      background:rgba(0,0,0,0.85);
      border:2px solid ${this.color};
      border-radius:6px;
      outline:none; resize:both; line-height:1.3; caret-color:white;
    `;
    ta._cx = canvasX; ta._cy = canvasY;
    document.body.appendChild(ta);
    ta.focus();
    this.textInputEl = ta;

    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this._commitTextInput(); }
      if (ev.key === 'Escape') this._cancelTextInput();
    });
    const outside = (ev) => { if (ev.target !== ta) { this._commitTextInput(); document.removeEventListener('mousedown', outside, true); } };
    ta._outside = outside;
    setTimeout(() => document.addEventListener('mousedown', outside, true), 50);
  }

  _commitTextInput() {
    const ta = this.textInputEl;
    if (!ta) return;
    const val = ta.value.trim();
    if (val) {
      this.annotations.push({ type:'text', color:this.color, size:this.fontSize, text:val, x:ta._cx, y:ta._cy });
      this.redoStack = [];
      this._renderOverlay();
    }
    this._cancelTextInput();
  }

  _cancelTextInput() {
    const ta = this.textInputEl;
    if (!ta) return;
    if (ta._outside) document.removeEventListener('mousedown', ta._outside, true);
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    this.textInputEl = null;
  }

  // ── Undo / Redo / Clear ───────────────────────────────────────────────────

  undo() {
    if (this.textInputEl) { this._cancelTextInput(); return; }
    if (this.annotations.length === 0) return;
    this.redoStack.push(this.annotations.pop());
    this.selectedIndices = [];
    this._renderOverlay();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.annotations.push(this.redoStack.pop());
    this._renderOverlay();
  }

  clear() {
    if (this.textInputEl) this._cancelTextInput();
    if (!this.annotations.length) return;
    this.redoStack = [...this.annotations];
    this.annotations = []; this.selectedIndices = [];
    this._renderOverlay();
  }

  getAnnotations() { return JSON.parse(JSON.stringify(this.annotations)); }

  setAnnotations(a) {
    this.annotations     = a || [];
    this.redoStack       = [];
    this.selectedIndices = [];
    if (this.imageLoaded) this._renderOverlay();
  }

  // compat
  resizeCanvas() { this._applyZoom(); }
  render()       { this._renderBg(); this._renderOverlay(); }
}

// ── Student static viewer ─────────────────────────────────────────────────────
function renderStaticAnnotations(canvas, imgUrl, annotations, onLoaded) {
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const c = canvas.parentElement;
    if (c) {
      const s = Math.min(c.clientWidth / img.naturalWidth, c.clientHeight / img.naturalHeight, 1);
      canvas.style.width  = img.naturalWidth  * s + 'px';
      canvas.style.height = img.naturalHeight * s + 'px';
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    (annotations || []).forEach(item => {
      if (item.type === 'path') {
        if (!item.points?.length) return;
        ctx.save(); ctx.beginPath();
        if (item.points.length === 1) {
          ctx.arc(item.points[0].x, item.points[0].y, item.width / 2, 0, Math.PI * 2);
        } else {
          ctx.moveTo(item.points[0].x, item.points[0].y);
          for (let i = 1; i < item.points.length; i++) {
            const p = item.points[i-1], c = item.points[i];
            ctx.quadraticCurveTo(p.x, p.y, (p.x+c.x)/2, (p.y+c.y)/2);
          }
          ctx.lineTo(item.points[item.points.length-1].x, item.points[item.points.length-1].y);
        }
        ctx.lineWidth = item.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (item.mode === 'erase') { ctx.globalCompositeOperation='destination-out'; ctx.strokeStyle=ctx.fillStyle='rgba(0,0,0,1)'; }
        else { ctx.globalCompositeOperation='source-over'; ctx.strokeStyle=ctx.fillStyle=item.color; }
        if (item.points.length===1) ctx.fill(); else ctx.stroke();
        ctx.restore();
      } else if (item.type === 'text') {
        ctx.save();
        ctx.globalCompositeOperation='source-over';
        ctx.font=`bold ${item.size}px "Outfit", sans-serif`; ctx.fillStyle=item.color; ctx.textBaseline='top';
        item.text.split('\n').forEach((l,i) => ctx.fillText(l, item.x, item.y + i*item.size*1.25));
        ctx.restore();
      }
    });
    if (onLoaded) onLoaded();
  };
  img.src = imgUrl;
}

// ── Student pan/zoom viewer ───────────────────────────────────────────────────
class ZoomPanViewer {
  constructor(containerId, targetId) {
    this.container = document.getElementById(containerId);
    this.target    = document.getElementById(targetId);
    if (!this.container || !this.target) return;
    this.zoom=1; this.panX=0; this.panY=0; this.isPanning=false;
    this._init();
  }
  _init() {
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.min(4, Math.max(0.5, this.zoom * (e.deltaY<0?1.1:0.9)));
      this._apply();
    }, { passive:false });
    let sx=0,sy=0;
    this.container.addEventListener('mousedown', e => { this.isPanning=true; sx=e.clientX-this.panX; sy=e.clientY-this.panY; this.container.style.cursor='grabbing'; });
    this.container.addEventListener('mousemove', e => { if(!this.isPanning)return; this.panX=e.clientX-sx; this.panY=e.clientY-sy; this._apply(); });
    const stop = () => { this.isPanning=false; this.container.style.cursor='grab'; };
    this.container.addEventListener('mouseup', stop);
    this.container.addEventListener('mouseleave', stop);
    this.container.style.cursor='grab';
  }
  _apply() { this.target.style.transform=`translate(${this.panX}px,${this.panY}px) scale(${this.zoom})`; }
  reset()   { this.zoom=1; this.panX=0; this.panY=0; this._apply(); }
}

window.AnnotationEngine = AnnotationEngine;
window.renderStaticAnnotations = renderStaticAnnotations;
window.ZoomPanViewer = ZoomPanViewer;
