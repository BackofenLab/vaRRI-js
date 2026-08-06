
  
// JSON definition of examples for easy extension
const EXAMPLES = [
  {
    id: "coronel-tellez-2022",
    title: "sRNA-controlled iron sparing response in Staphylococci",
    authors: "Coronel-Tellez, et al., 2022",
    doi: "http://dx.doi.org/10.1093/nar/gkac648",
    description: "Reproduction of Figure 6A-bottom showing an interaction with position-specific SHAPE probing data annotation and subsequence highlighting that is cropped to the region of interaction +3 nucleotides.",
    originalFigure: {
      title: "Original Figure 6A-bottom",
      url: "https://www.biorxiv.org/content/10.1101/2022.06.26.497478v1.full#F6",
      imageUrl: "https://www.biorxiv.org/content/biorxiv/early/2022/06/26/2022.06.26.497478/F6.large.jpg",
      crop: { // Crop coordinates for the original figure (in percentages)
        x: 0,       
        y: 0,       
        width: 100, 
        height: 65
      }
    },
    vaRRIParams: {
      sequence:  "AAUUCUAUCUGAAAGAUGUGUGGGGCAUCGUUAUUUUAGGUGGAUAUGAGCAAUUUAUUAAAAGUCAUUUACGGAAAAUAUAUAUAGACGGGGUGAGUAAUAUGCAAGAACAUUUGGUGGUUACACUUGAUAGCAAAGGAGAAGAACUU&UUGAAAAUGAUUAUCAAUACCACAUAGAACAUCCCCCCCACAACGUUUCGUUCUUGUUGGAUUGGUCAUUUUCAAAUAUUCCCCUUUUAUAUGCCCGUAAAAGACAAUAUACGUUAUAACAACGUUUUAUAAAAGCAGUAAACCCUUACGACACUUUAGGUUUACUGCUUUUGU",
      structure: "...............................................................(((.(((((((......((((((((.((((.((((((.(((.............................................&..................................................................))))......))))))))))))))))).))))))).))).....................................................................",
      colorSeq1:"c9c1c9",
      colorSeq2:"c9c1c9",
      startIndex1: 1,
      startIndex2: 1,
      cropping: 3,
      forceLayout: "off",
      backgroundhighlighting: "nothing",
      highlighting: "basepairs",
      subseqHighlights: "1:88-93:0f50b8:1,1:102-104:0e7a06:1,2:81-84:e012dd:1,2:94-96:e012dd:1",
      profileData1:`61 0.6
62 1
63 0.6
64 0.2
65 0.2
66 1
67 0.2
68 0.2
69 0.2
70 0.2
71 0.6
72 1
73 0.6
74 0.6
75 1
76 1
77 0.2
78 0.2
79 0.2
80 0.6
81 0.6
82 0.2
83 0.6
84 0.2
85 0.6
86 0.6
87 0.6
88 0.2
89 0.2
90 0.2
91 0.2
92 0.2
93 0.2
94 0.6
95 0.6
96 0.2
97 0
98 1
99 0.6
100 0.2
101 1
102 0.6
103 0.2
104 0.2
105 0
106 0.2
107 0.2`,
      profileColorRepresentsOne1: 1,
      profileColor1 : "ea373c",
      profileData2: `64 0.6
65 0.2
66 0.2
67 0
68 0.6
69 0.6
70 0.2
71 0.2
72 0
73 1
74 0.2
75 0.2
76 0
77 0.6
78 0.2
79 0.2
80 0.2
81 0.2
82 0.2
83 0.2
84 0.2
85 0.2
86 0.2
87 0.2
88 0.6
89 0.2
90 1
91 0.6
92 0.6
93 1
94 0.2
95 0.2
96 1
97 0.2
98 0.2
99 0.2
100 0.6
101 0.2
102 0.2
103 0.2
104 0
105 0
106 0
107 0.6`,          
      profileColorRepresentsOne2: 1,
      profileColor2 : "ea373c",


    }
  },
  {
    id: "wu-2024",
    title: "RNA interactome of hypervirulent Klebsiella pneumoniae reveals a small RNA inhibitor of capsular mucoviscosity and virulence",
    authors: "Wu et al., 2024",
    doi: "https://doi.org/10.1101/2024.06.23.600155",
    description: "Reproduction of Figure 4C showing an interaction with 4 mutations and a subsequence highlighting within a sequence context upstream of the start codon.",
    originalFigure: {
      title: "Original Figure 4C",
      url: "https://www.biorxiv.org/content/10.1101/2024.06.23.600155v1.full#F4",
      imageUrl: "https://www.biorxiv.org/content/biorxiv/early/2024/06/23/2024.06.23.600155/F4.large.jpg",
      crop: { // Crop coordinates for the original figure (in percentages)
        x: 0,        // Start x
        y: 80,       // Start y
        width: 48,
        height: 30
      }
    },
    vaRRIParams: {
      sequence:  "AACUCGCGAAAGCCAUAAAAACCAGGGAGACA&UUCCCUGGUGUUGGCGCAGUAUUCGCGCA",
      structure: "....((((((.((((.....((((((((....&.))))))))..))))......))))))..",
      startIndex1: -35,
      startIndex2: 2,
      subseqHighlights: "1:-12--6:0dec3f:0.9",
      mutations: "1:-14G:fb0bcb,1:-13G:fb0bcb,2:8C:fb0bcb,2:9C:fb0bcb",
      forceLayout: "on",
      forceLayoutLinear: "on"
    }
  }
];

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
    <h2>${ex.title}</h2>
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
