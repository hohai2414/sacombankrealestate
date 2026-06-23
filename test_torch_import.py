import sys
try:
    print("Testing raw torch import...")
    import torch
    print("Success! Torch version:", torch.__version__)
except Exception as e:
    import traceback
    print("Failed to import torch.")
    traceback.print_exc()
