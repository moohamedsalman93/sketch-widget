
(function (window, document) {
  "use strict";

  // Default configuration
  const DEFAULT_CONFIG = {
    width: 800,
    height: 600,
    backgroundColor: "#fcfcfa",
    tools: ["pencil", "pen", "marker", "eraser", "lasso", "ruler"],
    colors: [
      "#000000",
      "#FF3B30",
      "#FF9500",
      "#FFCC00",
      "#4CD964",
      "#5AC8FA",
      "#0579FF",
      "#5856D6",
      "#FFFFFF",
    ],
    exportFormat: "svg", // 'svg', 'png', 'both', 'json'
    theme: "light",
    showToolbar: true, // Whether to show toolbar by default
    toolbarPosition: "bottom", // 'top', 'bottom', 'left', 'right', 'floating'
    toolbarOrientation: "horizontal", // 'horizontal', 'vertical'
    toolbarDraggable: true, // Whether toolbar can be dragged
    toolbarCollapsible: true, // Whether toolbar can be collapsed
    toolbarCollapsed: false, // Initial collapsed state
    editable: false, // Whether the widget allows drawing/editing
    readOnly: false, // Alternative way to set non-editable mode
  };

  class SketchWidget {
    constructor(container, config = {}) {
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.container =
        typeof container === "string"
          ? document.querySelector(container)
          : container;

      if (!this.container) {
        throw new Error("SketchWidget: Container element not found");
      }

      // Add new state properties
      this.lassoActive = false;
      this.lassoPoints = [];
      this.lassoSelectedStrokes = [];
      this.lassoDragging = false;
      this.lassoDragStart = null;
      this.lassoLastPos = null;
      this.lassoScale = 1;

      this.rulerActive = false;
      this.rulerStart = null;
      this.rulerEnd = null;

      this.panY = 0;
      this.isPanning = false;
      this.lastPanY = 0;

      // Individual thickness for each tool
      this.toolThickness = {
        pencil: 3,
        pen: 5,
        marker: 10,
        eraser: 15,
      };

      // Alpha control
      this.currentAlpha = 1.0;

      // Enhanced pointer tracking for Apple Pencil support
      this.activePointers = new Map(); // Track active pointers
      this.primaryPointerId = null; // Track the primary drawing pointer
      this.primaryPointerType = null; // Track the type of primary pointer

      // Text selection prevention
      this.originalUserSelect = null; // Store original user-select value
      this.preventingSelection = false; // Track if we're preventing selection

      // Performance optimization - improved for Apple Pencil
      this.redrawTimeout = null;
      this.lastRedrawTime = 0;
      this.redrawThrottle = 8; // ~120fps for better Apple Pencil responsiveness
      this.isDrawing = false;
      this.needsRedraw = false;

      // Stroke caching for better performance
      this.strokeCache = new Map();
      this.cacheCanvas = null;
      this.cacheCtx = null;
      this.cacheDirty = true;

      // Toolbar state
      this.toolbarCollapsed = this.config.toolbarCollapsed;
      this.toolbarVisible = this.config.showToolbar;
      this.toolbarPosition = { x: 0, y: 0 }; // For floating toolbar position
      this.toolbarDragging = false;
      this.toolbarDragStart = null;

      // Editable state - readOnly takes precedence over editable
      this.editable = this.config.readOnly ? false : this.config.editable;

      this.init();
    }

    init() {
      this.createHTML();
      setTimeout(() => {
        this.setupCanvas();
        this.setupTools();
        this.setupEventListeners();
        this.initializeState();
      }, 0);
    }

    addStyles() {
      // Add CSS styles for toolbar animations and layout
      if (!document.getElementById("sketch-widget-styles")) {
        const style = document.createElement("style");
        style.id = "sketch-widget-styles";
        style.textContent = `
            .sketch-toolbar {
              transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
              transform-origin: center;
              backface-visibility: hidden;
              -webkit-backface-visibility: hidden;
            }

            .sketch-toolbar.draggable {
              cursor: default;
              position: absolute;
              z-index: 10;
            }

            .sketch-toolbar.collapsed .toolbar-content {
              transform: scaleX(0);
              opacity: 0;
              width: 0;
              overflow: hidden;
            }

            .sketch-toolbar.collapsed {
              width: 48px !important;
            }

            .toolbar-content {
              transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
              transform-origin: left center;
              display: flex;
              align-items: center;
              gap: 8px;
            }

            .toolbar-toggle {
              flex-shrink: 0;
              transition: transform 0.3s ease;
            }

            .sketch-toolbar.collapsed .toolbar-toggle {
              transform: rotate(180deg);
            }

            .thickness-slider {
              -webkit-appearance: none;
              appearance: none;
              background: #e0e0e0;
              outline: none;
              border-radius: 4px;
            }

            .thickness-slider::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: #007aff;
              cursor: pointer;
            }

            .thickness-slider::-moz-range-thumb {
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: #007aff;
              cursor: pointer;
              border: none;
            }

            .alpha-slider::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: #ff6b35;
              cursor: pointer;
            }

            .alpha-slider::-moz-range-thumb {
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: #ff6b35;
              cursor: pointer;
              border: none;
            }

            .tool-btn:hover {
              background: #e8e8e8 !important;
              border-color: #ccc !important;
              transform: translateY(-1px);
            }

            .tool-btn.active {
              background: #007aff !important;
              color: white !important;
              border-color: #007aff !important;
            }

            .color-swatch:hover {
              transform: scale(1.1);
              border-color: #999 !important;
            }

            .color-swatch.active {
              border-color: #007aff !important;
              border-width: 2px !important;
              transform: scale(1.05);
            }

            .toolbar-controls button:hover {
              background: #e8e8e8 !important;
              border-color: #ccc !important;
              transform: translateY(-1px);
            }

            .toolbar-orientation-toggle:hover,
            .toolbar-toggle:hover {
              background: #e8e8e8 !important;
              border-color: #ccc !important;
              transform: translateY(-1px);
            }

            .sketch-toolbar.hidden {
              display: none !important;
            }

            .sketch-widget.non-editable .sketch-canvas {
              cursor: default !important;
              opacity: 0.8;
            }

            .sketch-widget.non-editable .sketch-toolbar {
              opacity: 0.6;
              pointer-events: none;
            }

            .sketch-widget.non-editable .sketch-toolbar .tool-btn,
            .sketch-widget.non-editable .sketch-toolbar .color-swatch,
            .sketch-widget.non-editable .sketch-toolbar .thickness-slider,
            .sketch-widget.non-editable .sketch-toolbar .alpha-slider,
            .sketch-widget.non-editable .sketch-toolbar button {
              cursor: not-allowed !important;
              opacity: 0.5;
            }
              
            .sketch-toolbar.dragging {
              opacity: 0.9;
              transform: scale(1.01);
              box-shadow: 0 12px 40px rgba(0,0,0,0.25) !important;
              transition: none !important;
              will-change: transform;
              z-index: 10 !important;
            }

            .sketch-toolbar.vertical {
              flex-direction: column;
              width: auto !important;
              min-width: 60px;
              max-width: 100px;
            }

            .sketch-toolbar.vertical .toolbar-content {
              flex-direction: column;
              align-items: center;
              gap: 16px;
              padding: 8px;
            }

            .sketch-toolbar.vertical .toolbar-tools {
              display: flex;
              flex-direction: column;
              gap: 8px;
              border-right: none;
              border-bottom: 1px solid #e0e0e0;
              padding: 0 0 12px 0;
              margin: 0;
              width: 100%;
              align-items: center;
            }

            .sketch-toolbar.vertical .toolbar-controls {
              display: flex;
              flex-direction: column;
              gap: 8px;
              align-items: center;
              border-right: none;
              border-bottom: 1px solid #e0e0e0;
              padding: 0 0 12px 0;
              margin: 0;
              width: 100%;
            }

            .sketch-toolbar.vertical .toolbar-controls .thickness-slider {
              writing-mode: bt-lr;
              -webkit-appearance: slider-vertical;
              width: 6px;
              height: 60px;
              background: #e0e0e0;
              outline: none;
              border-radius: 3px;
            }

            .sketch-toolbar.vertical .color-swatches {
              display: flex;
              flex-direction: column;
              gap: 6px;
              padding: 0;
              align-items: center;
              width: 100%;
            }

            .toolbar-drag-handle {
              cursor: grab;
              padding: 4px;
              border-radius: 4px;
              background: transparent;
              border: 1px dashed #ccc;
              margin: 0 8px 0 0;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #999;
              user-select: none;
              transition: all 0.15s ease;
              min-width: 20px;
              min-height: 20px;
              flex-shrink: 0;
            }

            .toolbar-drag-handle:hover {
              background: #f5f5f5;
              border-color: #999;
              color: #666;
              cursor: grab;
            }

            .toolbar-drag-handle:active {
              cursor: grabbing;
              background: #eee;
              border-color: #666;
              transform: scale(0.98);
            }

            .sketch-toolbar.vertical .toolbar-drag-handle {
              margin: 0 0 8px 0;
              align-self: center;
            }

            .toolbar-orientation-toggle {
              background: #f4f4f4;
              border: none;
              border-radius: 50%;
              width: 32px;
              height: 32px;
              font-size: 14px;
              cursor: pointer;
              margin-left: 8px;
              transition: all 0.2s;
            }

            .toolbar-orientation-toggle:hover {
              background: #e0e0e0;
              transform: scale(1.1);
            }


          `;
        document.head.appendChild(style);
      }
    }

    createHTML() {
      // Handle percentage dimensions by calculating actual size
      const containerRect = this.container.getBoundingClientRect();

      // If container has no dimensions, wait a bit and try again
      if (
        (containerRect.width === 0 || containerRect.height === 0) &&
        (this.config.width === "100%" || this.config.height === "100%")
      ) {
        setTimeout(() => this.createHTML(), 50);
        return;
      }

      const actualWidth =
        this.config.width === "100%"
          ? containerRect.width
          : typeof this.config.width === "string" &&
            this.config.width.includes("%")
          ? (parseFloat(this.config.width) / 100) * containerRect.width
          : parseInt(this.config.width);
      const actualHeight =
        this.config.height === "100%"
          ? containerRect.height
          : typeof this.config.height === "string" &&
            this.config.height.includes("%")
          ? (parseFloat(this.config.height) / 100) * containerRect.height
          : parseInt(this.config.height);

      // Store actual dimensions for canvas
      this.actualWidth = actualWidth || 800;
      this.actualHeight = actualHeight || 600;

      // Add CSS styles
      this.addStyles();

      const editableClass = this.editable ? "" : "non-editable";
      const readOnlyIndicator = this.editable ? "" : "read-only-indicator";

      // Determine layout based on toolbar position
      const isFloating = this.config.toolbarPosition === "floating";
      const containerStyle = isFloating
        ? "position: relative; width: 100%; height: 100%;"
        : this.getContainerLayoutStyle();

      this.container.innerHTML = `
          <div class="sketch-widget ${editableClass} ${readOnlyIndicator}" style="${containerStyle}">
            <div class="canvas-container" style="display: flex; justify-content: center; align-items: center; flex: 1; width: 100%; height: 100%;">
              <canvas class="sketch-canvas" width="${
                this.actualWidth
              }" height="${this.actualHeight}" style="
                background: ${this.config.backgroundColor};
                border-radius: 12px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.1);
                border: 1px solid #e0e0e0;
                touch-action: none;
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                -webkit-tap-highlight-color: transparent;
                user-select: none;
                max-width: 100%;
                max-height: 100%;
                width: ${this.actualWidth}px;
                height: ${this.actualHeight}px;
              "></canvas>
            </div>
            ${this.toolbarVisible ? this.createToolbarHTML() : ""}
          </div>
        `;

      // Wait for the canvas to be in the DOM
      setTimeout(() => {
        if (typeof callback === "function") callback();
      }, 0);
    }

    getContainerLayoutStyle() {
      const position = this.config.toolbarPosition;
      const orientation = this.config.toolbarOrientation;

      switch (position) {
        case "top":
          return `position: relative; display: flex; flex-direction: column; width: ${this.config.width}; height: ${this.config.height};`;
        case "bottom":
          return `position: relative; display: flex; flex-direction: column-reverse; width: ${this.config.width}; height: ${this.config.height};`;
        case "left":
          return `position: relative; display: flex; flex-direction: row; width: ${this.config.width}; height: ${this.config.height};`;
        case "right":
          return `position: relative; display: flex; flex-direction: row-reverse; width: ${this.config.width}; height: ${this.config.height};`;
        default:
          return `position: relative; display: flex; flex-direction: column-reverse; width: ${this.config.width}; height: ${this.config.height};`;
      }
    }

    getToolbarStyle() {
      const position = this.config.toolbarPosition;
      const isFloating = position === "floating";

      let baseStyle = `
          display: flex;
          background: #fff;
          box-shadow: 0 2px 12px rgba(0,0,0,0.15);
          padding: 8px 12px;
          border-radius: 12px;
          border: 1px solid #e0e0e0;
          flex-shrink: 0;
        `;

      if (isFloating) {
        baseStyle += `
            position: absolute;
            top: 0;
            left: 0;
            transform: translate(${this.toolbarPosition.x}px, ${this.toolbarPosition.y}px);
            z-index: 10;
            will-change: transform;
          `;
      } else {
        const marginStyle = this.getToolbarMarginStyle();
        baseStyle += `
            margin: 0 auto;
            width: fit-content;
            ${marginStyle}
          `;

        // Adjust alignment for side positions
        if (position === "left" || position === "right") {
          baseStyle += `
              align-items: ${
                this.config.toolbarOrientation === "vertical"
                  ? "stretch"
                  : "center"
              };
              margin: 16px;
            `;
        } else {
          baseStyle += `align-items: center;`;
        }
      }

      return baseStyle;
    }

    getToolbarMarginStyle() {
      switch (this.config.toolbarPosition) {
        case "top":
          return "margin-bottom: 16px;";
        case "bottom":
          return "margin-top: 16px;";
        case "left":
          return "margin-right: 16px;";
        case "right":
          return "margin-left: 16px;";
        default:
          return "margin-top: 16px;";
      }
    }

    createToolbarHTML() {
      const collapsedClass = this.toolbarCollapsed ? "collapsed" : "";
      const hiddenClass = !this.toolbarVisible ? "hidden" : "";
      const draggableClass = this.config.toolbarDraggable ? "draggable" : "";
      const orientationClass =
        this.config.toolbarOrientation === "vertical" ? "vertical" : "";

      const toolbarStyle = this.getToolbarStyle();

      return `
          <div class="sketch-toolbar ${collapsedClass} ${hiddenClass} ${draggableClass} ${orientationClass}" style="${toolbarStyle}"
               data-toolbar-id="main">
            <div class="toolbar-content">
              ${
                this.config.toolbarDraggable
                  ? `
                <div class="toolbar-drag-handle" title="Drag to move toolbar">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <rect x="2" y="2" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="5.25" y="2" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="8.5" y="2" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="2" y="5.25" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="5.25" y="5.25" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="8.5" y="5.25" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="2" y="8.5" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="5.25" y="8.5" width="1.5" height="1.5" rx="0.5"/>
                    <rect x="8.5" y="8.5" width="1.5" height="1.5" rx="0.5"/>
                  </svg>
                </div>
              `
                  : ""
              }

              <div class="toolbar-tools" style="
                display: flex;
                flex-wrap: wrap;
                max-width: 200px;
                gap: 6px;
                align-items: center;
                padding-right: 12px;
              ">
                ${this.config.tools
                  .map(
                    (tool) => `
                  <button class="tool-btn" data-tool="${tool}" style="
                    border: none;
                    background: #f8f8f8;
                    border-radius: 8px;
                    width: 36px;
                    height: 36px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid transparent;
                  " title="${
                    tool.charAt(0).toUpperCase() + tool.slice(1)
                  }">${this.getToolIcon(tool)}</button>
                `
                  )
                  .join("")}
              </div>

              <div class="toolbar-controls" style="
                display: flex;
                flex-wrap: wrap;
                max-width: 200px;
                gap: 8px;
                align-items: center;
                padding: 0 12px;
              ">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 11px; color: #666; font-weight: 500;">Size</span>
                  <input type="range" class="thickness-slider" min="1" max="30" value="3" style="
                    width: 60px;
                    height: 4px;
                  ">
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 11px; color: #666; font-weight: 500;">Alpha</span>
                  <input type="range" class="alpha-slider" min="0.1" max="1" step="0.1" value="1" style="
                    width: 60px;
                    height: 4px;
                    -webkit-appearance: none;
                    appearance: none;
                    background: #e0e0e0;
                    outline: none;
                    border-radius: 4px;
                  ">
                </div>
                <button class="undo-btn" style="
                  border: none;
                  background: #f8f8f8;
                  border-radius: 6px;
                  width: 28px;
                  height: 28px;
                  font-size: 14px;
                  cursor: pointer;
                  transition: all 0.15s ease;
                  border: 1px solid transparent;
                " title="Undo">↩️</button>
                <button class="redo-btn" style="
                  border: none;
                  background: #f8f8f8;
                  border-radius: 6px;
                  width: 28px;
                  height: 28px;
                  font-size: 14px;
                  cursor: pointer;
                  transition: all 0.15s ease;
                  border: 1px solid transparent;
                " title="Redo">↪️</button>
                <button class="clear-btn" style="
                  border: none;
                  background: #f8f8f8;
                  border-radius: 6px;
                  width: 28px;
                  height: 28px;
                  font-size: 14px;
                  cursor: pointer;
                  transition: all 0.15s ease;
                  border: 1px solid transparent;
                " title="Clear">🗑️</button>
                <button class="export-btn" style="
                  border: none;
                  background: #f8f8f8;
                  border-radius: 6px;
                  width: 28px;
                  height: 28px;
                  font-size: 14px;
                  cursor: pointer;
                  transition: all 0.15s ease;
                  border: 1px solid transparent;
                  display: none;
                " title="Export">💾</button>

              </div>

              <div class="color-swatches" style="
                display: flex;
                gap: 4px;
                align-items: center;
                padding-left: 12px;
                flex-wrap: wrap;
                max-width: 160px;
              ">
                ${this.config.colors
                  .map(
                    (color) => `
                  <button class="color-swatch" data-color="${color}" style="
                    width: 20px;
                    height: 20px;
                    border-radius: 4px;
                    border: 1px solid #ddd;
                    background: ${color};
                    cursor: pointer;
                    transition: all 0.15s ease;
                    ${color === "#FFFFFF" ? "border: 1px solid #bbb;" : ""}
                  " title="Color: ${color}"></button>
                `
                  )
                  .join("")}
              </div>

              <div class="lasso-operations" style="display: none; gap: 8px; align-items: center; padding-left: 16px; border-left: 1px solid #e0e0e0;">
                <button class="lasso-delete-btn" style="
                  border: none;
                  background: #ff4444;
                  color: white;
                  border-radius: 50%;
                  width: 36px;
                  height: 36px;
                  font-size: 16px;
                  cursor: pointer;
                  transition: all 0.2s;
                " title="Delete Selection">🗑️</button>
                <button class="lasso-copy-btn" style="
                  border: none;
                  background: #4444ff;
                  color: white;
                  border-radius: 50%;
                  width: 36px;
                  height: 36px;
                  font-size: 16px;
                  cursor: pointer;
                  transition: all 0.2s;
                " title="Copy Selection">📋</button>
              </div>
            </div>

            <button class="toolbar-orientation-toggle" style="
              border: none;
              background: #f8f8f8;
              border-radius: 6px;
              width: 28px;
              height: 28px;
              font-size: 12px;
              cursor: pointer;
              margin-left: 8px;
              transition: all 0.15s ease;
              border: 1px solid transparent;
              display: none !important;
            " title="Toggle Orientation">${
              this.config.toolbarOrientation === "vertical" ? "↔️" : "↕️"
            }</button>

            ${
              this.config.toolbarCollapsible
                ? `
              <button class="toolbar-toggle" style="
                border: none;
                background: #007aff;
                color: white;
                border-radius: 50%;
                width: 28px;
                height: 28px;
                font-size: 10px;
                cursor: pointer;
                margin-left: 12px;
                transition: all 0.3s;
                display: none;
              " title="Toggle Toolbar">◀</button>
            `
                : ""
            }
          </div>
        `;
    }

    getToolIcon(tool) {
      const icons = {
        pencil: "✏️",
        pen: "🖊️",
        marker: "🖍️",
        eraser: "🧽",
        lasso: "🔲",
        ruler: "📏",
      };
      return icons[tool] || "🖊️";
    }

    setupCanvas() {
      this.canvas = this.container.querySelector(".sketch-canvas");
      this.ctx = this.canvas.getContext("2d");

      // Get device pixel ratio for high-DPI displays
      this.pixelRatio = window.devicePixelRatio || 1;

      // Set up high-DPI canvas
      this.setupHighDPICanvas();

      // Initialize cache canvas for performance
      this.setupCacheCanvas();

      // Initialize drawing state
      this.strokes = [];
      this.undoneStrokes = [];
      this.currentStroke = null;
      this.drawing = false;
      this.currentTool = "pencil";
      this.currentColor = this.config.colors[0];
      this.thickness = 3;
    }

    setupCacheCanvas() {
      // Create an off-screen canvas for caching completed strokes
      this.cacheCanvas = document.createElement("canvas");
      this.cacheCanvas.width = this.actualWidth * this.pixelRatio;
      this.cacheCanvas.height = this.actualHeight * this.pixelRatio;
      this.cacheCtx = this.cacheCanvas.getContext("2d");
      this.cacheCtx.scale(this.pixelRatio, this.pixelRatio);
      this.cacheCtx.imageSmoothingEnabled = true;
      this.cacheCtx.imageSmoothingQuality = "high";
      this.cacheDirty = true;
    }

    setupHighDPICanvas() {
      // Set the internal size to the display size * pixel ratio
      this.canvas.width = this.actualWidth * this.pixelRatio;
      this.canvas.height = this.actualHeight * this.pixelRatio;

      // Scale the canvas back down using CSS
      this.canvas.style.width = this.actualWidth + "px";
      this.canvas.style.height = this.actualHeight + "px";

      // Scale the drawing context so everything draws at the correct size
      this.ctx.scale(this.pixelRatio, this.pixelRatio);

      // Enable better text rendering
      this.ctx.textBaseline = "top";
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";
    }

    // Get accurate coordinates relative to canvas with high precision for Apple Pencil
    getCanvasCoordinates(e) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.actualWidth / rect.width;
      const scaleY = this.actualHeight / rect.height;

      // Use high precision coordinates for better Apple Pencil support
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Ensure coordinates are within canvas bounds
      const clampedX = Math.max(0, Math.min(this.actualWidth, x));
      const clampedY = Math.max(0, Math.min(this.actualHeight, y));

      return {
        x: clampedX,
        y: clampedY,
      };
    }

    setupTools() {
      if (!this.toolbarVisible) return;

      // Tool selection - only if editable
      this.container.querySelectorAll(".tool-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (this.editable) {
            this.setActiveTool(btn.dataset.tool);
          }
        });
      });

      // Color selection - only if editable
      this.container.querySelectorAll(".color-swatch").forEach((swatch) => {
        swatch.addEventListener("click", () => {
          if (this.editable) {
            this.setActiveColor(swatch.dataset.color);
          }
        });
      });

      // Thickness slider - only if editable
      const thicknessSlider = this.container.querySelector(".thickness-slider");
      if (thicknessSlider) {
        thicknessSlider.addEventListener("input", (e) => {
          if (this.editable) {
            this.thickness = parseInt(e.target.value);
            this.toolThickness[this.currentTool] = this.thickness;
          }
        });
      }

      // Alpha slider - only if editable
      const alphaSlider = this.container.querySelector(".alpha-slider");
      if (alphaSlider) {
        alphaSlider.addEventListener("input", (e) => {
          if (this.editable) {
            this.currentAlpha = parseFloat(e.target.value);
          }
        });
      }

      // Control buttons - only if editable
      const undoBtn = this.container.querySelector(".undo-btn");
      if (undoBtn)
        undoBtn.addEventListener("click", () => {
          if (this.editable) this.undo();
        });

      const redoBtn = this.container.querySelector(".redo-btn");
      if (redoBtn)
        redoBtn.addEventListener("click", () => {
          if (this.editable) this.redo();
        });

      const clearBtn = this.container.querySelector(".clear-btn");
      if (clearBtn)
        clearBtn.addEventListener("click", () => {
          if (this.editable) this.clear();
        });

      const exportBtn = this.container.querySelector(".export-btn");
      if (exportBtn)
        exportBtn.addEventListener("click", () => this.exportDrawing());

      // Lasso operations - only if editable
      const lassoDeleteBtn = this.container.querySelector(".lasso-delete-btn");
      if (lassoDeleteBtn)
        lassoDeleteBtn.addEventListener("click", () => {
          if (this.editable) this.deleteLassoSelection();
        });

      const lassoCopyBtn = this.container.querySelector(".lasso-copy-btn");
      if (lassoCopyBtn)
        lassoCopyBtn.addEventListener("click", () => {
          if (this.editable) this.copyLassoSelection();
        });

      // Toolbar toggle
      const toolbarToggle = this.container.querySelector(".toolbar-toggle");
      if (toolbarToggle)
        toolbarToggle.addEventListener("click", () => this.toggleToolbar());

      // Orientation toggle
      const orientationToggle = this.container.querySelector(
        ".toolbar-orientation-toggle"
      );
      if (orientationToggle)
        orientationToggle.addEventListener("click", () =>
          this.toggleOrientation()
        );

      // Drag functionality
      if (this.config.toolbarDraggable) {
        this.setupToolbarDrag();
      }

      // Set initial active states
      this.setActiveTool("pencil");
      this.setActiveColor(this.config.colors[0]);
    }

    setupEventListeners() {
      // Simplified and more reliable event handling for Apple Pencil
      this.canvas.addEventListener(
        "pointerdown",
        (e) => {
          // Prevent all default behaviors that might interfere
          e.preventDefault();
          e.stopPropagation();

          // Debug logging
          console.log(
            `POINTERDOWN: ID=${e.pointerId}, Type=${e.pointerType}, Primary=${e.isPrimary}, Pressure=${e.pressure}`
          );

          // Handle events in the correct order
          this.handlePointerDown(e);

          // Only start drawing for drawing tools
          if (this.currentTool !== "lasso" && this.currentTool !== "ruler") {
            this.startDraw(e);
          } else {
            this.handleLassoStart(e);
            this.handleRulerStart(e);
          }

          this.handlePanStart(e);
        },
        { passive: false }
      );

      this.canvas.addEventListener(
        "pointermove",
        (e) => {
          // Prevent all default behaviors
          e.preventDefault();
          e.stopPropagation();

          // Debug logging (throttled)
          if (
            this.drawing &&
            this.currentStroke &&
            this.currentStroke.points.length % 5 === 0
          ) {
            console.log(
              `POINTERMOVE: ID=${e.pointerId}, Type=${e.pointerType}, Points=${this.currentStroke.points.length}, Pressure=${e.pressure}`
            );
          }

          // Handle drawing first (most important)
          if (this.drawing && e.pointerId === this.primaryPointerId) {
            this.draw(e);
          }

          // Then handle other tools
          this.handleLassoMove(e);
          this.handleRulerMove(e);
          this.handlePanMove(e);
        },
        { passive: false }
      );

      this.canvas.addEventListener(
        "pointerup",
        (e) => {
          // Prevent all default behaviors
          e.preventDefault();
          e.stopPropagation();

          // Debug logging
          console.log(
            `POINTERUP: ID=${e.pointerId}, Type=${e.pointerType}, Strokes=${
              this.strokes.length
            }, CurrentStroke=${
              this.currentStroke
                ? this.currentStroke.points.length + " points"
                : "null"
            }`
          );

          // End drawing first (most important)
          if (this.drawing && e.pointerId === this.primaryPointerId) {
            this.endDraw(e);
          }

          // Then handle other tools
          this.handleLassoEnd(e);
          this.handleRulerEnd(e);
          this.handlePanEnd(e);

          // Finally update pointer state
          this.handlePointerUp(e);
        },
        { passive: false }
      );

      // Handle pointer cancel events (critical for Apple Pencil)
      this.canvas.addEventListener(
        "pointercancel",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log(
            `POINTERCANCEL: ID=${e.pointerId}, Type=${e.pointerType}`
          );

          // Treat cancel as pointer up
          if (this.drawing && e.pointerId === this.primaryPointerId) {
            this.endDraw(e);
          }
          this.handlePointerUp(e);
        },
        { passive: false }
      );

      // Prevent context menu
      this.canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      // Global text selection prevention for all input types
      this.setupGlobalPencilHandling();

      // Add window resize listener for responsive canvas
      if (
        this.config.width === "100%" ||
        this.config.height === "100%" ||
        (typeof this.config.width === "string" &&
          this.config.width.includes("%")) ||
        (typeof this.config.height === "string" &&
          this.config.height.includes("%"))
      ) {
        window.addEventListener("resize", () => {
          clearTimeout(this.resizeTimeout);
          this.resizeTimeout = setTimeout(() => this.resize(), 100);
        });
      }
    }

    // Setup global event listeners to prevent text selection for all input types
    setupGlobalPencilHandling() {
      // Global pointerdown listener to prevent text selection
      this.globalPointerDownHandler = (e) => {
        // Prevent default behavior that might cause text selection
        if (!this.canvas.contains(e.target)) {
          e.preventDefault();
        }
      };

      // Prevent selectstart event when drawing is active
      this.selectStartHandler = (e) => {
        if (this.preventingSelection) {
          e.preventDefault();
          return false;
        }
      };
      document.addEventListener("selectstart", this.selectStartHandler);
    }

    setActiveTool(tool) {
      this.currentTool = tool;
      this.container.querySelectorAll(".tool-btn").forEach((btn) => {
        btn.style.background =
          btn.dataset.tool === tool ? "#d0eaff" : "#f4f4f4";
      });
    }

    setActiveColor(color) {
      this.currentColor = color;
      this.container.querySelectorAll(".color-swatch").forEach((swatch) => {
        swatch.style.transform =
          swatch.dataset.color === color ? "scale(1.1)" : "scale(1)";
        swatch.style.border =
          swatch.dataset.color === color
            ? "2px solid #007aff"
            : "1px solid #e0e0e0";
      });
    }

    resetPointerStates() {
      // Clear all active pointers
      this.activePointers.clear();
      this.primaryPointerId = null;
      this.primaryPointerType = null;

      // Restore text selection if it was prevented
      this.restoreTextSelection();

      // End current drawing if active
      if (this.drawing) {
        this.endCurrentStroke();
      }
    }

    // Prevent text selection on the page when drawing
    preventTextSelection() {
      if (this.preventingSelection) return;

      this.preventingSelection = true;
      this.originalUserSelect = document.body.style.userSelect || "";

      // Apply text selection prevention to body and document
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      document.body.style.mozUserSelect = "none";
      document.body.style.msUserSelect = "none";

      // Also prevent selection on document element
      document.documentElement.style.userSelect = "none";
      document.documentElement.style.webkitUserSelect = "none";
      document.documentElement.style.mozUserSelect = "none";
      document.documentElement.style.msUserSelect = "none";
    }

    // Restore text selection on the page
    restoreTextSelection() {
      if (!this.preventingSelection) return;

      this.preventingSelection = false;

      // Restore original user-select values
      document.body.style.userSelect = this.originalUserSelect;
      document.body.style.webkitUserSelect = "";
      document.body.style.mozUserSelect = "";
      document.body.style.msUserSelect = "";

      document.documentElement.style.userSelect = "";
      document.documentElement.style.webkitUserSelect = "";
      document.documentElement.style.mozUserSelect = "";
      document.documentElement.style.msUserSelect = "";
    }

    startDraw(e) {
      if (!this.editable) {
        console.log(`STARTDRAW BLOCKED: Not editable`);
        return;
      }
      if (this.currentTool === "lasso" || this.currentTool === "ruler") {
        console.log(`STARTDRAW BLOCKED: Tool is ${this.currentTool}`);
        return;
      }

      // Only allow the primary pointer to draw (prevents multi-touch interference)
      if (e.pointerId !== this.primaryPointerId) {
        console.log(
          `STARTDRAW BLOCKED: Not primary pointer (${e.pointerId} vs ${this.primaryPointerId})`
        );
        return;
      }

      console.log(
        `STARTDRAW SUCCESS: ID=${e.pointerId}, Type=${e.pointerType}`
      );

      // Prevent text selection for all input types
      this.preventTextSelection();

      const coords = this.getCanvasCoordinates(e);
      this.drawing = true;
      this.isDrawing = true; // Performance flag
      this.currentStroke = {
        tool: this.currentTool,
        color: this.currentTool === "eraser" ? "#fff" : this.currentColor,
        thickness: this.toolThickness[this.currentTool] || this.thickness,
        alpha: this.currentAlpha,
        points: [{ x: coords.x, y: coords.y }],
        startTime: Date.now(), // Track when stroke started
      };

      // For Apple Pencil, immediately draw the initial point to ensure visibility
      if (e.pointerType === "pen") {
        this.drawIncrementalStroke();
      }
    }

    draw(e) {
      if (!this.editable) return; // Block drawing if not editable
      if (!this.drawing || !this.currentStroke) return;

      // Only allow the primary pointer to draw (prevents multi-touch interference)
      if (e.pointerId !== this.primaryPointerId) return;

      // Get coordinates with high precision
      const coords = this.getCanvasCoordinates(e);
      const pointsLengthBefore = this.currentStroke.points.length;

      // Use different minimum distances based on pointer type for better Apple Pencil support
      let minDistance = 0.8; // Default for touch/mouse
      if (e.pointerType === "pen") {
        // Apple Pencil - use much smaller minimum distance for precision
        minDistance = 0.3;
      } else if (e.pointerType === "touch") {
        // Finger touch - can use slightly larger distance
        minDistance = 1.0;
      }

      this.addPoint(this.currentStroke.points, coords.x, coords.y, minDistance);

      // Only redraw if we actually added a point
      if (this.currentStroke.points.length > pointsLengthBefore) {
        // For performance, use incremental drawing during active drawing
        if (this.isDrawing) {
          this.drawIncrementalStroke();
        } else {
          this.redraw();
        }
      }
    }

    // Draw only the new segment of the current stroke for better performance
    drawIncrementalStroke() {
      if (!this.currentStroke || this.currentStroke.points.length < 2) {
        this.redraw();
        return;
      }

      const points = this.currentStroke.points;
      const len = points.length;

      // Draw only the last few segments for smooth incremental drawing
      if (len >= 2) {
        this.ctx.save();
        this.ctx.translate(0, this.panY);

        // Set stroke properties
        this.setStrokeProperties(this.currentStroke);

        // Draw the new segment
        this.ctx.beginPath();
        const startIdx = Math.max(0, len - 3); // Draw last 3 points for smoothness
        this.ctx.moveTo(points[startIdx].x, points[startIdx].y);

        for (let i = startIdx + 1; i < len; i++) {
          this.ctx.lineTo(points[i].x, points[i].y);
        }

        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    // Extract stroke property setting for reuse
    setStrokeProperties(stroke) {
      this.setStrokePropertiesForContext(stroke, this.ctx);
    }

    setStrokePropertiesForContext(stroke, ctx) {
      ctx.strokeStyle = stroke.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Apply user-controlled alpha with tool-specific adjustments
      let baseAlpha = stroke.alpha || this.currentAlpha;

      if (stroke.tool === "marker") {
        ctx.globalAlpha = baseAlpha * 0.4;
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = 6;
      } else if (stroke.tool === "pen") {
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.shadowBlur = 0;
      } else if (stroke.tool === "pencil") {
        ctx.globalAlpha = baseAlpha * 0.85;
        ctx.shadowBlur = 0;
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = 0.5;
      } else {
        ctx.globalAlpha = baseAlpha;
        ctx.shadowBlur = 0;
      }

      ctx.lineWidth = stroke.thickness;
    }

    addPoint(points, x, y, minDist = 1.5) {
      if (points.length === 0) {
        points.push({ x, y });
        return;
      }

      const last = points[points.length - 1];
      const dx = x - last.x,
        dy = y - last.y;
      if (dx * dx + dy * dy > minDist * minDist) {
        points.push({ x, y });
      }
    }

    endDraw(e) {
      if (!this.editable) {
        console.log(`ENDDRAW BLOCKED: Not editable`);
        return;
      }
      if (!this.drawing || !this.currentStroke) {
        console.log(
          `ENDDRAW BLOCKED: Not drawing (${
            this.drawing
          }) or no current stroke (${!!this.currentStroke})`
        );
        return;
      }

      // Only allow the primary pointer to end drawing (prevents multi-touch interference)
      if (e.pointerId !== this.primaryPointerId) {
        console.log(
          `ENDDRAW BLOCKED: Not primary pointer (${e.pointerId} vs ${this.primaryPointerId})`
        );
        return;
      }

      console.log(
        `ENDDRAW SUCCESS: ID=${e.pointerId}, Type=${e.pointerType}, Points=${this.currentStroke.points.length}`
      );

      // Ensure we have at least one point for single taps
      if (this.currentStroke.points.length === 0) {
        const coords = this.getCanvasCoordinates(e);
        this.currentStroke.points.push({ x: coords.x, y: coords.y });
        console.log(`ADDED FINAL POINT: Single tap stroke`);
      }

      // Add the stroke to the collection
      this.strokes.push(this.currentStroke);
      const strokeIndex = this.strokes.length - 1;

      // Clear current stroke state
      this.currentStroke = null;
      this.drawing = false;
      this.isDrawing = false; // Performance flag
      this.undoneStrokes = [];
      this.cacheDirty = true; // Mark cache as dirty

      // Restore text selection after drawing ends
      this.restoreTextSelection();

      this.forceRedraw();
    }

    // Optimized redraw with throttling
    redraw() {
      this.needsRedraw = true;
      this.scheduleRedraw();
    }

    scheduleRedraw() {
      if (this.redrawTimeout) return; // Already scheduled

      const now = performance.now();
      const timeSinceLastRedraw = now - this.lastRedrawTime;

      if (timeSinceLastRedraw >= this.redrawThrottle) {
        // Enough time has passed, redraw immediately
        this.performRedraw();
      } else {
        // Schedule for later
        const delay = this.redrawThrottle - timeSinceLastRedraw;
        this.redrawTimeout = setTimeout(() => {
          this.performRedraw();
        }, delay);
      }
    }

    performRedraw() {
      if (!this.needsRedraw) return;

      this.redrawTimeout = null;
      this.needsRedraw = false;
      this.lastRedrawTime = performance.now();

      // Clear the entire canvas
      this.ctx.clearRect(0, 0, this.actualWidth, this.actualHeight);
      this.ctx.save();
      this.ctx.translate(0, this.panY);

      // Ensure high quality rendering
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";

      // Use cached strokes if available and not dirty
      if (this.cacheDirty || !this.cacheCanvas) {
        this.updateCache();
      }

      // Draw cached strokes
      if (this.cacheCanvas) {
        this.ctx.drawImage(
          this.cacheCanvas,
          0,
          0,
          this.actualWidth,
          this.actualHeight
        );
      }

      // Draw current stroke if exists (not cached)
      if (this.currentStroke) {
        this.drawStroke(this.currentStroke);
      }

      this.ctx.restore();

      // Draw active tools
      if (this.rulerActive) this.drawRuler();
      if (this.lassoActive || this.lassoSelectedStrokes.length > 0)
        this.drawLasso(true);
    }

    updateCache() {
      if (!this.cacheCanvas || !this.cacheCtx) return;

      // Clear cache canvas
      this.cacheCtx.clearRect(0, 0, this.actualWidth, this.actualHeight);
      this.cacheCtx.save();

      // Draw all completed strokes to cache
      for (const stroke of this.strokes) {
        this.drawStrokeToContext(stroke, this.cacheCtx);
      }

      this.cacheCtx.restore();
      this.cacheDirty = false;
    }

    // Add resize method to handle dynamic container sizing
    resize() {
      const containerRect = this.container.getBoundingClientRect();
      const actualWidth =
        this.config.width === "100%"
          ? containerRect.width
          : typeof this.config.width === "string" &&
            this.config.width.includes("%")
          ? (parseFloat(this.config.width) / 100) * containerRect.width
          : parseInt(this.config.width);
      const actualHeight =
        this.config.height === "100%"
          ? containerRect.height
          : typeof this.config.height === "string" &&
            this.config.height.includes("%")
          ? (parseFloat(this.config.height) / 100) * containerRect.height
          : parseInt(this.config.height);

      this.actualWidth = actualWidth || 800;
      this.actualHeight = actualHeight || 600;

      // Update pixel ratio in case it changed
      this.pixelRatio = window.devicePixelRatio || 1;

      // Update canvas dimensions with high-DPI support
      this.setupHighDPICanvas();

      // Update cache canvas dimensions
      this.setupCacheCanvas();

      // Redraw everything
      this.redraw();
    }

    drawStroke(stroke) {
      this.drawStrokeToContext(stroke, this.ctx);
    }

    drawStrokeToContext(stroke, ctx) {
      ctx.save();

      // Set stroke properties
      this.setStrokePropertiesForContext(stroke, ctx);

      // Handle single point strokes
      const pts = stroke.points;
      if (pts.length < 2) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, stroke.thickness / 2, 0, 2 * Math.PI);
        ctx.fillStyle = stroke.color;
        ctx.globalAlpha = 1.0;
        ctx.fill();
        ctx.restore();
        return;
      }

      const smoothPts = this.movingAverage(pts, 1);
      // Draw smoothed stroke
      ctx.beginPath();
      ctx.moveTo(smoothPts[0].x, smoothPts[0].y);

      for (let i = 1; i < smoothPts.length; i++) {
        ctx.lineTo(smoothPts[i].x, smoothPts[i].y);
      }

      ctx.lineWidth = stroke.thickness;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    undo() {
      if (this.strokes.length > 0) {
        this.undoneStrokes.push(this.strokes.pop());
        this.cacheDirty = true;
        this.redraw();
      }
    }

    redo() {
      if (this.undoneStrokes.length > 0) {
        this.strokes.push(this.undoneStrokes.pop());
        this.cacheDirty = true;
        this.redraw();
      }
    }

    exportDrawing() {
      if (
        this.config.exportFormat === "svg" ||
        this.config.exportFormat === "both"
      ) {
        this.exportSVG();
      }
      if (
        this.config.exportFormat === "png" ||
        this.config.exportFormat === "both"
      ) {
        this.exportPNG();
      }
      if (this.config.exportFormat === "json") {
        this.exportJSON();
      }
    }

    exportSVG() {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", this.actualWidth);
      svg.setAttribute("height", this.actualHeight);
      svg.setAttribute(
        "viewBox",
        `0 0 ${this.actualWidth} ${this.actualHeight}`
      );

      // Add background
      const background = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect"
      );
      background.setAttribute("width", "100%");
      background.setAttribute("height", "100%");
      background.setAttribute("fill", this.config.backgroundColor);
      svg.appendChild(background);

      // Convert strokes to SVG with smoothing
      this.strokes.forEach((stroke) => {
        if (stroke.points.length < 2) {
          const circle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle"
          );
          circle.setAttribute("cx", stroke.points[0].x);
          circle.setAttribute("cy", stroke.points[0].y);
          circle.setAttribute("r", stroke.thickness / 2);
          circle.setAttribute("fill", stroke.color);
          svg.appendChild(circle);
        } else {
          const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
          );

          const smoothPts = this.movingAverage(stroke.points, 3);

          let pathData = `M ${smoothPts[0].x} ${smoothPts[0].y}`;
          for (let i = 1; i < smoothPts.length; i++) {
            pathData += ` L ${smoothPts[i].x} ${smoothPts[i].y}`;
          }

          path.setAttribute("d", pathData);
          path.setAttribute("stroke", stroke.color);
          path.setAttribute("stroke-width", stroke.thickness);
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          path.setAttribute("fill", "none");

          // Add tool-specific effects
          if (stroke.tool === "marker") {
            path.setAttribute("opacity", "0.3");
            path.setAttribute("filter", "url(#marker-filter)");
          } else if (stroke.tool === "pen") {
            path.setAttribute("opacity", "0.7");
          } else if (stroke.tool === "pencil") {
            path.setAttribute("opacity", "0.6");
            path.setAttribute("stroke-dasharray", "0.5 2");
          }

          svg.appendChild(path);
        }
      });

      // Add marker filter definition
      const defs = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "defs"
      );
      const filter = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "filter"
      );
      filter.setAttribute("id", "marker-filter");
      filter.setAttribute("x", "-50%");
      filter.setAttribute("y", "-50%");
      filter.setAttribute("width", "200%");
      filter.setAttribute("height", "200%");

      const blur = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "feGaussianBlur"
      );
      blur.setAttribute("stdDeviation", "1");
      filter.appendChild(blur);
      defs.appendChild(filter);
      svg.insertBefore(defs, svg.firstChild);

      // Download SVG
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: "image/svg+xml" });
      const svgUrl = URL.createObjectURL(svgBlob);

      const link = document.createElement("a");
      link.download = "sketch.svg";
      link.href = svgUrl;
      link.click();

      URL.revokeObjectURL(svgUrl);
    }

    exportPNG() {
      const link = document.createElement("a");
      link.download = "sketch.png";
      link.href = this.canvas.toDataURL("image/png");
      link.click();
    }

    exportJSON() {
      const sketchData = {
        version: "1.0",
        width: this.actualWidth,
        height: this.actualHeight,
        backgroundColor: this.config.backgroundColor,
        strokes: this.strokes.map((stroke) => ({
          tool: stroke.tool,
          color: stroke.color,
          thickness: stroke.thickness,
          points: stroke.points,
        })),
      };

      const json = JSON.stringify(sketchData);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.download = "sketch.json";
      link.href = url;
      link.click();

      URL.revokeObjectURL(url);
    }

    // Public API methods
    clear() {
      this.strokes = [];
      this.undoneStrokes = [];
      this.cacheDirty = true;
      this.redraw();
    }

    getStrokes() {
      return [...this.strokes];
    }

    loadStrokes(strokes) {
      this.strokes = strokes;

      // If canvas is not ready yet, wait for it to be initialized
      if (!this.canvas || !this.ctx) {
        // Store strokes to load later and set up a check
        this.pendingStrokes = strokes;
        const checkCanvas = () => {
          if (this.canvas && this.ctx) {
            this.strokes = this.pendingStrokes;
            this.pendingStrokes = null;
            this.redraw();
          } else {
            setTimeout(checkCanvas, 50);
          }
        };
        setTimeout(checkCanvas, 50);
        return;
      }

      // Canvas is ready, proceed with redraw
      this.redraw();
    }

    initializeState() {
      // Any initialization logic
    }

    // Check if the widget is fully initialized and ready to use
    isReady() {
      return !!(this.canvas && this.ctx);
    }

    // Wait for the widget to be ready, returns a Promise
    waitForReady() {
      return new Promise((resolve) => {
        if (this.isReady()) {
          resolve();
          return;
        }

        const checkReady = () => {
          if (this.isReady()) {
            resolve();
          } else {
            setTimeout(checkReady, 50);
          }
        };

        setTimeout(checkReady, 50);
      });
    }

    // --- New Lasso Tool Methods ---
    handleLassoStart(e) {
      if (!this.editable) return; // Block lasso if not editable
      if (this.currentTool !== "lasso") return;

      const coords = this.getCanvasCoordinates(e);
      if (
        this.lassoSelectedStrokes.length > 0 &&
        this.pointInPolygon(coords, this.lassoPoints)
      ) {
        this.lassoDragging = true;
        this.lassoDragStart = coords;
        this.lassoLastPos = coords;
      } else {
        this.lassoActive = true;
        this.lassoPoints = [coords];
        this.lassoSelectedStrokes = [];
        this.updateLassoButtons(false);
      }
    }

    handleLassoMove(e) {
      if (this.currentTool !== "lasso") return;

      const coords = this.getCanvasCoordinates(e);
      if (this.lassoDragging && this.lassoSelectedStrokes.length > 0) {
        const dx = coords.x - this.lassoLastPos.x;
        const dy = coords.y - this.lassoLastPos.y;

        this.lassoSelectedStrokes.forEach((stroke) => {
          stroke.points.forEach((pt) => {
            pt.x += dx;
            pt.y += dy;
          });
        });

        this.lassoPoints.forEach((pt) => {
          pt.x += dx;
          pt.y += dy;
        });

        this.lassoLastPos = coords;
        this.redraw();
        this.drawLasso(true);
      } else if (this.lassoActive) {
        this.lassoPoints.push(coords);
        this.redraw();
        this.drawLasso();
      }
    }

    handleLassoEnd(e) {
      if (this.currentTool !== "lasso") return;

      if (this.lassoDragging) {
        this.lassoDragging = false;
        this.lassoDragStart = null;
        this.lassoLastPos = null;
      } else if (this.lassoActive) {
        this.lassoActive = false;
        if (this.lassoPoints.length > 2) {
          this.lassoPoints.push(this.lassoPoints[0]);
          this.lassoSelectedStrokes = this.strokes.filter((stroke) =>
            this.strokeInLasso(stroke, this.lassoPoints)
          );
          this.updateLassoButtons(true);
        }
        this.redraw();
        this.drawLasso(true);
      }
    }

    drawLasso(final = false) {
      if (this.lassoPoints.length < 2) return;

      this.ctx.save();
      this.ctx.strokeStyle = final ? "#007aff" : "#aaa";
      this.ctx.setLineDash([4, 4]);
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);

      for (let i = 1; i < this.lassoPoints.length; i++) {
        this.ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }

      this.ctx.stroke();
      this.ctx.setLineDash([]);
      this.ctx.restore();

      if (final && this.lassoSelectedStrokes.length > 0) {
        for (const stroke of this.lassoSelectedStrokes) {
          this.highlightStroke(stroke);
        }
      }
    }

    highlightStroke(stroke) {
      this.ctx.save();
      this.ctx.strokeStyle = "#007aff";
      this.ctx.lineWidth = (stroke.thickness || 3) + 6;
      this.ctx.globalAlpha = 0.2;
      this.ctx.beginPath();
      const pts = stroke.points;
      this.ctx.moveTo(pts[0].x, pts[0].y);

      for (let i = 1; i < pts.length; i++) {
        this.ctx.lineTo(pts[i].x, pts[i].y);
      }

      this.ctx.stroke();
      this.ctx.restore();
    }

    strokeInLasso(stroke, polygon) {
      return stroke.points.some((pt) => this.pointInPolygon(pt, polygon));
    }

    pointInPolygon(point, polygon) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x,
          yi = polygon[i].y;
        const xj = polygon[j].x,
          yj = polygon[j].y;

        const intersect =
          yi > point.y !== yj > point.y &&
          point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0.00001) + xi;

        if (intersect) inside = !inside;
      }
      return inside;
    }

    updateLassoButtons(show) {
      this.showLassoOperations(show);
    }

    deleteLassoSelection() {
      if (this.lassoSelectedStrokes.length > 0) {
        this.strokes = this.strokes.filter(
          (stroke) => !this.lassoSelectedStrokes.includes(stroke)
        );
        this.lassoSelectedStrokes = [];
        this.lassoPoints = [];
        this.updateLassoButtons(false);
        this.redraw();
      }
    }

    copyLassoSelection() {
      if (this.lassoSelectedStrokes.length > 0) {
        const offset = 30;
        const newStrokes = this.lassoSelectedStrokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((pt) => ({
            x: pt.x + offset,
            y: pt.y + offset,
          })),
        }));

        this.strokes = this.strokes.concat(newStrokes);
        this.redraw();
      }
    }

    // --- New Ruler Tool Methods ---
    handleRulerStart(e) {
      if (!this.editable) return; // Block ruler if not editable
      if (this.currentTool !== "ruler") return;

      const coords = this.getCanvasCoordinates(e);
      this.rulerActive = true;
      this.rulerStart = coords;
      this.rulerEnd = coords;
    }

    handleRulerMove(e) {
      if (this.currentTool !== "ruler" || !this.rulerActive) return;

      const coords = this.getCanvasCoordinates(e);
      this.rulerEnd = this.snapToAngle(this.rulerStart, coords);

      this.redraw();
      this.drawRuler();
    }

    handleRulerEnd(e) {
      if (this.currentTool !== "ruler" || !this.rulerActive) return;

      this.rulerActive = false;
      this.strokes.push({
        tool: "pen",
        color: this.currentColor,
        thickness: this.thickness,
        alpha: this.currentAlpha,
        points: [this.rulerStart, this.rulerEnd],
      });

      this.rulerStart = null;
      this.rulerEnd = null;
      this.redraw();
    }

    drawRuler() {
      if (!this.rulerStart || !this.rulerEnd) return;

      this.ctx.save();
      this.ctx.strokeStyle = "#007aff";
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([8, 8]);
      this.ctx.beginPath();
      this.ctx.moveTo(this.rulerStart.x, this.rulerStart.y);
      this.ctx.lineTo(this.rulerEnd.x, this.rulerEnd.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      this.ctx.restore();
    }

    snapToAngle(start, end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const angle = Math.atan2(dy, dx);
      const snap = Math.PI / 12; // 15 degrees
      const snappedAngle = Math.round(angle / snap) * snap;
      const dist = Math.sqrt(dx * dx + dy * dy);

      return {
        x: start.x + Math.cos(snappedAngle) * dist,
        y: start.y + Math.sin(snappedAngle) * dist,
      };
    }

    // --- New Smoothing Functions ---
    getCatmullRomSpline(points, segments = 20) {
      if (points.length < 2) return points;

      const result = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1] || points[i];
        const p3 = points[i + 2] || p2;

        for (let t = 0; t < segments; t++) {
          const s = t / segments;
          const x =
            0.5 *
            (2 * p1.x +
              (-p0.x + p2.x) * s +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s * s +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s * s * s);

          const y =
            0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * s +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s * s +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s * s * s);

          result.push({ x, y });
        }
      }

      result.push(points[points.length - 1]);
      return result;
    }

    movingAverage(points, window = 3) {
      if (points.length <= window) return points;

      const smoothed = [];
      for (let i = 0; i < points.length; i++) {
        let sumX = 0,
          sumY = 0,
          count = 0;

        for (
          let j = Math.max(0, i - window);
          j <= Math.min(points.length - 1, i + window);
          j++
        ) {
          sumX += points[j].x;
          sumY += points[j].y;
          count++;
        }

        smoothed.push({ x: sumX / count, y: sumY / count });
      }

      return smoothed;
    }

    // --- Accept all input types ---
    isValidPointer(e) {
      // Always return true - no validation or restrictions
      return true;
    }

    // Helper method to cleanly end current stroke
    endCurrentStroke() {
      if (this.currentStroke && this.drawing) {
        this.strokes.push(this.currentStroke);
        this.currentStroke = null;
        this.drawing = false;
        this.isDrawing = false;
        this.cacheDirty = true;
      }
    }

    // Track pointer lifecycle - enhanced for Apple Pencil
    handlePointerDown(e) {
      // Track pointer with type information for better debugging
      this.activePointers.set(e.pointerId, {
        startTime: Date.now(),
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
      });

      const wasPrimary = this.primaryPointerId;

      // Set as primary if none exists, prioritizing pen input
      if (this.primaryPointerId === null) {
        this.primaryPointerId = e.pointerId;
        this.primaryPointerType = e.pointerType;
        console.log(
          `PRIMARY SET: ID=${e.pointerId}, Type=${e.pointerType} (was null)`
        );
      } else if (e.pointerType === "pen" && this.primaryPointerType !== "pen") {
        // Switch to pen if it becomes available (Apple Pencil takes priority)
        this.primaryPointerId = e.pointerId;
        this.primaryPointerType = e.pointerType;
        console.log(
          `PRIMARY SWITCHED: ID=${e.pointerId}, Type=${e.pointerType} (was ${wasPrimary})`
        );
      } else {
        console.log(
          `PRIMARY KEPT: Current=${this.primaryPointerId} (${this.primaryPointerType}), New=${e.pointerId} (${e.pointerType})`
        );
      }
    }

    handlePointerUp(e) {
      // Remove from active pointers
      this.activePointers.delete(e.pointerId);
      console.log(
        `POINTER REMOVED: ID=${e.pointerId}, Active count=${this.activePointers.size}`
      );

      // Clear primary pointer if it's being lifted
      if (e.pointerId === this.primaryPointerId) {
        this.primaryPointerId = null;
        this.primaryPointerType = null;
        console.log(`PRIMARY CLEARED: ID=${e.pointerId}`);

        // If there are other active pointers, pick a new primary
        if (this.activePointers.size > 0) {
          const [newPrimaryId, pointerInfo] = this.activePointers
            .entries()
            .next().value;
          this.primaryPointerId = newPrimaryId;
          this.primaryPointerType = pointerInfo.pointerType;
          console.log(
            `NEW PRIMARY: ID=${newPrimaryId}, Type=${pointerInfo.pointerType}`
          );
        }
      }
    }

    // --- Panning Methods ---
    handlePanStart(e) {
      if (this.currentTool === "move") {
        this.isPanning = true;
        this.lastPanY = e.clientY;
      }
    }

    handlePanMove(e) {
      if (this.isPanning) {
        this.panY += e.clientY - this.lastPanY;
        this.lastPanY = e.clientY;
        this.redraw();
      }
    }

    handlePanEnd() {
      this.isPanning = false;
    }

    // --- Toolbar Methods ---
    toggleToolbar() {
      if (!this.config.toolbarCollapsible) return;

      this.toolbarCollapsed = !this.toolbarCollapsed;
      const toolbar = this.container.querySelector(".sketch-toolbar");

      if (this.toolbarCollapsed) {
        toolbar.classList.add("collapsed");
      } else {
        toolbar.classList.remove("collapsed");
      }
    }

    showToolbar() {
      this.toolbarVisible = true;
      const toolbar = this.container.querySelector(".sketch-toolbar");
      if (toolbar) {
        toolbar.classList.remove("hidden");
      }
    }

    hideToolbar() {
      this.toolbarVisible = false;
      const toolbar = this.container.querySelector(".sketch-toolbar");
      if (toolbar) {
        toolbar.classList.add("hidden");
      }
    }

    setToolbarVisibility(visible) {
      if (visible) {
        this.showToolbar();
      } else {
        this.hideToolbar();
      }
    }

    isToolbarVisible() {
      return this.toolbarVisible;
    }

    isToolbarCollapsed() {
      return this.toolbarCollapsed;
    }

    // Toggle toolbar orientation
    toggleOrientation() {
      this.config.toolbarOrientation =
        this.config.toolbarOrientation === "horizontal"
          ? "vertical"
          : "horizontal";

      // Recreate toolbar with new orientation
      this.createHTML();
      setTimeout(() => {
        this.setupCanvas();
        this.setupTools();
        this.setupEventListeners();
      }, 0);
    }

    // Setup toolbar dragging functionality
    setupToolbarDrag() {
      const toolbar = this.container.querySelector(".sketch-toolbar");
      const dragHandle = this.container.querySelector(".toolbar-drag-handle");

      if (!toolbar || !dragHandle) return;

      let isDragging = false;
      let dragStart = { x: 0, y: 0 };
      let toolbarStart = { x: 0, y: 0 };

      const startDrag = (e) => {
        // Check if click is on drag handle or its children
        if (!dragHandle.contains(e.target)) return;

        e.preventDefault();
        e.stopPropagation();

        if (this.config.toolbarPosition !== "floating") {
          // Switch to floating mode when starting to drag
          this.config.toolbarPosition = "floating";
          const rect = toolbar.getBoundingClientRect();
          const containerRect = this.container.getBoundingClientRect();
          this.toolbarPosition = {
            x: Math.max(0, rect.left - containerRect.left),
            y: Math.max(0, rect.top - containerRect.top),
          };

          // Recreate toolbar in floating mode
          this.createHTML();
          setTimeout(() => {
            this.setupCanvas();
            this.setupTools();
            this.setupEventListeners();
          }, 50);
          return;
        }

        isDragging = true;

        dragStart.x = e.clientX || e.touches[0].clientX;
        dragStart.y = e.clientY || e.touches[0].clientY;
        toolbarStart.x = this.toolbarPosition.x;
        toolbarStart.y = this.toolbarPosition.y;

        toolbar.classList.add("dragging");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";

        // Add event listeners
        document.addEventListener("mousemove", drag);
        document.addEventListener("mouseup", endDrag);
        document.addEventListener("touchmove", drag, { passive: false });
        document.addEventListener("touchend", endDrag);
      };

      const drag = (e) => {
        if (!isDragging) return;

        e.preventDefault();

        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);

        if (!clientX || !clientY) return;

        const containerRect = this.container.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();

        const deltaX = clientX - dragStart.x;
        const deltaY = clientY - dragStart.y;

        // Calculate new position with boundary constraints
        const maxX = Math.max(0, containerRect.width - toolbarRect.width);
        const maxY = Math.max(0, containerRect.height - toolbarRect.height);

        const newX = Math.max(0, Math.min(maxX, toolbarStart.x + deltaX));
        const newY = Math.max(0, Math.min(maxY, toolbarStart.y + deltaY));

        this.toolbarPosition.x = newX;
        this.toolbarPosition.y = newY;

        // Apply transform immediately for smooth movement
        toolbar.style.transform = `translate(${newX}px, ${newY}px)`;
      };

      const endDrag = (e) => {
        if (!isDragging) return;

        isDragging = false;

        toolbar.classList.remove("dragging");
        document.body.style.userSelect = "";
        document.body.style.cursor = "";

        // Remove event listeners
        document.removeEventListener("mousemove", drag);
        document.removeEventListener("mouseup", endDrag);
        document.removeEventListener("touchmove", drag);
        document.removeEventListener("touchend", endDrag);

        // Keep transform for consistency
        toolbar.style.transform = `translate(${this.toolbarPosition.x}px, ${this.toolbarPosition.y}px)`;
      };

      // Mouse events
      dragHandle.addEventListener("mousedown", startDrag);

      // Touch events
      dragHandle.addEventListener("touchstart", startDrag, { passive: false });

      // Prevent context menu
      dragHandle.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // Set toolbar position
    setToolbarPosition(position, x = 0, y = 0) {
      this.config.toolbarPosition = position;
      if (position === "floating") {
        this.toolbarPosition = { x, y };
      }

      this.createHTML();
      setTimeout(() => {
        this.setupCanvas();
        this.setupTools();
        this.setupEventListeners();
      }, 0);
    }

    // Cleanup method to remove global event listeners
    destroy() {
      // Remove global event listeners
      if (this.globalPointerDownHandler) {
        document.removeEventListener(
          "pointerdown",
          this.globalPointerDownHandler
        );
      }
      if (this.globalPointerUpHandler) {
        document.removeEventListener("pointerup", this.globalPointerUpHandler);
      }
      if (this.selectStartHandler) {
        document.removeEventListener("selectstart", this.selectStartHandler);
      }

      // Clear timeouts
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      if (this.redrawTimeout) {
        clearTimeout(this.redrawTimeout);
      }

      // Clear container
      if (this.container) {
        this.container.innerHTML = "";
      }
    }

    // Get current toolbar position
    getToolbarPosition() {
      return {
        position: this.config.toolbarPosition,
        orientation: this.config.toolbarOrientation,
        coordinates:
          this.config.toolbarPosition === "floating"
            ? { ...this.toolbarPosition }
            : null,
      };
    }

    showLassoOperations(show = true) {
      const lassoOps = this.container.querySelector(".lasso-operations");
      if (lassoOps) {
        lassoOps.style.display = show ? "flex" : "none";
      }
    }

    // --- Public API Methods ---
    updateConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };

      // Update toolbar visibility if changed
      if (newConfig.hasOwnProperty("showToolbar")) {
        this.setToolbarVisibility(newConfig.showToolbar);
      }

      // Update toolbar collapsed state if changed
      if (newConfig.hasOwnProperty("toolbarCollapsed")) {
        this.toolbarCollapsed = newConfig.toolbarCollapsed;
        this.toggleToolbar();
      }

      // Update editable state if changed
      if (
        newConfig.hasOwnProperty("editable") ||
        newConfig.hasOwnProperty("readOnly")
      ) {
        this.setEditable(newConfig.readOnly ? false : newConfig.editable);
      }

      // Recreate HTML if major changes
      if (
        newConfig.hasOwnProperty("toolbarPosition") ||
        newConfig.hasOwnProperty("tools") ||
        newConfig.hasOwnProperty("colors") ||
        newConfig.hasOwnProperty("editable") ||
        newConfig.hasOwnProperty("readOnly")
      ) {
        this.createHTML();
        setTimeout(() => {
          this.setupCanvas();
          this.setupTools();
          this.setupEventListeners();
        }, 0);
      }
    }

    // Set editable state
    setEditable(editable) {
      this.editable = editable;
      this.config.editable = editable;
      this.config.readOnly = !editable;

      // Update CSS classes
      const widget = this.container.querySelector(".sketch-widget");
      if (widget) {
        if (editable) {
          widget.classList.remove("non-editable", "read-only-indicator");
        } else {
          widget.classList.add("non-editable", "read-only-indicator");
        }
      }
    }

    // Get editable state
    isEditable() {
      return this.editable;
    }

    // Set read-only mode (opposite of editable)
    setReadOnly(readOnly) {
      this.setEditable(!readOnly);
    }

    // Get read-only state
    isReadOnly() {
      return !this.editable;
    }

    getConfig() {
      return { ...this.config };
    }

    // Optimize performance by reducing redraws
    optimizePerformance() {
      // Debounce redraw calls
      if (this.redrawTimeout) {
        clearTimeout(this.redrawTimeout);
      }
      this.redrawTimeout = setTimeout(() => this.redraw(), 16); // ~60fps
    }

    // Force immediate redraw (bypass optimization)
    forceRedraw() {
      if (this.redrawTimeout) {
        clearTimeout(this.redrawTimeout);
      }
      this.redraw();
    }

    // Get widget state for debugging
    getState() {
      return {
        toolbarVisible: this.toolbarVisible,
        toolbarCollapsed: this.toolbarCollapsed,
        editable: this.editable,
        readOnly: !this.editable,
        currentTool: this.currentTool,
        currentColor: this.currentColor,
        thickness: this.thickness,
        strokeCount: this.strokes.length,
        canvasSize: {
          width: this.actualWidth,
          height: this.actualHeight,
        },
      };
    }
  }

  // Expose to global scope
  window.SketchWidget = SketchWidget;

  // Auto-initialize if data-sketch-widget attribute is found
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-sketch-widget]").forEach((element) => {
      const config = {};

      // Parse configuration from data attributes
      if (element.dataset.width) config.width = parseInt(element.dataset.width);
      if (element.dataset.height)
        config.height = parseInt(element.dataset.height);
      if (element.dataset.backgroundColor)
        config.backgroundColor = element.dataset.backgroundColor;
      if (element.dataset.exportFormat)
        config.exportFormat = element.dataset.exportFormat;

      new SketchWidget(element, config);
    });
  });
})(window, document);
