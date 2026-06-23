import cv2
import numpy as np
import re
import os
from PIL import Image

# Initialize the PaddleOCR reader lazily to prevent server crashes 
# if the system lacks Visual C++ redistributables at startup.
_ocr = None

def get_ocr():
    global _ocr
    if _ocr is None:
        try:
            print("Lazy importing PaddleOCR...")
            from paddleocr import PaddleOCR
            # Initialize PaddleOCR with CPU and orientation classifier
            _ocr = PaddleOCR(use_textline_orientation=True, lang='vi', device='cpu', enable_mkldnn=False)
        except ImportError as e:
            if "libpaddle" in str(e) or "DLL load failed" in str(e):
                raise ImportError(
                    "Không thể tải thư viện PaddleOCR. Vấn đề thường do thiếu Microsoft Visual C++ Redistributable trên hệ thống Windows của bạn.\n"
                    "Vui lòng tải và cài đặt VC++ Redistributable tại link chính thức của Microsoft: https://aka.ms/vs/17/release/vc_redist.x64.exe\n"
                    "Sau khi cài đặt xong, hãy khởi động lại ứng dụng."
                ) from e
            raise e
    return _ocr

def rotate_image(image, angle):
    """Rotate image by 90, 180, or 270 degrees."""
    if angle == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    elif angle == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    elif angle == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image

def preprocess_image_for_ocr(image_path, output_preprocessed_path=None):
    """
    Load image, apply enhancement techniques (CLAHE, sharpening) to improve OCR quality,
    and optionally save the preprocessed image.
    """
    # Read image using OpenCV
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image at {image_path}")

    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 1. Enhance contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # 2. Apply a sharpening filter
    # Kernel for sharpening
    kernel = np.array([[0, -1, 0], 
                       [-1, 5, -1], 
                       [0, -1, 0]])
    sharpened = cv2.filter2D(enhanced, -1, kernel)

    # Convert back to BGR for output (visual display in UI)
    processed_bgr = cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)

    if output_preprocessed_path:
        dir_name = os.path.dirname(output_preprocessed_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        cv2.imwrite(output_preprocessed_path, processed_bgr)

    return img, processed_bgr

def detect_correct_rotation(img):
    """
    Run OCR on a resized version of the image at 0, 90, 180, 270 degrees.
    Select the angle that contains the most Vietnamese keywords.
    """
    ocr = get_ocr()
    
    # Common Vietnamese keywords on Land Certificates
    keywords = [
        "giấy chứng nhận", "quyền sử dụng", "sử dụng đất", "thửa đất", "địa chỉ", 
        "diện tích", "mục đích", "sử dụng", "chủ sở hữu", "nhà ở", "tài sản"
    ]
    
    # Resize to a smaller size for fast OCR check (max dimension 800px)
    h, w = img.shape[:2]
    max_dim = 800
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        resized = cv2.resize(img, (int(w * scale), int(h * scale)))
    else:
        resized = img.copy()

    best_angle = 0
    max_matches = -1

    # Check rotations: 0, 90, 180, 270
    for angle in [0, 90, 180, 270]:
        rotated = rotate_image(resized, angle)
        
        # Run OCR
        results = ocr.ocr(rotated)
        
        # Count keyword matches
        matches = 0
        joined_text = ""
        if results and results[0]:
            res = results[0]
            if isinstance(res, dict):
                joined_text = " ".join([t.lower() for t in res.get('rec_texts', [])])
            else:
                joined_text = " ".join([line[1][0].lower() for line in res if line and len(line) >= 2])
        
        for kw in keywords:
            if kw in joined_text:
                matches += 1
                
        # If we have a very clear match on 0 degrees (e.g. >= 4 keywords), we can skip other rotations
        if angle == 0 and matches >= 4:
            full_results = ocr.ocr(img)
            return 0, full_results[0] if full_results else []
            
        if matches > max_matches:
            max_matches = matches
            best_angle = angle

    # Rerun OCR on full resolution image with the best rotation
    best_rotated_full = rotate_image(img, best_angle)
    full_results = ocr.ocr(best_rotated_full)
    
    return best_angle, full_results[0] if full_results else []

def parse_extracted_data(ocr_results):
    """
    Parse the OCR results (list of (bbox, text, conf)) to extract:
    - Chủ sở hữu (Owner)
    - Địa chỉ (Address)
    - Diện tích (Area)
    - Mục đích sử dụng (Land Use Purpose)
    
    Also determines an overall field confidence. If a field has low confidence or is empty,
    marks it as uncertain.
    """
    # Join text lines for parsing, but keep line order
    # ocr_results: list of [ [[x1,y1],...], (text, conf) ] from PaddleOCR
    lines = []
    min_confidence = 1.0
    
    if isinstance(ocr_results, dict):
        texts = ocr_results.get('rec_texts', [])
        scores = ocr_results.get('rec_scores', [])
        for text, conf in zip(texts, scores):
            lines.append((text.strip(), conf))
            if conf < min_confidence:
                min_confidence = conf
    else:
        for item in ocr_results:
            if item and len(item) >= 2 and isinstance(item[1], (list, tuple)):
                text = item[1][0].strip()
                conf = item[1][1]
                lines.append((text, conf))
                if conf < min_confidence:
                    min_confidence = conf

    full_text = "\n".join([line[0] for line in lines])
    
    # Initialize fields
    owner = ""
    address = ""
    area = ""
    purpose = ""
    
    # 1. Extract Owner (Chủ sở hữu)
    # Usually under "I. Người sử dụng đất, chủ sở hữu nhà ở..."
    # We look for "Người sử dụng đất" block and scan for names
    # Names are usually preceded by "Ông:", "Bà:", "Hộ ông:", "Hộ bà:", "Công ty:" or just written in uppercase
    owner_lines = []
    in_owner_section = False
    
    # Let's search sequentially in lines
    for i, (text, conf) in enumerate(lines):
        text_lower = text.lower()
        if "người sử dụng đất" in text_lower or "chủ sở hữu nhà ở" in text_lower or "i. người" in text_lower:
            in_owner_section = True
            continue
        if in_owner_section:
            # End owner section if we reach section II
            if "ii. thửa đất" in text_lower or "thửa đất, nhà ở" in text_lower or "2. thửa đất" in text_lower:
                in_owner_section = False
                break
            
            # Filter lines that look like owners
            # Check prefixes anywhere on the line
            prefix_match = re.search(r'(?:họ\s+và\s+tên|chủ\s+hộ|ông|bà|hộ\s+ông|hộ\s+bà|công\s+ty)\b[:\-\s]*(.*)', text, re.IGNORECASE)
            if prefix_match:
                owner_name = prefix_match.group(1).strip()
                owner_name = re.sub(r'^(?:ông|bà)\s+', '', owner_name, flags=re.IGNORECASE)
                # Clean up name (remove date of birth, identity card numbers if included in the same line)
                owner_name = re.split(r'[,;]|\bsinh\b|\bnăm\b|\bcmnd\b|\bcccd\b|\bđịa\b', owner_name, flags=re.IGNORECASE)[0].strip()
                if len(owner_name) > 3:
                    owner_lines.append(owner_name)
            elif text.isupper() and len(text) > 5 and not any(kw in text_lower for kw in ["sinh năm", "cmnd", "cccd", "địa chỉ", "thường trú"]):
                # If a line is all uppercase and long enough, it might be a name
                owner_lines.append(text)
    
    if owner_lines:
        # Join multiple owners
        owner = "; ".join(list(dict.fromkeys(owner_lines))) # Remove duplicates preserving order
    else:
        # Fallback regex search in the entire text
        # Look for "Ông" or "Bà" followed by capitalized words (horizontal spaces only)
        matches = re.findall(r'\b(?:Ông|Bà)[ \t]+([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝ][a-zàáâãèéêìíòóôõùúýăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵý]*(?:[ \t]+[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝ][a-zàáâãèéêìíòóôõùúýăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵý]*)+)', full_text)
        if matches:
            owner = "; ".join(list(dict.fromkeys(matches)))

    # 2. Extract Address (Địa chỉ)
    # Look for "Địa chỉ thửa đất:" or "Địa chỉ:" or "Nơi thường trú:" with accent-agnostic variations
    address_match = re.search(r'(?:địa\s+chỉ|dia\s+chi|đia\s+chi|địa\s+chi|nơi\s+tọa\s+lạc|noi\s+toa\s+lac)[:\-\s]*([^\n]+)', full_text, re.IGNORECASE)
    if address_match:
        address = address_match.group(1).strip()
    else:
        # Fallback: look for lines containing communes, districts, provinces
        for text, conf in lines:
            text_lower = text.lower()
            if any(kw in text_lower for kw in ["xã ", "phường ", "thị trấn ", "huyện ", "quận ", "tỉnh ", "thành phố "]) and len(text) > 15:
                # Exclude owner section permanent address if already matched, and exclude "xã hội" (country title)
                if "xã hội" not in text_lower and not any(kw in text_lower for kw in ["thường trú", "nơi cư trú", "đăng ký"]):
                    address = text.strip()
                    break
        if not address:
            # Second fallback: permanent address of owner
            perm_address_match = re.search(r'(?:địa\s+chỉ\s+thường\s+trú|nơi\s+thường\s+trú)[:\-\s]*([^\n]+)', full_text, re.IGNORECASE)
            if perm_address_match:
                address = perm_address_match.group(1).strip()

    # Clean address
    if address:
        address = re.sub(r'^(?:thửa đất|đất|nhà ở|tại|ở)\s*', '', address, flags=re.IGNORECASE)
        # Remove trailing punctuation or fields like "Hình thức sử dụng" if appended
        address = re.split(r'[;]|\bhình\b|\bmục\b|\bdiện\b', address, flags=re.IGNORECASE)[0].strip()

    # 3. Extract Area (Diện tích)
    # Look for "Diện tích: 71,5 m2" or "a) Diện tích: 71,5 m²"
    # Match numbers with commas/dots followed by m2 or m²
    area_match = re.search(r'(?:diện\s+tích)[:\-\s]*([\d.,\s]+)\s*(?:m2|m²|mét\s+vuông|met\s+vuông)', full_text, re.IGNORECASE)
    if area_match:
        area = area_match.group(1).strip() + " m²"
    else:
        # Fallback: scan lines for numbers and m2/m²
        for text, conf in lines:
            m = re.search(r'\b([\d.,\s]+)\s*(?:m2|m²)\b', text, re.IGNORECASE)
            if m:
                area = m.group(1).strip() + " m²"
                break

    # 4. Extract Purpose (Mục đích sử dụng đất)
    # Check land use codes map first since they are highly reliable in parenthesis
    land_code_map = {
        "ONT": "Đất ở tại nông thôn",
        "ODT": "Đất ở tại đô thị",
        "CLN": "Đất trồng cây lâu năm",
        "HNK": "Đất trồng cây hàng năm khác",
        "NTS": "Đất nuôi trồng thủy sản",
        "RSX": "Đất rừng sản xuất",
        "LUC": "Đất trồng lúa nước",
        "TMD": "Đất thương mại, dịch vụ"
    }
    for code, full_name in land_code_map.items():
        if re.search(r'\b' + code + r'\b', full_text):
            purpose = full_name
            break
            
    if not purpose:
        # Look for "Mục đích sử dụng: Đất ở tại nông thôn" or "c) Mục đích sử dụng: ..."
        purpose_match = re.search(r'(?:mục\s+đích|muc\s+dich|mc\s+đích|mc\s+dich|sử\s+dụng\s+vào\s+mục\s+đích)[:\-\s]*([^\n]+)', full_text, re.IGNORECASE)
        if purpose_match:
            purpose = purpose_match.group(1).strip()
        else:
            # Fallback: look for common land purposes
            common_purposes = ["đất ở tại nông thôn", "đất ở tại đô thị", "đất trồng cây lâu năm", "đất trồng cây hàng năm", "đất nuôi trồng thủy sản", "đất rừng sản xuất", "đất thương mại, dịch vụ"]
        for text, conf in lines:
            text_lower = text.lower()
            for cp in common_purposes:
                if cp in text_lower:
                    purpose = text.strip()
                    break
            if purpose:
                break

    # Clean purpose
    if purpose:
        purpose = re.split(r'[,;]|\bthời\b|\bhình\b|\bnguồn\b', purpose, flags=re.IGNORECASE)[0].strip()
        # capitalize first letter
        purpose = purpose[0].upper() + purpose[1:] if len(purpose) > 0 else purpose

    # Evaluate confidence scores and uncertainties
    # We look at the average confidence of OCR text. If any field is empty or OCR results have low confidence, we flag it.
    uncertain_fields = []
    
    # Let's check confidence of text snippets that matched our fields
    # (Simple check: if field is empty, it's uncertain. If average confidence of OCR is below 0.65, we mark it.)
    
    def check_field_uncertainty(field_val, field_name):
        if not field_val or len(field_val.strip()) < 2:
            return True
        # If OCR text contains characters that look like OCR errors, e.g. |, [, ], etc.
        if re.search(r'[\[\]|\\{}<>~]', field_val):
            return True
        return False

    is_uncertain = {
        "owner": check_field_uncertainty(owner, "owner"),
        "address": check_field_uncertainty(address, "address"),
        "area": check_field_uncertainty(area, "area"),
        "purpose": check_field_uncertainty(purpose, "purpose")
    }

    # Format values nicely
    if owner:
        # Title case names
        # e.g. "PHẠM LÊ KIÊN" -> "Phạm Lê Kiên"
        owner = " ".join([word.capitalize() for word in owner.split()])
        
    return {
        "owner": owner if owner else "Chưa nhận dạng được",
        "address": address if address else "Chưa nhận dạng được",
        "area": area if area else "Chưa nhận dạng được",
        "purpose": purpose if purpose else "Chưa nhận dạng được",
        "uncertain": is_uncertain,
        "raw_text": full_text
    }

def process_certificate_image(image_path, preprocessed_output_path=None, manual_rotation=None):
    """
    High-level function:
    1. Preprocess image (denoise, contrast, sharpen)
    2. Detect/apply rotation and run OCR
    3. Parse information
    Returns: dict of extracted fields, rotation angle, and status.
    """
    try:
        # Preprocess
        original_img, preprocessed_img = preprocess_image_for_ocr(image_path, preprocessed_output_path)
        
        # If manual_rotation is specified, we bypass auto detection and use it
        if manual_rotation is not None and manual_rotation in [0, 90, 180, 270]:
            rotation_angle = manual_rotation
            ocr = get_ocr()
            best_rotated_full = rotate_image(original_img, rotation_angle)
            full_results = ocr.ocr(best_rotated_full)
            ocr_results = full_results[0] if full_results else []
        else:
            # Detect rotation automatically
            rotation_angle, ocr_results = detect_correct_rotation(original_img)
            
        # Save preprocessed/rotated image for display
        if preprocessed_output_path:
            rotated_preprocessed = rotate_image(preprocessed_img, rotation_angle)
            cv2.imwrite(preprocessed_output_path, rotated_preprocessed)
            
        # Parse data
        parsed_data = parse_extracted_data(ocr_results)
        
        parsed_data["rotation_angle"] = rotation_angle
        parsed_data["status"] = "success"
        return parsed_data
        
    except Exception as e:
        import traceback
        print(f"Error processing image {image_path}: {str(e)}")
        traceback.print_exc()
        return {
            "owner": "Lỗi xử lý",
            "address": "Lỗi xử lý",
            "area": "Lỗi xử lý",
            "purpose": "Lỗi xử lý",
            "uncertain": {"owner": True, "address": True, "area": True, "purpose": True},
            "status": "error",
            "error_msg": str(e)
        }
