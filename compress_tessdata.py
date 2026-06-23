import gzip
import shutil
import os

def compress():
    print("Compressing tessdata to static/tessdata for local offline OCR...")
    src_dir = "tessdata"
    dst_dir = "static/tessdata"
    os.makedirs(dst_dir, exist_ok=True)
    
    for lang in ['vie', 'eng']:
        src_path = os.path.join(src_dir, f"{lang}.traineddata")
        dst_path = os.path.join(dst_dir, f"{lang}.traineddata.gz")
        
        if not os.path.exists(src_path):
            print(f"Error: Source file {src_path} not found!")
            continue
            
        print(f"Compressing {src_path} to {dst_path}...")
        with open(src_path, 'rb') as f_in:
            with gzip.open(dst_path, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
                
    print("Local offline tessdata compression completed!")

if __name__ == "__main__":
    compress()
