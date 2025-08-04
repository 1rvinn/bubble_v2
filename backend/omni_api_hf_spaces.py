from gradio_client import Client
import os
from dotenv import load_dotenv
import time

load_dotenv()
HF_TOKEN = os.getenv("HF_TOKEN")

def omni_api(img_base64_str):
	# client = Client("microsoft/OmniParser-v2", hf_token=HF_TOKEN)
	# client = Client("ginigen/OmniParser-v2-pro", hf_token=HF_TOKEN)
	print('[OMNI TIMING] Starting Omni API connection')
	connection_start = time.time()
	client = Client("http://127.0.0.1:7860/")
	# client = Client("1rvinn/bubble_omni", hf_token=HF_TOKEN)
	connection_end = time.time()
	print(f"[OMNI TIMING] Connection time: {(connection_end - connection_start) * 1000:.2f}ms")
	
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
	
	total_omni_time = (processing_end - connection_start) * 1000
	print(f"[OMNI TIMING] Total Omni API time: {total_omni_time:.2f}ms")
	return result

# print(omni_api('image.png'))