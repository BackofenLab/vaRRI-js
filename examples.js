'use strict';

const EXAMPLES = Object.entries(window.VARRI_EXAMPLES || {})
  .filter(([, example]) => example.originalFigure)
  .map(([id, example]) => ({ id, ...example }));

function buildVaRRIUrl(params) {
  const baseUrl = 'index.html';
  const queryParams = new URLSearchParams();
  queryParams.set('showRenderingOnly', 'true');

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      queryParams.set(key, value);
    }
  }

  const queryString = queryParams.toString();
  if (!queryString) return;

  return `${baseUrl}?${queryString}`;
}

function renderExamples() {
  const container = document.getElementById('examples-container');
  container.innerHTML = '';

  EXAMPLES.forEach(ex => {
    const card = document.createElement('section');
    card.className = 'example-card';
    card.id = ex.id;

    const renderingUrl = buildVaRRIUrl(ex.vaRRIParams);
    const doiLink = ex.doi ? `<a href="${ex.doi}" target="_blank" rel="noopener noreferrer">DOI: ${ex.doi}</a>` : '';
    const pubInfo = ex.authors ? `<span>(${ex.authors})</span>` : '';

    // Build image markup dynamically depending on whether crop coordinates exist
    const crop = ex.originalFigure.crop;
    let imgHtml = '';

    if (crop) {
      const zoom = 100 / crop.width;
      const aspectRatioPadding = (crop.height / crop.width) * 100;
      const figureTitle = ex.originalFigure.title || 'Original Figure';

      imgHtml = `
        <div class="crop-viewport" 
              title="${figureTitle} (${ex.authors})" 
              style="padding-top: ${aspectRatioPadding}%;">
          <div class="crop-zoom-layer">
            <img src="${ex.originalFigure.imageUrl}" 
                  alt="${figureTitle} ${ex.authors}${ex.doi ? ' ' + ex.doi : ''}" 
                  class="cropped-img" 
                  style="
                    width: ${zoom * 100}%; 
                    height: auto; 
                    left: -${(crop.x / crop.width) * 100}%; 
                    top: -${(crop.y / crop.width) * 100}%;
                  " 
                  loading="lazy" />
          </div>
        </div>`;
    } else {
      const figureTitle = ex.originalFigure.title || 'Original Figure';
      imgHtml = `<img src="${ex.originalFigure.imageUrl}" 
                      alt="${figureTitle} ${ex.authors}${ex.doi ? ' ' + ex.doi : ''}" 
                      loading="lazy" />`;
    }

    card.innerHTML = `
    <h2>${ex.name}</h2>
    <div class="example-meta">
      ${pubInfo} ${doiLink ? '• ' + doiLink : ''}
    </div>
    <p>${ex.description}</p>
    <div class="example-side-by-side">
      <div class="example-box">
        <div class="example-box-header">
          <span>📷 Original Publication / Figure</span>
          ${ex.originalFigure.url ? `<a href="${ex.originalFigure.url}" target="_blank" rel="noopener noreferrer">Open Page</a>` : ''}
        </div>
        <div class="example-box-body">
          ${imgHtml}
        </div>
      </div>
      <div class="example-box">
        <div class="example-box-header">
          <span>🧬 vaRRI-js Rendering</span>
          <a href="${renderingUrl.replace('showRenderingOnly=true', '')}" target="_blank" rel="noopener noreferrer">Open Full App</a>
        </div>
        <div class="example-box-body">
          <iframe src="${renderingUrl}" title="vaRRI-js interactive rendering" loading="lazy"></iframe>
        </div>
      </div>
    </div>
  `;

    container.appendChild(card);
  });

  // make the cropped images pan and zoomable
  attachPanAndZoom();
}

function attachPanAndZoom() {
  document.querySelectorAll('.crop-viewport').forEach(viewport => {
    const layer = viewport.querySelector('.crop-zoom-layer');
    if (!layer) return;

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const updateTransform = () => {
      layer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    };

    // --- Mouse Wheel Zooming ---
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();

      // Smooth zoom step
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const newScale = Math.min(Math.max(1, scale * zoomFactor), 5); // Limits zoom between 1x and 5x

      if (newScale === 1) {
        // Reset position when zoomed all the way out
        translateX = 0;
        translateY = 0;
      }

      scale = newScale;
      updateTransform();
    }, { passive: false });

    // --- Click & Drag Panning ---
    viewport.addEventListener('mousedown', (e) => {
      if (scale === 1) return; // Only allow panning when zoomed in
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      updateTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Double click to reset zoom
    viewport.addEventListener('dblclick', () => {
      scale = 1;
      translateX = 0;
      translateY = 0;
      updateTransform();
    });
  });
}

document.addEventListener('DOMContentLoaded', renderExamples);
