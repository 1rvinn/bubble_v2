from gradio_client import Client, handle_file
import os
from dotenv import load_dotenv

load_dotenv()
HF_TOKEN = os.getenv("HF_TOKEN")

def omni_api(img_path):
	# client = Client("microsoft/OmniParser-v2", hf_token=HF_TOKEN)
	# client = Client("ginigen/OmniParser-v2-pro", hf_token=HF_TOKEN)
	client = Client("http://127.0.0.1:7860")
	result = client.predict(
			image_input=handle_file(img_path),
			box_threshold=0.05,
			iou_threshold=0.1,
			use_paddleocr=True,
			imgsz=640,
			api_name="/process"
	)
	return result

# print(omni_api('image.png'))