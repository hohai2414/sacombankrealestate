import os
from ocr_engine import process_certificate_image
import json

def test():
    img_path = "sample_certificate.png"
    out_path = "sample_certificate_processed.jpg"
    
    print(f"Testing OCR on {img_path}...")
    if not os.path.exists(img_path):
        print(f"Error: {img_path} not found!")
        return

    result = process_certificate_image(img_path, out_path)
    print("\nOCR Result:")
    print(json.dumps(result, indent=4, ensure_ascii=False))
    
    if os.path.exists(out_path):
        print(f"Preprocessed image successfully saved to: {out_path}")
    else:
        print("Warning: Preprocessed image was not saved!")

if __name__ == "__main__":
    test()
