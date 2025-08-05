from gradio_client import Client
import os
from dotenv import load_dotenv
import time
import httpx
from httpx import TimeoutException, ConnectError, ReadTimeout, WriteTimeout

load_dotenv()
HF_TOKEN = os.getenv("HF_TOKEN")

# Create client once at module level with timeout settings
print('[OMNI INIT] Initializing Omni API client...')
try:
    client = Client("1rvinn/bubble_omni", hf_token=HF_TOKEN)
    # Set longer timeout for the client
    client.timeout = 180  # 3 minutes timeout
    print('[OMNI INIT] Omni API client initialized successfully')
except Exception as e:
    print(f'[OMNI INIT] Error initializing client: {e}')
    client = None

def omni_api(img_base64_str, max_retries=3):
    if client is None:
        raise RuntimeError("Omni API client not initialized")
    
    for attempt in range(max_retries):
        try:
            print(f'[OMNI TIMING] Starting Omni API processing (attempt {attempt + 1}/{max_retries})')
            processing_start = time.time()
            print('[OMNI TIMING] Starting image processing')
            
            result = client.predict(
                image_base64_input=img_base64_str,
                box_threshold=0.05,
                iou_threshold=0.1,
                use_paddleocr=True,
                imgsz=640,
                api_name="/process"
            )
            
            processing_end = time.time()
            print(f"[OMNI TIMING] Image processing time: {(processing_end - processing_start) * 1000:.2f}ms")
            
            total_omni_time = (processing_end - processing_start) * 1000
            print(f"[OMNI TIMING] Total Omni API time: {total_omni_time:.2f}ms")
            return result
            
        except (TimeoutException, ReadTimeout, WriteTimeout) as e:
            print(f"[OMNI ERROR] Timeout on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + 1  # Exponential backoff: 3s, 5s, 9s
                print(f"[OMNI RETRY] Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
            else:
                print("[OMNI ERROR] All retry attempts failed due to timeout")
                raise RuntimeError(f"Omni API timeout after {max_retries} attempts: {str(e)}")
                
        except ConnectError as e:
            print(f"[OMNI ERROR] Connection error on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + 1
                print(f"[OMNI RETRY] Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
            else:
                print("[OMNI ERROR] All retry attempts failed due to connection error")
                raise RuntimeError(f"Omni API connection error after {max_retries} attempts: {str(e)}")
                
        except Exception as e:
            print(f"[OMNI ERROR] Unexpected error on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + 1
                print(f"[OMNI RETRY] Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
            else:
                print("[OMNI ERROR] All retry attempts failed due to unexpected error")
                raise RuntimeError(f"Omni API unexpected error after {max_retries} attempts: {str(e)}")

# print(omni_api('image.png'))