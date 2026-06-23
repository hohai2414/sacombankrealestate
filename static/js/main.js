// State Management
let activeImages = {}; // stores metadata for each image item: file, rotation, canvas, status
let tesseractWorker = null;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initUploadEvents();
    initTableEvents();
    initModalEvents();
    initTesseract();
});

// --- Theme Management ---
function initTheme() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme');

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.classList.add('dark-theme');
    }

    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
}

// --- Tesseract Initialization ---
async function initTesseract() {
    try {
        console.log("Initializing Tesseract.js worker with local offline tessdata...");
        // Tesseract.js v5 API: pass languages directly as the first argument, 
        // options/logger as the third argument. We host langPath locally on our Flask server.
        tesseractWorker = await Tesseract.createWorker('vie+eng', 1, {
            langPath: window.location.origin + '/static/tessdata/',
            logger: m => {
                if (m.status === 'recognizing text') {
                    // Find the active loading item and update progress
                    // m.progress is between 0 and 1
                    updateOCRProgress(m.progress);
                }
            }
        });
        console.log("Tesseract.js worker initialized successfully!");
    } catch (err) {
        console.error("Failed to initialize Tesseract worker:", err);
        showToast("Lỗi khởi tạo OCR. Vui lòng tải lại trang hoặc kiểm tra kết nối mạng.", "error");
    }
}

// --- Upload Management ---
function initUploadEvents() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    // Safe click forwarding: Click anywhere inside the drop-zone (including labels/icons) 
    // triggers the hidden file input click, but ONLY if we didn't click the input directly.
    dropZone.addEventListener('click', (e) => {
        if (e.target !== fileInput) {
            fileInput.click();
        }
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = ''; // reset
    });

    // Drag and drop styles
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        }, false);
    });

    // Consolidated drop event
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
        
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }, false);
}

function handleFiles(files) {
    if (files.length === 0) return;

    showToast(`Đang thêm ${files.length} ảnh vào hàng đợi...`, 'info');

    // Hide empty table state on start
    const emptyRow = document.getElementById('empty-table-row');
    if (emptyRow) emptyRow.style.display = 'none';

    // Remove empty list state in sidebar
    const imageList = document.getElementById('image-list');
    const emptyListState = imageList.querySelector('.empty-list-state');
    if (emptyListState) emptyListState.remove();

    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) {
            showToast(`File "${file.name}" không phải là ảnh!`, 'error');
            return;
        }
        createImageQueueItem(file);
    });
}

function createImageQueueItem(file) {
    const imageList = document.getElementById('image-list');
    const itemId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create thumbnail URL (local file)
    const thumbUrl = URL.createObjectURL(file);

    // Create item state
    activeImages[itemId] = {
        file: file,
        rotation: 0,
        preprocessedUrl: null,
        status: 'pending',
        originalFilename: file.name
    };

    // Create item in sidebar list
    const itemEl = document.createElement('div');
    itemEl.className = 'image-item';
    itemEl.id = itemId;
    itemEl.innerHTML = `
        <div class="image-item-info">
            <img class="image-item-thumbnail" src="${thumbUrl}" alt="Thumbnail">
            <div class="image-item-text">
                <span class="image-item-name" title="${file.name}">${file.name}</span>
                <span class="image-item-status status-loading">
                    <span class="spinner"></span>Đang chuẩn bị...
                </span>
            </div>
        </div>
        <div class="image-item-actions">
            <button class="action-icon-btn btn-rotate-image" title="Xoay 90°">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                </svg>
            </button>
            <button class="action-icon-btn btn-delete-image" title="Xóa">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    // Handle delete sidebar item
    itemEl.querySelector('.btn-delete-image').addEventListener('click', (e) => {
        e.stopPropagation();
        itemEl.remove();
        delete activeImages[itemId];
        
        // Remove associated row in the table if it exists
        const associatedRow = document.querySelector(`tr[data-img-id="${itemId}"]`);
        if (associatedRow) {
            associatedRow.remove();
            recalculateSTT();
        }
        
        // Show empty states if no items left
        if (imageList.children.length === 0) {
            imageList.innerHTML = '<div class="empty-list-state">Chưa có ảnh nào được tải lên</div>';
        }
    });

    // Handle rotate sidebar item
    itemEl.querySelector('.btn-rotate-image').addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeImages[itemId].status === 'processing') {
            showToast("Đang chạy OCR, vui lòng đợi xong lượt này rồi xoay!", "warning");
            return;
        }
        
        // Rotate 90 degrees
        activeImages[itemId].rotation = (activeImages[itemId].rotation + 90) % 360;
        showToast(`Đã xoay ảnh 90°. Đang nhận dạng lại...`, 'info');
        runOCRProcess(itemId);
    });

    imageList.appendChild(itemEl);

    // Start OCR
    runOCRProcess(itemId);
}

// Current active image item ID running OCR (to update progress bar in UI)
let currentOcrItemId = null;

function updateOCRProgress(progress) {
    if (!currentOcrItemId) return;
    const itemEl = document.getElementById(currentOcrItemId);
    if (!itemEl) return;
    
    const statusEl = itemEl.querySelector('.image-item-status');
    if (statusEl) {
        const percent = Math.round(progress * 100);
        statusEl.innerHTML = `<span class="spinner"></span>Nhận dạng: ${percent}%`;
    }
}

async function runOCRProcess(itemId) {
    const itemState = activeImages[itemId];
    if (!itemState) return;

    currentOcrItemId = itemId;
    itemState.status = 'processing';
    
    const itemEl = document.getElementById(itemId);
    const statusEl = itemEl.querySelector('.image-item-status');
    statusEl.className = 'image-item-status status-loading';
    statusEl.innerHTML = '<span class="spinner"></span>Đang tối ưu ảnh...';

    // Load file as Image element to draw on canvas
    const imgElement = new Image();
    
    imgElement.onload = async () => {
        try {
            // 1. Preprocess image on canvas (Rotation + Grayscale + Contrast Enhancement + Sharpening)
            statusEl.innerHTML = '<span class="spinner"></span>Tăng nét, xoay ảnh...';
            const preprocessedCanvas = preprocessImageCanvas(imgElement, itemState.rotation);
            
            // 2. Save preprocessed image to backend (so it can be previewed in UI modal)
            statusEl.innerHTML = '<span class="spinner"></span>Đang lưu ảnh tối ưu...';
            const blob = await canvasToBlob(preprocessedCanvas, 'image/jpeg', 0.85);
            const uploadResult = await uploadPreprocessedImage(blob, itemState.originalFilename);
            itemState.preprocessedUrl = uploadResult.preprocessed_url;
            
            // Update preview thumbnail in sidebar
            const thumbEl = itemEl.querySelector('.image-item-thumbnail');
            thumbEl.src = itemState.preprocessedUrl;

            // Update viewer button if it already exists
            const actionsEl = itemEl.querySelector('.image-item-actions');
            let viewBtn = actionsEl.querySelector('.btn-view-ocr-image');
            if (!viewBtn) {
                viewBtn = document.createElement('button');
                viewBtn.className = 'action-icon-btn btn-view-ocr-image';
                viewBtn.title = 'Xem ảnh đã tối ưu';
                viewBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                `;
                viewBtn.addEventListener('click', () => {
                    openImageViewer(itemState.preprocessedUrl, itemState.originalFilename);
                });
                actionsEl.insertBefore(viewBtn, actionsEl.firstChild);
            } else {
                // Update click handler with new URL
                viewBtn.onclick = () => openImageViewer(itemState.preprocessedUrl, itemState.originalFilename);
            }

            // 3. Run Tesseract.js local OCR on the canvas
            if (!tesseractWorker) {
                statusEl.innerHTML = '<span class="spinner"></span>Đợi tải bộ máy OCR...';
                await initTesseract();
            }
            
            statusEl.innerHTML = '<span class="spinner"></span>Nhận dạng: 0%';
            
            // Run recognition
            const { data } = await tesseractWorker.recognize(preprocessedCanvas);
            
            // 4. Parse OCR text using regex heuristics
            statusEl.innerHTML = '<span class="spinner"></span>Phân tích dữ liệu...';
            const parsedData = parseOcrData(data.text);
            
            // Save final status
            itemState.status = 'success';
            statusEl.className = 'image-item-status status-success';
            statusEl.innerHTML = 'Thành công';
            
            // Add/update row in the table
            addOrUpdateTableRow(parsedData, itemId, itemState.preprocessedUrl, itemState.originalFilename);
            showToast(`Nhận dạng thành công: ${itemState.originalFilename}`, 'success');

        } catch (err) {
            console.error("Error in OCR pipeline for image:", err);
            itemState.status = 'error';
            statusEl.className = 'image-item-status status-error';
            statusEl.innerHTML = 'Lỗi xử lý';
            showToast(`Lỗi xử lý ảnh "${itemState.originalFilename}": ${err.message || err}`, 'error');
        }
    };
    
    imgElement.onerror = () => {
        itemState.status = 'error';
        statusEl.className = 'image-item-status status-error';
        statusEl.innerHTML = 'Lỗi đọc ảnh';
        showToast(`Không thể đọc file ảnh: ${itemState.originalFilename}`, 'error');
    };

    // Set src last to avoid race condition where onload fires before assignment
    imgElement.src = URL.createObjectURL(itemState.file);
}

// --- Image Preprocessing (Pure JS Canvas) ---
function preprocessImageCanvas(imgElement, rotationAngle = 0) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    let w = imgElement.naturalWidth;
    let h = imgElement.naturalHeight;
    
    // Safety check for extreme resolutions to avoid browser crash, resize if too large
    const maxDimension = 2048;
    if (Math.max(w, h) > maxDimension) {
        const scale = maxDimension / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
    }
    
    // Set dimensions based on rotation
    if (rotationAngle === 90 || rotationAngle === 270) {
        canvas.width = h;
        canvas.height = w;
    } else {
        canvas.width = w;
        canvas.height = h;
    }
    
    // Draw rotated image
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotationAngle * Math.PI) / 180);
    ctx.drawImage(imgElement, -w / 2, -h / 2, w, h);
    
    // Reset transformation matrix
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Apply image filters (Grayscale + Contrast stretch + Sharpen)
    try {
        let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let data = imageData.data;
        
        // Grayscale conversion & simple adaptive contrast enhancement
        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];
            
            // NTSC Formula for Luminance
            let gray = 0.299 * r + 0.587 * g + 0.114 * b;
            
            // Contrast adjustment (simple threshold/stretching for OCR)
            let factor = 1.35; // boost contrast
            let newVal = (gray - 128) * factor + 128;
            newVal = Math.max(0, Math.min(255, newVal));
            
            data[i] = newVal;     // R
            data[i + 1] = newVal; // G
            data[i + 2] = newVal; // B
        }
        ctx.putImageData(imageData, 0, 0);
        
        // Sharpen convolution filter
        // Kernel:
        // [ 0, -1,  0 ]
        // [-1,  5, -1 ]
        // [ 0, -1,  0 ]
        const sharpenKernel = [
            0, -1,  0,
           -1,  5, -1,
            0, -1,  0
        ];
        
        const sharpenedData = convolutionFilter(canvas, sharpenKernel);
        ctx.putImageData(sharpenedData, 0, 0);
    } catch (e) {
        console.warn("Canvas image pixel access blocked or unsupported:", e);
    }
    
    return canvas;
}

// 3x3 Convolution filter implementation
function convolutionFilter(canvas, kernel) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    const srcData = ctx.getImageData(0, 0, w, h);
    const src = srcData.data;
    
    const dstData = ctx.createImageData(w, h);
    const dst = dstData.data;
    
    const kCols = 3;
    const kRows = 3;
    const halfKCols = 1;
    const halfKRows = 1;
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dstIdx = (y * w + x) * 4;
            
            let rSum = 0;
            let gSum = 0;
            let bSum = 0;
            
            for (let ky = 0; ky < kRows; ky++) {
                for (let kx = 0; kx < kCols; kx++) {
                    const px = Math.min(w - 1, Math.max(0, x + kx - halfKCols));
                    const py = Math.min(h - 1, Math.max(0, y + ky - halfKRows));
                    const srcIdx = (py * w + px) * 4;
                    const weight = kernel[ky * kCols + kx];
                    
                    rSum += src[srcIdx] * weight;
                    gSum += src[srcIdx + 1] * weight;
                    bSum += src[srcIdx + 2] * weight;
                }
            }
            
            dst[dstIdx] = Math.max(0, Math.min(255, rSum));
            dst[dstIdx + 1] = Math.max(0, Math.min(255, gSum));
            dst[dstIdx + 2] = Math.max(0, Math.min(255, bSum));
            dst[dstIdx + 3] = src[dstIdx + 3]; // alpha
        }
    }
    
    return dstData;
}

// Helpers
function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function uploadPreprocessedImage(blob, originalFilename) {
    const formData = new FormData();
    formData.append('file', blob, `proc_${originalFilename}`);
    
    const response = await fetch('/upload_processed', {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) throw new Error("Failed to save preprocessed image on server");
    return response.json();
}

// --- OCR Parsing Engine (JS implementation of python regex) ---
function parseOcrData(text) {
    console.log("Raw OCR text:\n", text);
    
    let owner = parseOwner(text);
    let address = parseAddress(text);
    let area = parseArea(text);
    let purpose = parsePurpose(text);

    // Evaluate uncertainty flags (if value is empty or has bad OCR characters)
    const checkUncertainty = (val) => {
        if (!val || val.trim().length < 2) return true;
        if (/[\[\]|\\{}<>~_]/g.test(val)) return true;
        if (val.includes("Chưa nhận dạng")) return true;
        return false;
    };

    return {
        owner: owner || "Chưa nhận dạng được",
        address: address || "Chưa nhận dạng được",
        area: area || "Chưa nhận dạng được",
        purpose: purpose || "Chưa nhận dạng được",
        uncertain: {
            owner: checkUncertainty(owner),
            address: checkUncertainty(address),
            area: checkUncertainty(area),
            purpose: checkUncertainty(purpose)
        }
    };
}

function parseOwner(text) {
    const lines = text.split('\n');
    let ownerLines = [];
    let inOwnerSection = false;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        let lineLower = line.toLowerCase();
        
        if (lineLower.includes("người sử dụng đất") || lineLower.includes("chủ sở hữu nhà ở") || lineLower.includes("i. người") || lineLower.includes("1. người")) {
            inOwnerSection = true;
            continue;
        }
        
        if (inOwnerSection) {
            if (lineLower.includes("ii. thửa đất") || lineLower.includes("thửa đất, nhà ở") || lineLower.includes("2. thửa đất") || lineLower.includes("ii. thủa đất")) {
                inOwnerSection = false;
                break;
            }
            
            // Extract owner prefixed with Ông, Bà, Hộ...
            const prefixMatch = line.match(/^(?:ông|bà|hộ\s+ông|hộ\s+bà|công\s+ty|tổ\s+chức|dn|tổng\s+công\s+ty|dntn)\b[:\-\s]*(.*)/i);
            if (prefixMatch) {
                let name = prefixMatch[1].trim();
                name = name.split(/[,;]|\bsinh\b|\bnăm\b|\bcmnd\b|\bcccd\b|\bđịa\b/i)[0].trim();
                if (name.length > 3) {
                    ownerLines.push(name);
                }
            } else if (line === line.toUpperCase() && line.length > 5 && !/(sinh năm|cmnd|cccd|địa chỉ|thường trú|quốc tịch)/i.test(lineLower)) {
                // uppercase lines in owner section usually contain name
                ownerLines.push(line);
            }
        }
    }
    
    if (ownerLines.length > 0) {
        // Unique elements
        const uniqueOwners = Array.from(new Set(ownerLines));
        return formatOwnerNames(uniqueOwners.join('; '));
    }
    
    // Fallback search in entire text for capitalized word sequences after Ông/Bà
    const regex = /\b(?:Ông|Bà)\s+([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝ][a-zàáâãèéêìíòóôõùúýăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵý]*+(?:\s+[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝ][a-zàáâãèéêìíòóôõùúýăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵý]*+)+)/g;
    const matches = text.match(regex);
    if (matches) {
        const cleanedMatches = matches.map(m => m.replace(/^(Ông|Bà)\s+/i, '').trim());
        return formatOwnerNames(Array.from(new Set(cleanedMatches)).join('; '));
    }
    
    return "";
}

function formatOwnerNames(ownerStr) {
    // Title case the names
    return ownerStr.split('; ').map(name => {
        return name.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }).join('; ');
}

function parseAddress(text) {
    const lines = text.split('\n');
    let address = "";
    
    // 1. Search for "Địa chỉ thửa đất:" or "Địa chỉ:"
    const addressMatch = text.match(/(?:địa\s+chỉ(?:\s+thửa\s+đất)?|nơi\s+tọa\s+lạc)[:\-\s]*([^\n]+)/i);
    if (addressMatch) {
        address = addressMatch[1].trim();
    } else {
        // 2. Look for lines with commune, district, province
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            let lineLower = line.toLowerCase();
            if (/(xã |phường |thị trấn |huyện |quận |tỉnh |thành phố )/i.test(lineLower) && line.length > 15) {
                if (!/(thường trú|nơi cư trú|đăng ký)/i.test(lineLower)) {
                    address = line;
                    break;
                }
            }
        }
        // 3. Fallback: permanent address of owner
        if (!address) {
            const permAddressMatch = text.match(/(?:địa\s+chỉ\s+thường\s+trú|nơi\s+thường\s+trú)[:\-\s]*([^\n]+)/i);
            if (permAddressMatch) {
                address = permAddressMatch[1].trim();
            }
        }
    }
    
    if (address) {
        address = address.replace(/^(?:thửa đất|đất|nhà ở|tại|ở)\s*/i, '').trim();
        address = address.split(/[,;]|\bhình\b|\bmục\b|\bdiện\b/i)[0].trim();
    }
    return address;
}

function parseArea(text) {
    // 1. Match numbers with comma/dots and m2/m²
    const areaMatch = text.match(/(?:diện\s+tích)[:\-\s]*([\d.,\s]+)\s*(?:m2|m²|mét\s+vuông|met\s+vuông)/i);
    if (areaMatch) {
        return areaMatch[1].trim() + " m²";
    }
    // 2. Fallback search
    const fallbackMatch = text.match(/\b([\d.,\s]+)\s*(?:m2|m²)\b/i);
    if (fallbackMatch) {
        return fallbackMatch[1].trim() + " m²";
    }
    return "";
}

function parsePurpose(text) {
    const lines = text.split('\n');
    
    // 1. Match "Mục đích sử dụng:"
    const purposeMatch = text.match(/(?:mục\s+đích(?:\s+sử\s+dụng)?(?:\s+đất)?|sử\s+dụng\s+vào\s+mục\s+đích)[:\-\s]*([^\n]+)/i);
    if (purposeMatch) {
        let purpose = purposeMatch[1].trim();
        purpose = purpose.split(/[,;]|\bthời\b|\bhình\b|\bnguồn\b/i)[0].trim();
        if (purpose.length > 0) {
            return purpose.charAt(0).toUpperCase() + purpose.slice(1);
        }
        return purpose;
    }
    
    // 2. Fallback search for common terms
    const commonPurposes = [
        "đất ở tại nông thôn", "đất ở tại đô thị", "đất trồng cây lâu năm", 
        "đất trồng cây hàng năm", "đất nuôi trồng thủy sản", "đất rừng sản xuất", 
        "đất thương mại, dịch vụ", "đất trồng lúa"
    ];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        let lineLower = line.toLowerCase();
        for (let j = 0; j < commonPurposes.length; j++) {
            if (lineLower.includes(commonPurposes[j])) {
                let purpose = line.split(/[,;]|\bthời\b|\bhình\b|\bnguồn\b/i)[0].trim();
                return purpose.charAt(0).toUpperCase() + purpose.slice(1);
            }
        }
    }
    return "";
}

// --- Table Management ---
function initTableEvents() {
    const addRowBtn = document.getElementById('add-row-btn');
    const exportBtn = document.getElementById('export-btn');

    // Add empty row
    addRowBtn.addEventListener('click', () => {
        const emptyRow = document.getElementById('empty-table-row');
        if (emptyRow) emptyRow.style.display = 'none';
        
        addOrUpdateTableRow({
            owner: 'Nhập tên chủ sở hữu',
            address: 'Nhập địa chỉ thửa đất',
            area: '70 m²',
            purpose: 'Đất ở tại nông thôn',
            uncertain: { owner: false, address: false, area: false, purpose: false }
        }, null, null, null);
        
        showToast('Đã thêm một dòng dữ liệu trống', 'info');
    });

    // Export to Excel
    exportBtn.addEventListener('click', () => {
        exportTableToExcel();
    });
}

function addOrUpdateTableRow(data, imgId = null, imgUrl = null, filename = null) {
    const tableBody = document.getElementById('table-body');
    
    // Check if row already exists for this image (e.g. re-running OCR after rotation)
    let tr = imgId ? document.querySelector(`tr[data-img-id="${imgId}"]`) : null;
    const hasUncertainField = data.uncertain.owner || data.uncertain.address || data.uncertain.area || data.uncertain.purpose;
    const rowClass = hasUncertainField ? 'uncertain-row' : '';

    if (!tr) {
        // Create new row
        tr = document.createElement('tr');
        if (imgId) {
            tr.setAttribute('data-img-id', imgId);
        }
        tableBody.appendChild(tr);
    }

    tr.className = rowClass;
    if (imgId) {
        tr.setAttribute('data-img-url', imgUrl);
        tr.setAttribute('data-filename', filename);
    }
    
    // Recalculate STT
    recalculateSTT();
    const stt = tr.querySelector('.stt-cell') ? tr.querySelector('.stt-cell').textContent : tableBody.querySelectorAll('tr:not(.empty-table-row)').length;

    tr.innerHTML = `
        <td class="stt-cell text-center" style="font-weight: 600;">${stt}</td>
        <td>
            <div class="editable-cell ${data.uncertain.owner ? 'uncertain-cell' : ''}" contenteditable="true" data-field="owner" title="${data.uncertain.owner ? 'Dữ liệu nhận dạng không chắc chắn' : ''}">
                ${escapeHtml(data.owner)}
            </div>
        </td>
        <td>
            <div class="editable-cell ${data.uncertain.address ? 'uncertain-cell' : ''}" contenteditable="true" data-field="address" title="${data.uncertain.address ? 'Dữ liệu nhận dạng không chắc chắn' : ''}">
                ${escapeHtml(data.address)}
            </div>
        </td>
        <td>
            <div class="editable-cell ${data.uncertain.area ? 'uncertain-cell' : ''}" contenteditable="true" data-field="area" title="${data.uncertain.area ? 'Dữ liệu nhận dạng không chắc chắn' : ''}">
                ${escapeHtml(data.area)}
            </div>
        </td>
        <td>
            <div class="editable-cell ${data.uncertain.purpose ? 'uncertain-cell' : ''}" contenteditable="true" data-field="purpose" title="${data.uncertain.purpose ? 'Dữ liệu nhận dạng không chắc chắn' : ''}">
                ${escapeHtml(data.purpose)}
            </div>
        </td>
        <td class="text-center">
            <div class="table-action-group">
                ${imgId ? `
                <button class="btn-table-icon btn-table-view" title="Xem ảnh gốc OCR">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </button>
                ` : ''}
                <button class="btn-table-icon btn-table-delete" title="Xóa dòng này">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </td>
    `;

    // Hook events
    if (imgId) {
        tr.querySelector('.btn-table-view').addEventListener('click', () => {
            openImageViewer(imgUrl, filename);
        });
    }

    tr.querySelector('.btn-table-delete').addEventListener('click', () => {
        tr.remove();
        recalculateSTT();
        showToast('Đã xóa dòng dữ liệu', 'warning');
    });

    // Remove warning highlight on edit
    tr.querySelectorAll('.editable-cell').forEach(cell => {
        cell.addEventListener('input', () => {
            cell.classList.remove('uncertain-cell');
            cell.removeAttribute('title');
            
            // Check if row has any remaining uncertain cells
            const rowUncertainCells = tr.querySelectorAll('.uncertain-cell');
            if (rowUncertainCells.length === 0) {
                tr.classList.remove('uncertain-row');
            }
        });
    });

    recalculateSTT();
}

function recalculateSTT() {
    const tableBody = document.getElementById('table-body');
    const rows = tableBody.querySelectorAll('tr:not(.empty-table-row)');
    
    if (rows.length === 0) {
        const emptyRow = document.getElementById('empty-table-row');
        if (emptyRow) emptyRow.style.display = 'table-row';
        return;
    }

    rows.forEach((row, index) => {
        row.querySelector('.stt-cell').textContent = index + 1;
    });
}

// --- Export to Excel ---
function exportTableToExcel() {
    const tableBody = document.getElementById('table-body');
    const rows = tableBody.querySelectorAll('tr:not(.empty-table-row)');

    if (rows.length === 0) {
        showToast('Không có dữ liệu trong bảng để xuất!', 'warning');
        return;
    }

    showToast('Đang tạo và tải file Excel...', 'info');

    // Extract data from DOM cells
    const exportData = [];
    rows.forEach(row => {
        const stt = row.querySelector('.stt-cell').textContent.trim();
        const owner = row.querySelector('[data-field="owner"]').innerText.trim();
        const address = row.querySelector('[data-field="address"]').innerText.trim();
        const area = row.querySelector('[data-field="area"]').innerText.trim();
        const purpose = row.querySelector('[data-field="purpose"]').innerText.trim();

        exportData.push({
            stt: parseInt(stt),
            owner: owner,
            address: address,
            area: area,
            purpose: purpose
        });
    });

    // Send export request to backend
    fetch('/export', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(exportData)
    })
    .then(response => {
        if (!response.ok) throw new Error('Không thể xuất file Excel.');
        return response.blob();
    })
    .then(blob => {
        // Trigger browser download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'Danh_sach_dat_dai_Sacombank.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast('Tải file Excel thành công!', 'success');
    })
    .catch(error => {
        console.error('Error exporting:', error);
        showToast(`Lỗi khi xuất Excel: ${error.message}`, 'error');
    });
}

// --- Modal Image Viewer ---
function initModalEvents() {
    const modal = document.getElementById('preview-modal');
    const closeBtn = document.getElementById('modal-close-btn');
    const backdrop = document.getElementById('modal-backdrop');

    const closeModal = () => {
        modal.classList.remove('active');
    };

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    
    // Close on ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

function openImageViewer(url, filename) {
    const modal = document.getElementById('preview-modal');
    const modalImage = document.getElementById('modal-image');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = `Chi tiết ảnh OCR: ${filename}`;
    modalImage.src = url;
    modal.classList.add('active');
}

// --- Utility Functions ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    toast.innerHTML = `
        <span class="toast-content">${escapeHtml(message)}</span>
        <button class="toast-close">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    // Auto-remove toast after 4.5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }
    }, 4500);
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}
